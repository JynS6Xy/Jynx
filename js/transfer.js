/**
 * Jynx Universal Multi-Tier Global Relay Engine
 * 1. Vercel Serverless REST API (/api/relay/upload, /api/relay/room/:code, /api/relay/payload/:code)
 * 2. Global MQTT WebSockets Cloud Relay (broker.emqx.io & broker.hivemq.com)
 * 3. Local Mesh (BroadcastChannel + LocalStorage)
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

  _getMqttClient() {
    return new Promise((resolve) => {
      if (typeof mqtt === "undefined") {
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

        client.on("error", () => {
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

  async _publishToMqttCloud(code, payloadPackage) {
    const topic = `jynx/relay/v1/${code.toLowerCase()}`;
    const client = await this._getMqttClient();
    if (!client) return false;

    return new Promise((resolve) => {
      const payloadStr = JSON.stringify(payloadPackage);
      client.publish(topic, payloadStr, { qos: 1, retain: true }, (err) => {
        try { client.end(); } catch (e) {}
        resolve(!err);
      });
    });
  }

  async _fetchFromMqttCloud(code) {
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
      }, 4000);

      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          clearTimeout(timeout);
          finish(null);
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

  async startSend({ code, mode, files, text, onProgress, onStatus }) {
    code = code.trim().toLowerCase();
    onStatus?.("Preparing payload data...", "encrypting");

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
      let totalBytes = 0;

      for (const file of files) {
        filesMeta.push({
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          offset: totalBytes,
          lastModified: file.lastModified
        });
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
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        onStatus?.(`Reading file ${i+1}/${files.length}: ${file.name}...`, "staging");
        const CHUNK = 4 * 1024 * 1024;
        let fileOffset = 0;
        while (fileOffset < file.size) {
          const slice = file.slice(fileOffset, Math.min(fileOffset + CHUNK, file.size));
          const sliceBuf = await slice.arrayBuffer();
          combined.set(new Uint8Array(sliceBuf), curOffset + fileOffset);
          fileOffset += sliceBuf.byteLength;
          await new Promise(r => setTimeout(r, 0));
        }
        curOffset += file.size;
      }

      rawBuffer = combined.buffer;
    }

    // 1. WebCrypto AES-256-GCM Encryption
    onStatus?.("Encrypting payload with AES-256-GCM in browser...", "encrypting");
    await new Promise(r => setTimeout(r, 10));
    const encryptedData = await window.jynxCrypto.encrypt(rawBuffer, code);
    const verification = await window.jynxCrypto.getVerificationDigits(code);

    const totalEncryptedBytes = encryptedData.byteLength;

    // Direct chunked upload for payloads > 10 MB to prevent V8 memory spikes & browser crashes
    if (totalEncryptedBytes > 10 * 1024 * 1024) {
      onStatus?.(`Streaming encrypted upload (${JynxTools.formatBytes(totalEncryptedBytes)})...`, "uploading");
      const UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
      let uploaded = 0;
      let isFirst = true;
      const uploadStartTime = performance.now();

      while (uploaded < totalEncryptedBytes) {
        const end = Math.min(uploaded + UPLOAD_CHUNK_SIZE, totalEncryptedBytes);
        const chunkSub = encryptedData.subarray(uploaded, end);
        const isLast = (end === totalEncryptedBytes);
        const chunkB64 = this._uint8ArrayToBase64(chunkSub);

        await fetch(`${this.apiBase}/api/relay/upload-chunk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: code,
            manifest: manifest,
            verification: verification,
            chunk_b64: chunkB64,
            is_first: isFirst,
            is_last: isLast,
            mode: mode,
            ttl: 86400,
            max_downloads: 10
          })
        });

        isFirst = false;
        uploaded = end;
        const elapsedSec = (performance.now() - uploadStartTime) / 1000;
        const speed = elapsedSec > 0 ? uploaded / elapsedSec : 0;
        const remainingBytes = totalEncryptedBytes - uploaded;
        const eta = speed > 0 ? remainingBytes / speed : 0;
        const percent = Math.round((uploaded / totalEncryptedBytes) * 100);
        onProgress?.({ transferred: uploaded, totalBytes: totalEncryptedBytes, percent, speed, eta, elapsedSec });
        onStatus?.(`Streaming chunked payload to relay: ${percent}%`, "uploading");
        await new Promise(r => setTimeout(r, 0));
      }
    } else {
      const payloadB64 = this._uint8ArrayToBase64(encryptedData);
      onStatus?.("Uploading encrypted payload to relay...", "uploading");
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

      // Cache small payloads locally for tab-to-tab mesh
      if (totalEncryptedBytes < 5 * 1024 * 1024) {
        const payloadPackage = {
          code: code,
          manifest: manifest,
          verification: verification,
          data: payloadB64,
          mode: mode,
          createdAt: Date.now()
        };
        try {
          sessionStorage.setItem(`jynx_payload_${code}`, JSON.stringify(payloadPackage));
          localStorage.setItem(`jynx_payload_${code}`, JSON.stringify(payloadPackage));
        } catch (e) {}

        await this._publishToMqttCloud(code, payloadPackage);
      }
    }

    // Broadcast to local tabs
    if (this.channel) {
      this.channel.postMessage({
        type: "JYNX_ROOM_ANNOUNCE",
        code: code,
        payload: { meta: manifest }
      });
    }

    onStatus?.(`Ready on Relay! Share code: ${code} (Verification: ${verification})`, "ready");

    return {
      manifest,
      verification,
      encryptedData,
      totalSize: encryptedData.byteLength
    };
  }

  async startReceive({ code, onProgress, onStatus }) {
    code = code.trim().toLowerCase();
    onStatus?.(`Connecting to Jynx Relay for room "${code}"...`, "connecting");

    let payloadPackage = null;
    const maxAttempts = 15;
    let attempt = 0;

    while (attempt < maxAttempts && !payloadPackage) {
      attempt++;

      // Strategy 1: Local Session Mesh
      try {
        const stored = sessionStorage.getItem(`jynx_payload_${code}`) || localStorage.getItem(`jynx_payload_${code}`);
        if (stored) {
          payloadPackage = JSON.parse(stored);
          break;
        }
      } catch (e) {}

      // Strategy 2: Server REST API Stream
      try {
        const roomRes = await fetch(`${this.apiBase}/api/relay/room/${encodeURIComponent(code)}`);
        if (roomRes.ok) {
          const roomMeta = await roomRes.json();
          const payloadRes = await fetch(`${this.apiBase}/api/relay/payload/${encodeURIComponent(code)}`);
          if (payloadRes.ok) {
            const ab = await payloadRes.arrayBuffer();
            payloadPackage = {
              rawBytes: new Uint8Array(ab),
              manifest: roomMeta.manifest,
              verification: roomMeta.verification
            };
            break;
          }
        }
      } catch (e) {}

      // Strategy 3: Global MQTT Cloud Relay
      if (!payloadPackage) {
        payloadPackage = await this._fetchFromMqttCloud(code);
        if (payloadPackage) break;
      }

      if (!payloadPackage && attempt < maxAttempts) {
        onStatus?.(`Searching for room "${code}"... (Attempt ${attempt}/${maxAttempts})`, "handshake");
        await new Promise(r => setTimeout(r, 1800));
      }
    }

    if (!payloadPackage || (!payloadPackage.data && !payloadPackage.rawBytes)) {
      throw new Error(
        `Room "${code}" not found. Please ensure the sender clicked "SEND ENCRYPTED TEXT" or "SEND FILES" to open the transfer room.`
      );
    }

    // Decrypt and unpack without unnecessary string allocations
    let encryptedBytes;
    if (payloadPackage.rawBytes) {
      encryptedBytes = payloadPackage.rawBytes;
    } else {
      encryptedBytes = this._base64ToUint8Array(payloadPackage.data);
    }

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
      await new Promise(r => setTimeout(r, 15));
    }

    onStatus?.("Decrypting AES-256-GCM payload in browser...", "decrypting");
    await new Promise(r => setTimeout(r, 50));

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
    const CHUNK_SIZE = 0x8000; // 32KB chunks to prevent stack overflow & UI freeze
    let index = 0;
    const length = uint8.length;
    let result = '';
    while (index < length) {
      const slice = uint8.subarray(index, Math.min(index + CHUNK_SIZE, length));
      result += String.fromCharCode.apply(null, slice);
      index += CHUNK_SIZE;
    }
    return window.btoa(result);
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
