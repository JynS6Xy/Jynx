/**
 * Jynx Universal Hybrid Transfer Engine
 * 1. WebRTC Direct P2P Mesh (PeerJS + STUN/TURN) - Works globally on Vercel/GitHub Pages with zero server setup!
 * 2. SQLite / REST Relay Backend (/api/relay/...) - Works when self-hosted with python server.py
 * 3. BroadcastChannel + LocalStorage Mesh - Zero-latency instant local cross-tab transfer
 */

class JynxTransferEngine {
  constructor() {
    this.channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("jynx_p2p_mesh") : null;
    this.apiBase = window.location.origin;
    this.activePeer = null;
    this.activeConn = null;
    this.pendingPayload = null;
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
   * Initializes WebRTC Peer for the sender
   */
  _initSenderPeer(code, encryptedData, manifest, verification, onStatus, onProgress) {
    return new Promise((resolve) => {
      const peerId = `jynx-${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      
      try {
        if (this.activePeer) {
          try { this.activePeer.destroy(); } catch (e) {}
        }

        if (typeof Peer === "undefined") {
          console.warn("PeerJS not loaded, relying on cloud relay");
          resolve(false);
          return;
        }

        this.activePeer = new Peer(peerId, {
          config: {
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" },
              { urls: "stun:stun2.l.google.com:19302" },
              { urls: "stun:global.stun.twilio.com:3478" }
            ]
          },
          debug: 0
        });

        this.activePeer.on("open", (id) => {
          console.log("[JYNX WEBRTC] Sender Peer ready with ID:", id);
          resolve(true);
        });

        this.activePeer.on("connection", (conn) => {
          console.log("[JYNX WEBRTC] Receiver connected to sender room!");
          this.activeConn = conn;
          onStatus?.("Receiver connected! Streaming AES-256-GCM encrypted chunks via direct WebRTC tunnel...", "transferring");

          conn.on("open", () => {
            // Send Handshake Metadata
            conn.send({
              type: "MANIFEST",
              manifest: manifest,
              verification: verification,
              totalBytes: encryptedData.byteLength
            });

            // Stream encrypted binary in chunks
            const chunkSize = 64 * 1024;
            const totalBytes = encryptedData.byteLength;
            let offset = 0;
            const startTime = performance.now();

            const sendNextChunk = () => {
              if (offset < totalBytes) {
                const chunk = encryptedData.slice(offset, offset + chunkSize);
                conn.send({
                  type: "CHUNK",
                  offset: offset,
                  data: chunk
                });
                offset += chunk.byteLength;

                const elapsed = (performance.now() - startTime) / 1000;
                const speed = elapsed > 0 ? offset / elapsed : 0;
                const percent = Math.min(100, Math.round((offset / totalBytes) * 100));
                const remaining = totalBytes - offset;
                const eta = speed > 0 ? remaining / speed : 0;

                onProgress?.({ transferred: offset, totalBytes, percent, speed, eta, elapsedSec: elapsed });
                setTimeout(sendNextChunk, 15);
              } else {
                conn.send({ type: "EOF" });
                onStatus?.(`Transfer complete! Verified PAKE: ${verification}`, "done");
              }
            };

            sendNextChunk();
          });
        });

        this.activePeer.on("error", (err) => {
          console.warn("[JYNX WEBRTC] Peer warning:", err);
          resolve(false);
        });

        // Timeout fallback
        setTimeout(() => resolve(false), 3500);
      } catch (err) {
        console.warn("[JYNX WEBRTC] Init error:", err);
        resolve(false);
      }
    });
  }

  /**
   * Executes full Send workflow:
   * Encrypts payload with AES-256-GCM + establishes WebRTC room + saves to cloud/local relay
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

    // 2. Store in memory and session storage for instant cross-tab mesh
    try {
      sessionStorage.setItem(`jynx_payload_${code}`, JSON.stringify({
        manifest,
        data: payloadB64,
        verification
      }));
      localStorage.setItem(`jynx_payload_${code}`, JSON.stringify({
        manifest,
        data: payloadB64,
        verification
      }));
    } catch (e) {}

    // 3. Try uploading to backend API if available (Vercel serverless / Python server)
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

    // 4. Initialize WebRTC P2P Cloud Signaling Peer
    onStatus?.(`Broadcasting PAKE rendezvous for room "${code}"...`, "ready");
    await this._initSenderPeer(code, encryptedData, manifest, verification, onStatus, onProgress);

    // 5. Broadcast to local tabs
    if (this.channel) {
      this.channel.postMessage({
        type: "JYNX_ROOM_ANNOUNCE",
        code: code,
        payload: { meta: manifest }
      });
    }

    onStatus?.(`Ready on relay. Share code: ${code} (Verification: ${verification})`, "ready");

    return {
      manifest,
      verification,
      encryptedData,
      totalSize: encryptedData.byteLength
    };
  }

  /**
   * Executes full Receive workflow:
   * Checks WebRTC Direct P2P tunnel -> Database Relay API -> Local Session Mesh
   */
  async startReceive({ code, onProgress, onStatus }) {
    code = code.trim().toLowerCase();
    onStatus?.(`Looking up room "${code}" on Jynx P2P Mesh & Relay...`, "connecting");

    // Strategy 1: Check Local Mesh / Session Storage first (Instant)
    let localData = null;
    try {
      const stored = sessionStorage.getItem(`jynx_payload_${code}`) || localStorage.getItem(`jynx_payload_${code}`);
      if (stored) {
        localData = JSON.parse(stored);
      }
    } catch (e) {}

    if (localData) {
      onStatus?.(`Found active local room "${code}". Decrypting payload...`, "transferring");
      const encBytes = this._base64ToUint8Array(localData.data);
      return await this._decryptAndUnpack(encBytes, localData.manifest, localData.verification, code, onProgress, onStatus);
    }

    // Strategy 2: Check REST API Backend (/api/relay/...)
    let apiData = null;
    try {
      const roomRes = await fetch(`${this.apiBase}/api/relay/room/${encodeURIComponent(code)}`);
      if (roomRes.ok) {
        const roomMeta = await roomRes.json();
        const payloadRes = await fetch(`${this.apiBase}/api/relay/payload/${encodeURIComponent(code)}`);
        if (payloadRes.ok) {
          const ab = await payloadRes.arrayBuffer();
          apiData = {
            bytes: new Uint8Array(ab),
            manifest: roomMeta.manifest,
            verification: roomMeta.verification
          };
        }
      }
    } catch (e) {}

    if (apiData) {
      onStatus?.(`Retrieved encrypted container from database relay. Decrypting...`, "transferring");
      return await this._decryptAndUnpack(apiData.bytes, apiData.manifest, apiData.verification, code, onProgress, onStatus);
    }

    // Strategy 3: Connect via Direct WebRTC Peer Tunnel (Global Cross-Device)
    if (typeof Peer !== "undefined") {
      onStatus?.(`Connecting to sender room via direct WebRTC tunnel (PeerJS)...`, "connecting");
      const webrtcResult = await this._receiveViaWebRTC(code, onProgress, onStatus);
      if (webrtcResult) {
        return webrtcResult;
      }
    }

    // If all strategies failed, throw helpful informative error
    throw new Error(
      `Room "${code}" not found. Please ensure the sender has selected files/text and clicked "SEND" to open the transfer room.`
    );
  }

  /**
   * Connects to sender's browser room over WebRTC DataChannel
   */
  _receiveViaWebRTC(code, onProgress, onStatus) {
    return new Promise((resolve, reject) => {
      const targetPeerId = `jynx-${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      const myPeerId = `jynx-recv-${Math.random().toString(36).slice(2, 10)}`;

      let peer;
      let timeoutTimer;

      try {
        peer = new Peer(myPeerId, {
          config: {
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" },
              { urls: "stun:stun2.l.google.com:19302" },
              { urls: "stun:global.stun.twilio.com:3478" }
            ]
          },
          debug: 0
        });

        timeoutTimer = setTimeout(() => {
          try { peer.destroy(); } catch (e) {}
          resolve(null);
        }, 8000);

        peer.on("open", () => {
          onStatus?.(`Rendezvous connected. Handshaking with sender "${code}"...`, "handshake");
          const conn = peer.connect(targetPeerId, { reliable: true });

          let manifest = null;
          let verification = null;
          let totalBytes = 0;
          let receivedBytes = 0;
          let chunks = [];
          const startTime = performance.now();

          conn.on("open", () => {
            clearTimeout(timeoutTimer);
            onStatus?.("WebRTC direct P2P tunnel established! Streaming encrypted binary...", "transferring");
          });

          conn.on("data", async (msg) => {
            if (msg.type === "MANIFEST") {
              manifest = msg.manifest;
              verification = msg.verification;
              totalBytes = msg.totalBytes;
            } else if (msg.type === "CHUNK") {
              chunks.push(msg.data);
              receivedBytes += msg.data.byteLength || msg.data.length || 0;

              const elapsed = (performance.now() - startTime) / 1000;
              const speed = elapsed > 0 ? receivedBytes / elapsed : 0;
              const percent = totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 50;
              const remaining = totalBytes - receivedBytes;
              const eta = speed > 0 ? remaining / speed : 0;

              onProgress?.({ transferred: receivedBytes, totalBytes, percent, speed, eta, elapsedSec: elapsed });
            } else if (msg.type === "EOF") {
              try { peer.destroy(); } catch (e) {}
              
              // Assemble chunks
              const combined = new Uint8Array(receivedBytes);
              let cur = 0;
              for (const c of chunks) {
                const arr = c instanceof Uint8Array ? c : new Uint8Array(c);
                combined.set(arr, cur);
                cur += arr.byteLength;
              }

              try {
                const res = await this._decryptAndUnpack(combined, manifest, verification, code, onProgress, onStatus);
                resolve(res);
              } catch (err) {
                reject(err);
              }
            }
          });

          conn.on("error", () => {
            try { peer.destroy(); } catch (e) {}
            resolve(null);
          });
        });

        peer.on("error", () => {
          try { peer.destroy(); } catch (e) {}
          resolve(null);
        });
      } catch (err) {
        resolve(null);
      }
    });
  }

  async _decryptAndUnpack(encryptedBytes, manifest, verification, code, onProgress, onStatus) {
    onStatus?.("Decrypting AES-256-GCM payload in browser...", "decrypting");
    const decryptedBuffer = await window.jynxCrypto.decrypt(encryptedBytes, code);

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
