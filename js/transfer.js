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

  async startSend({ code, mode, files, text, receiverEmail, onProgress, onStatus }) {
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

      const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB (R2 multipart limit)
      if (totalBytes > MAX_FILE_SIZE) {
        throw new Error("Selected files exceed maximum size limit of 1 GB.");
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
    onStatus?.("Encrypting payload with AES-256-GCM...", "encrypting");
    onProgress?.({ transferred: 0, totalBytes: 0, percent: 0, speed: 0, eta: 0, elapsedSec: 0 });
    const encryptedData = await window.jynxCrypto.encrypt(rawBuffer, code);
    const verification = await window.jynxCrypto.getVerificationDigits(code);
    const useR2 = encryptedData.byteLength > 45 * 1024 * 1024;
    let payloadB64 = null;

    if (useR2) {
      await this._uploadR2(code, encryptedData, manifest, verification, mode, onStatus, onProgress);
    } else {
      payloadB64 = this._uint8ArrayToBase64(encryptedData);
    }

    const payloadPackage = {
      code: code,
      manifest: manifest,
      verification: verification,
      data: payloadB64,
      mode: mode,
      createdAt: Date.now()
    };

    // 2. Save locally for instant tab-to-tab mesh
    if (payloadB64) {
      try {
        sessionStorage.setItem(`jynx_payload_${code}`, JSON.stringify(payloadPackage));
        localStorage.setItem(`jynx_payload_${code}`, JSON.stringify(payloadPackage));
      } catch (e) {}
    }

    onStatus?.("Staging encrypted payload locally...", "staging");

    // 3. Upload to Vercel Serverless Relay
    onStatus?.("Uploading to Cloud Relay...", "uploading");
    let serverlessOk = useR2;
    try {
      if (useR2) throw new Error("R2 upload already completed");
      const uploadBody = JSON.stringify({
          code: code,
          manifest: manifest,
          verification: verification,
          payload_b64: payloadB64,
          payload_size: encryptedData.byteLength,
          mode: mode,
          ttl: 86400,
          max_downloads: 10
      });
      const res = await this._uploadJsonWithProgress(
        `${this.apiBase}/api/relay/upload`,
        uploadBody,
        onProgress
      );
      if (res.ok) {
        serverlessOk = true;
        console.log("[JYNX RELAY] Uploaded to Vercel Serverless Relay");
      }
    } catch (e) {
      console.warn("[JYNX RELAY] REST upload unavailable; using MQTT fallback for this transfer.", e);
    }

    onStatus?.("Upload complete.", "staged");

    // 4. Publish to Global MQTT Cloud Relay
    if (payloadB64) {
      const mqttPublished = await this._publishToMqttCloud(code, payloadPackage);
      if (!serverlessOk && !mqttPublished) {
        throw new Error("Transfer relay unavailable. Please retry when the relay is online.");
      }
    }

    // 5. Broadcast to local tabs
    if (this.channel) {
      this.channel.postMessage({
        type: "JYNX_ROOM_ANNOUNCE",
        code: code,
        payload: { meta: manifest }
      });
    }

    // 6. Send Email/Gmail notification if recipient email was provided
    let emailStatus = null;
    if (receiverEmail) {
      onStatus?.(`Sending code notification email to ${receiverEmail}...`, "emailing");
      try {
        const shareUrl = `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(code)}`;
        let smtpConfig = null;
        try {
          const saved = localStorage.getItem("jynx-smtp-config");
          if (saved) smtpConfig = JSON.parse(saved);
        } catch (e) {}

        const emailRes = await fetch(`${this.apiBase}/api/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to_email: receiverEmail,
            code: code,
            share_url: shareUrl,
            manifest: manifest,
            smtp_config: smtpConfig
          })
        });

        const emailData = await emailRes.json().catch(() => ({}));
        if (!emailRes.ok || emailData.error) {
          throw new Error(emailData.error || `HTTP ${emailRes.status}`);
        }

        emailStatus = { success: true, recipient: receiverEmail, data: emailData };
        console.log("[JYNX EMAIL] Successfully sent email to", receiverEmail, emailData);
      } catch (e) {
        console.warn("[JYNX EMAIL] Failed to dispatch email notification", e);
        emailStatus = { success: false, recipient: receiverEmail, error: e.message };
      }

    }

    onStatus?.(`Ready on Global Relay! Share code: ${code} (Verification: ${verification})`, "ready");

    return {
      manifest,
      verification,
      encryptedData,
      totalSize: encryptedData.byteLength,
      emailStatus
    };
  }

  _uploadJsonWithProgress(url, body, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const startedAt = performance.now();
      xhr.open("POST", url);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const elapsedSec = (performance.now() - startedAt) / 1000;
        const speed = elapsedSec > 0 ? event.loaded / elapsedSec : 0;
        onProgress?.({
          transferred: event.loaded, totalBytes: event.total,
          percent: Math.round((event.loaded / event.total) * 100), speed,
          eta: speed > 0 ? (event.total - event.loaded) / speed : 0, elapsedSec
        });
      };
      xhr.onload = () => resolve(new Response(xhr.responseText, {
        status: xhr.status,
        headers: { "Content-Type": xhr.getResponseHeader("Content-Type") || "application/json" }
      }));
      xhr.onerror = () => reject(new Error("Cloud relay upload could not be reached."));
      xhr.ontimeout = () => reject(new Error("Cloud relay upload timed out."));
      xhr.timeout = 120000;
      xhr.send(body);
    });
  }

  getGmailComposeUrl({ to_email = "", code = "", share_url = "", manifest = {} }) {
    const subject = encodeURIComponent(`Jynx Transfer Ready: [${code}]`);
    let fileDesc = "Encrypted Confidential Message";
    if (manifest && manifest.type === "files") {
      fileDesc = `${manifest.filesCount || 1} encrypted file(s)`;
    }
    const body = encodeURIComponent(
      `Hello,\n\nI have sent you an end-to-end encrypted transfer via Jynx.\n\nPayload: ${fileDesc}\nAuthentication Code: ${code}\nDirect Download Link: ${share_url}\n\nEnter the authentication code on Jynx (or click the link) to decrypt and receive the transfer.\n\nSecured with PAKE AES-256-GCM encryption.`
    );
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to_email)}&su=${subject}&body=${body}`;
  }

  async _uploadR2(code, encryptedData, manifest, verification, mode, onStatus, onProgress) {
    onStatus?.("Preparing Cloudflare R2 multipart upload...", "uploading");
    const initRes = await fetch(`${this.apiBase}/api/relay/r2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "init", code, size: encryptedData.byteLength, manifest, verification,
        mode, ttl: 86400, max_downloads: 10
      })
    });
    if (!initRes.ok) {
      const detail = await initRes.json().catch(() => ({}));
      throw new Error(detail.error || "Cloudflare R2 is not configured for large transfers.");
    }
    const upload = await initRes.json();
    if (!Array.isArray(upload.urls) || !upload.partSize) {
      throw new Error("R2 returned an invalid multipart upload plan.");
    }
    const payloadBlob = new Blob([encryptedData], { type: "application/octet-stream" });
    const parts = [];
    try {
      const concurrency = Math.min(6, upload.urls.length);
      let nextPart = 0;
      let completedBytes = 0;
      const uploadPart = async () => {
        while (nextPart < upload.urls.length) {
          const index = nextPart++;
          const start = index * upload.partSize;
          const end = Math.min(start + upload.partSize, payloadBlob.size);
          if (!upload.urls[index] || !/^https:\/\//i.test(upload.urls[index])) {
            throw new Error(`R2 returned an invalid signed URL for part ${index + 1}.`);
          }
          let response;
          try {
            response = await fetch(upload.urls[index], {
              method: "PUT",
              mode: "cors",
              body: payloadBlob.slice(start, end)
            });
          } catch (err) {
            throw new Error(
              `R2 part ${index + 1} could not be reached from ${window.location.origin}. Check R2 CORS allows PUT from this exact origin and that the R2 endpoint is reachable.`
            );
          }
          if (!response.ok) throw new Error(`R2 upload failed at part ${index + 1} (HTTP ${response.status}).`);
          const etag = response.headers.get("etag");
          if (!etag) {
            throw new Error("R2 did not expose the ETag header. Add ETag to the bucket CORS ExposeHeaders setting.");
          }
          parts[index] = { partNumber: index + 1, etag };
          completedBytes += end - start;
          onProgress?.({
            transferred: completedBytes,
            totalBytes: payloadBlob.size,
            percent: Math.round((completedBytes / payloadBlob.size) * 100),
            speed: 0,
            eta: 0,
            elapsedSec: 0
          });
          onStatus?.(`Uploading to Cloudflare R2... ${Math.round((completedBytes / payloadBlob.size) * 100)}%`, "uploading");
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => uploadPart()));
    } catch (err) {
      await fetch(`${this.apiBase}/api/relay/r2`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "abort", code })
      }).catch(() => {});
      throw err;
    }
    const completeRes = await fetch(`${this.apiBase}/api/relay/r2`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete", code, size: payloadBlob.size, parts })
    });
    if (!completeRes.ok) {
      const detail = await completeRes.json().catch(() => ({}));
      throw new Error(detail.error || "Cloudflare R2 multipart completion failed.");
    }
  }

  async startReceive({ code, onProgress, onStatus }) {
    code = code.trim().toLowerCase();
    onStatus?.(`Connecting to Global Jynx Relay for room "${code}"...`, "connecting");

    let payloadPackage = null;
    const maxAttempts = 30; // Poll for up to 30 seconds if sender is still uploading
    let attempt = 0;

    while (attempt < maxAttempts && !payloadPackage) {
      attempt++;

      // Strategy 1: Local Session Mesh (Instant)
      try {
        const stored = sessionStorage.getItem(`jynx_payload_${code}`) || localStorage.getItem(`jynx_payload_${code}`);
        if (stored) {
          payloadPackage = JSON.parse(stored);
          break;
        }
      } catch (e) {}

      // Strategy 2: Vercel Serverless REST API
      try {
        const roomRes = await fetch(`${this.apiBase}/api/relay/room/${encodeURIComponent(code)}`);
        if (roomRes.ok) {
          const roomMeta = await roomRes.json();
          let ab = null;
          if (roomMeta.download_url) {
            const payloadRes = await fetch(roomMeta.download_url);
            if (payloadRes.ok) ab = await this._readDownload(payloadRes, onProgress, onStatus);
          } else {
            const payloadRes = await fetch(`${this.apiBase}/api/relay/payload/${encodeURIComponent(code)}`);
            if (payloadRes.ok) ab = await this._readDownload(payloadRes, onProgress, onStatus);
          }
          if (ab) {
            if (roomMeta.payloadSize && ab.byteLength !== roomMeta.payloadSize) {
              throw new Error(`Incomplete transfer: received ${ab.byteLength} of ${roomMeta.payloadSize} bytes.`);
            }
            payloadPackage = {
              data: this._uint8ArrayToBase64(new Uint8Array(ab)),
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
        const remaining = maxAttempts - attempt;
        onStatus?.(`Waiting for sender... ${remaining}s remaining`, "handshake");
        onProgress?.({
          transferred: attempt,
          totalBytes: maxAttempts,
          percent: Math.round((attempt / maxAttempts) * 100),
          speed: 0,
          eta: remaining,
          elapsedSec: attempt,
          waiting: true
        });
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!payloadPackage || !payloadPackage.data) {
      throw new Error(
        `Room "${code}" not found. Please ensure the sender clicked "SEND ENCRYPTED TEXT" or "SEND FILES" to open the transfer room.`
      );
    }

    // Decrypt and unpack
    const encryptedBytes = this._base64ToUint8Array(payloadPackage.data);
    const totalBytes = encryptedBytes.byteLength;
    onProgress?.({ transferred: totalBytes, totalBytes, percent: 100, speed: 0, eta: 0, elapsedSec: 0 });

    onStatus?.(`Decrypting ${JynxTools.formatBytes(totalBytes)} securely in browser...`, "decrypting");

    let decryptedBuffer;
    try {
      decryptedBuffer = await window.jynxCrypto.decrypt(encryptedBytes, code);
    } catch (err) {
      throw new Error("Decryption failed: Incorrect code phrase or corrupted payload.");
    }

    const manifest = payloadPackage.manifest;
    const verification = payloadPackage.verification;

    if (!manifest || typeof manifest !== "object") {
    throw new Error("Received payload metadata is missing or invalid.");
    }

    if (manifest.type === "text") {
      const decodedText = new TextDecoder().decode(decryptedBuffer);
      return {
        type: "text",
        text: decodedText,
        size: decryptedBuffer.byteLength,
        verification: verification || "VERIFIED"
      };
    } else {
      if (manifest.type !== "files") {
        throw new Error("Received payload metadata is missing or invalid.");
      }
      if (decryptedBuffer.byteLength < 4) {
        throw new Error("Received file package is corrupted or incomplete.");
      }
      const view = new DataView(decryptedBuffer);
      const manifestLen = view.getUint32(0, true);
      if (manifestLen <= 0 || manifestLen > decryptedBuffer.byteLength - 4) {
        throw new Error("Received file package is corrupted or incomplete.");
      }
      const manifestBytes = new Uint8Array(decryptedBuffer, 4, manifestLen);
      let manifestJson;
      try {
        manifestJson = JSON.parse(new TextDecoder().decode(manifestBytes));
      } catch {
        throw new Error("Received file manifest is corrupted.");
      }
      if (!Array.isArray(manifestJson.files)) {
        throw new Error("Received file manifest is invalid.");
      }

      const filesData = [];
      const payloadStart = 4 + manifestLen;

      for (const fMeta of manifestJson.files) {
        if (!fMeta || !Number.isSafeInteger(fMeta.offset) || !Number.isSafeInteger(fMeta.size) ||
            fMeta.offset < 0 || fMeta.size < 0 ||
            payloadStart + fMeta.offset + fMeta.size > decryptedBuffer.byteLength) {
          throw new Error("Received file data is corrupted or incomplete.");
        }
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

  async _readDownload(response, onProgress, onStatus) {
    const totalBytes = Number(response.headers.get("content-length")) || 0;
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      onProgress?.({
        transferred: buffer.byteLength,
        totalBytes: buffer.byteLength,
        percent: 100,
        speed: 0,
        eta: 0,
        elapsedSec: 0
      });
      return buffer;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let transferred = 0;
    const startedAt = performance.now();
    onStatus?.(`Downloading encrypted stream${totalBytes ? ` (${JynxTools.formatBytes(totalBytes)})` : ""}...`, "transferring");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      transferred += value.byteLength;
      const elapsedSec = (performance.now() - startedAt) / 1000;
      const speed = elapsedSec > 0 ? transferred / elapsedSec : 0;
      const percent = totalBytes ? Math.min(100, Math.round((transferred / totalBytes) * 100)) : 0;
      onProgress?.({ transferred, totalBytes, percent, speed, eta: speed && totalBytes ? Math.max(0, (totalBytes - transferred) / speed) : 0, elapsedSec });
    }
    const result = new Uint8Array(transferred);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    onProgress?.({
      transferred,
      totalBytes: totalBytes || transferred,
      percent: 100,
      speed: transferred / Math.max((performance.now() - startedAt) / 1000, 0.001),
      eta: 0,
      elapsedSec: (performance.now() - startedAt) / 1000
    });
    return result.buffer;
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
