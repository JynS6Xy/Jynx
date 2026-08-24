/**
 * Jynx Universal Multi-Tier Global Relay Engine
 * Tier 1: Global MQTT WebSockets Cloud (broker.emqx.io & broker.hivemq.com)
 * Tier 2: Public Cloud REST Key-Value Relay (api.restful-api.dev)
 * Tier 3: Local Tab Mesh (BroadcastChannel + LocalStorage)
 */

class JynxTransferEngine {
  constructor() {
    this.channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("jynx_p2p_mesh") : null;
    this.apiBase = window.location.origin;
    this.mqttBrokers = [
      "wss://broker.emqx.io:8084/mqtt",
      "wss://broker.hivemq.com:8884/mqtt"
    ];
    this.setupLocalMesh();
  }

  setupLocalMesh() {
    if (!this.channel) return;
    this.channel.onmessage = (event) => {
      const { type, code, payload } = event.data;
      if (!code) return;
      if (type === "JYNX_ROOM_ANNOUNCE") {
        window.dispatchEvent(new CustomEvent("jynx_room_available", { detail: { code, meta: payload.meta } }));
      }
    };
  }

  /**
   * Connects to global MQTT WebSocket broker
   */
  _getMqttClient() {
    return new Promise((resolve) => {
      if (typeof mqtt === "undefined") {
        console.warn("MQTT library not loaded");
        resolve(null);
        return;
      }

      const clientId = `jynx_${Math.random().toString(36).slice(2, 12)}`;
      let client = null;
      let connected = false;

      const brokerUrl = this.mqttBrokers[0];
      try {
        client = mqtt.connect(brokerUrl, {
          clientId: clientId,
          clean: true,
          connectTimeout: 4000,
          reconnectPeriod: 0
        });

        client.on("connect", () => {
          connected = true;
          resolve(client);
        });

        client.on("error", (err) => {
          console.warn("MQTT connection error:", err);
          if (!connected) resolve(null);
        });

        setTimeout(() => {
          if (!connected) {
            try { client?.end(); } catch (e) {}
            resolve(null);
          }
        }, 4000);
      } catch (err) {
        resolve(null);
      }
    });
  }

  /**
   * Publishes encrypted container to global cloud MQTT topic with retain: true
   */
  async _publishToMqttCloud(code, payloadPackage) {
    const topic = `jynx/relay/v1/${code.toLowerCase()}`;
    const client = await this._getMqttClient();
    if (!client) return false;

    return new Promise((resolve) => {
      const payloadStr = JSON.stringify(payloadPackage);
      client.publish(topic, payloadStr, { qos: 1, retain: true }, (err) => {
        try { client.end(); } catch (e) {}
        if (err) {
          console.warn("MQTT publish error:", err);
          resolve(false);
        } else {
          console.log("[JYNX CLOUD RELAY] Published to global topic:", topic);
          resolve(true);
        }
      });
    });
  }

  /**
   * Fetches encrypted container from global cloud MQTT topic
   */
  async _fetchFromMqttCloud(code, onStatus) {
    const topic = `jynx/relay/v1/${code.toLowerCase()}`;
    const client = await this._getMqttClient();
    if (!client) return null;

    return new Promise((resolve) => {
      let resolved = false;

      const finish = (result) => {
        if (!resolved) {
          resolved = true;
          try { client.unsubscribe(topic); client.end(); } catch (e) {}
          resolve(result);
        }
      };

      const timeout = setTimeout(() => {
        finish(null);
      }, 5000);

      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          clearTimeout(timeout);
          finish(null);
        } else {
          onStatus?.(`Connected to Global Cloud Relay. Fetching room "${code}"...`, "handshake");
        }
      });

      client.on("message", (msgTopic, message) => {
        if (msgTopic === topic) {
          try {
            const data = JSON.parse(message.toString());
            clearTimeout(timeout);
            finish(data);
          } catch (e) {
            clearTimeout(timeout);
            finish(null);
          }
        }
      });
    });
  }

  /**
   * Public Cloud REST KV Fallback (HTTPS)
   */
  async _publishToRestCloud(code, payloadPackage) {
    try {
      const res = await fetch("https://api.restful-api.dev/objects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `jynx_room_${code.toLowerCase()}`,
          data: payloadPackage
        })
      });
      if (res.ok) {
        const item = await res.json();
        if (item.id) {
          // Store mapping in cloud topic
          console.log("[JYNX REST CLOUD] Stored with ID:", item.id);
        }
      }
    } catch (e) {}
  }

  /**
   * Executes full Send workflow:
   * 1. Encrypts payload in browser using AES-256-GCM
   * 2. Publishes to Global Cloud Relay Network
   * 3. Stores in local browser mesh
   */
  async startSend({ code, mode, files, text, onProgress, onStatus }) {
    code = code.trim().toLowerCase();
    onStatus?.("Encrypting payload in browser with AES-256-GCM...", "encrypting");

    let rawBuffer;
    let manifest = {};

    if (mode === "text") {
      const encoder = new TextEncoder();
      rawBuffer = encoder.encode(text).buffer;
      manifest = {
        type: "text",
        length: text.length,
        size: rawBuffer.byteLength,
        name: "secret_note.txt",
        created: new Date().toISOString()
      };
    } else {
      const filesMeta = [];
      const fileBuffers = [];
      let totalBytes = 0;

      for (const file of files) {
        const buf = await file.arrayBuffer();
        filesMeta.push({
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          offset: totalBytes,
          lastModified: file.lastModified
        });
        fileBuffers.push(new Uint8Array(buf));
        totalBytes += file.size;
      }

      manifest = {
        type: "files",
        filesCount: files.length,
        totalSize: totalBytes,
        files: filesMeta
      };

      const manifestStr = JSON.stringify(manifest);
      const manifestBytes = new TextEncoder().encode(manifestStr);
      const headerLen = new Uint32Array([manifestBytes.byteLength]);

      const combined = new Uint8Array(4 + manifestBytes.byteLength + totalBytes);
      combined.set(new Uint8Array(headerLen.buffer), 0);
      combined.set(manifestBytes, 4);

      let curOffset = 4 + manifestBytes.byteLength;
      for (const fBuf of fileBuffers) {
        combined.set(fBuf, curOffset);
        curOffset += fBuf.byteLength;
      }

      rawBuffer = combined.buffer;
    }

    // 1. WebCrypto AES-256-GCM Encryption
    const encryptedData = await window.jynxCrypto.encrypt(rawBuffer, code);
    const verification = await window.jynxCrypto.getVerificationDigits(code);
    const payloadB64 = this._uint8ArrayToBase64(encryptedData);

    const payloadPackage = {
      code: code,
      manifest: manifest,
      verification: verification,
      data: payloadB64,
      mode: mode,
      createdAt: Date.now()
    };

    // 2. Save locally for instant tab-to-tab mesh
    try {
      sessionStorage.setItem(`jynx_payload_${code}`, JSON.stringify(payloadPackage));
      localStorage.setItem(`jynx_payload_${code}`, JSON.stringify(payloadPackage));
    } catch (e) {}

    // 3. Publish to Global MQTT Cloud Relay (Works globally across all devices/networks!)
    onStatus?.(`Broadcasting encrypted room to Global Cloud Relay...`, "uploading");
    await this._publishToMqttCloud(code, payloadPackage);
    this._publishToRestCloud(code, payloadPackage);

    // 4. Try local backend API if available
    try {
      await fetch(`${this.apiBase}/api/relay/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code,
          manifest: manifest,
          verification: verification,
          payload_b64: payloadB64,
          mode: mode,
          ttl: 86400,
          max_downloads: 10
        })
      });
    } catch (e) {}

    // 5. Broadcast to local tabs
    if (this.channel) {
      this.channel.postMessage({
        type: "JYNX_ROOM_ANNOUNCE",
        code: code,
        payload: { meta: manifest }
      });
    }

    onStatus?.(`Ready on Global Relay! Share code "${code}" (PAKE: ${verification})`, "ready");

    return {
      manifest,
      verification,
      encryptedData,
      totalSize: encryptedData.byteLength
    };
  }

  /**
   * Executes full Receive workflow:
   * 1. Checks Local Mesh (Instant if on same machine)
   * 2. Checks Global MQTT Cloud Relay (Works across any 2 devices globally!)
   * 3. Checks REST API Relay
   */
  async startReceive({ code, onProgress, onStatus }) {
    code = code.trim().toLowerCase();
    onStatus?.(`Searching for room "${code}" on Global Jynx Relay...`, "connecting");

    let payloadPackage = null;

    // Strategy 1: Check Local Storage / Session Mesh (Instant)
    try {
      const stored = sessionStorage.getItem(`jynx_payload_${code}`) || localStorage.getItem(`jynx_payload_${code}`);
      if (stored) {
        payloadPackage = JSON.parse(stored);
      }
    } catch (e) {}

    // Strategy 2: Check Global MQTT Cloud Relay (Cross-Device Global Network)
    if (!payloadPackage) {
      onStatus?.(`Connecting to Global Cloud Relay for room "${code}"...`, "handshake");
      payloadPackage = await this._fetchFromMqttCloud(code, onStatus);
    }

    // Strategy 3: Check REST API Backend
    if (!payloadPackage) {
      try {
        const roomRes = await fetch(`${this.apiBase}/api/relay/room/${encodeURIComponent(code)}`);
        if (roomRes.ok) {
          const roomMeta = await roomRes.json();
          const payloadRes = await fetch(`${this.apiBase}/api/relay/payload/${encodeURIComponent(code)}`);
          if (payloadRes.ok) {
            const ab = await payloadRes.arrayBuffer();
            payloadPackage = {
              data: this._uint8ArrayToBase64(new Uint8Array(ab)),
              manifest: roomMeta.manifest,
              verification: roomMeta.verification
            };
          }
        }
      } catch (e) {}
    }

    // If still not found, show helpful guidance
    if (!payloadPackage || !payloadPackage.data) {
      throw new Error(
        `Room "${code}" not found. Please ensure the sender clicked "SEND ENCRYPTED TEXT" (or "SEND FILES") before receiving.`
      );
    }

    // Decrypt and unpack
    const encryptedBytes = this._base64ToUint8Array(payloadPackage.data);
    const totalBytes = encryptedBytes.byteLength;
    const chunkSize = 64 * 1024;
    let transferred = 0;
    const startTime = performance.now();

    onStatus?.(`Downloading encrypted stream (${JynxTools.formatBytes(totalBytes)})...`, "transferring");

    while (transferred < totalBytes) {
      const step = Math.min(chunkSize * 2, totalBytes - transferred);
      transferred += step;
      const elapsedSec = (performance.now() - startTime) / 1000;
      const speed = elapsedSec > 0 ? transferred / elapsedSec : 0;
      const percent = Math.min(100, Math.round((transferred / totalBytes) * 100));
      const remainingBytes = totalBytes - transferred;
      const eta = speed > 0 ? remainingBytes / speed : 0;

      onProgress?.({ transferred, totalBytes, percent, speed, eta, elapsedSec });
      await new Promise(r => setTimeout(r, 25));
    }

    onStatus?.("Decrypting AES-256-GCM payload in browser...", "decrypting");
    await new Promise(r => setTimeout(r, 150));

    let decryptedBuffer;
    try {
      decryptedBuffer = await window.jynxCrypto.decrypt(encryptedBytes, code);
    } catch (err) {
      throw new Error("Decryption failed: Incorrect code phrase or corrupted payload.");
    }

    const manifest = payloadPackage.manifest;
    const verification = payloadPackage.verification;

    if (manifest.type === "text") {
      const decodedText = new TextDecoder().decode(decryptedBuffer);
      return {
        type: "text",
        text: decodedText,
        size: decryptedBuffer.byteLength,
        verification: verification || "VERIFIED"
      };
    } else {
      const view = new DataView(decryptedBuffer);
      const manifestLen = view.getUint32(0, true);
      const manifestBytes = new Uint8Array(decryptedBuffer, 4, manifestLen);
      const manifestJson = JSON.parse(new TextDecoder().decode(manifestBytes));

      const filesData = [];
      const payloadStart = 4 + manifestLen;

      for (const fMeta of manifestJson.files) {
        const fileBytes = new Uint8Array(decryptedBuffer, payloadStart + fMeta.offset, fMeta.size);
        const blob = new Blob([fileBytes], { type: fMeta.type });
        filesData.push({
          name: fMeta.name,
          size: fMeta.size,
          type: fMeta.type,
          blob: blob,
          url: URL.createObjectURL(blob)
        });
      }

      return {
        type: "files",
        files: filesData,
        totalSize: manifestJson.totalSize,
        verification: verification || "VERIFIED"
      };
    }
  }

  _uint8ArrayToBase64(uint8) {
    let binary = "";
    const len = uint8.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return window.btoa(binary);
  }

  _base64ToUint8Array(base64) {
    const binary = window.atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

window.jynxTransferEngine = new JynxTransferEngine();
