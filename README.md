# Jynx — Fast, Simple, Secure P2P File & Secret Transfer

> End-to-end encrypted peer-to-peer file sharing between any two computers, browsers, or terminal CLI instances using Password-Authenticated Key Exchange (PAKE).

![Jynx Web Preview](assets/logo.svg)

---

## ⚡ Features

- **Zero-Knowledge PAKE (SPAKE2)**: Sender and receiver establish mutually authenticated 256-bit AES-GCM symmetric session keys using pronounceable 3-word code phrases (e.g. `7492-velvet-falcon`).
- **End-to-End Encryption**: All data is encrypted and decrypted in-browser via the standard **Web Crypto API** (AES-256-GCM + PBKDF2 with 100,000 iterations).
- **Persistent SQLite Relay Backend**: Zero-config Python server with SQLite storage for cross-device, cross-network transfers with automatic TTL pruning.
- **Cross-Tab & Local Mesh**: Instant zero-latency peer transfer using `BroadcastChannel` and `localStorage` signaling.
- **Multiple File & Folder Support**: Drag & drop multi-file archives, individual file removals, and batch downloads.
- **Confidential Text Composer**: Encrypted secret notes and code snippet sharing.
- **Dynamic QR Codes**: Instant standalone SVG QR matrix generator for mobile camera scans.
- **Interactive Visualizers**: Live animated packet flow diagrams and key derivation inspectors.
- **Terminal CLI Interoperability**: Seamless cross-platform support with native terminal clients.

---

## 🚀 Quick Start (Local Run)

### 1. Clone the repository
```bash
git clone https://github.com/JynS6Xy/Jynx.git
cd Jynx
```

### 2. Start the Relay Server
```bash
python server.py
```

### 3. Open in Browser
Visit **`http://localhost:8099/`** to start sending and receiving files!

---

## 🌐 Free 1-Click Deployment

### Deploy on Render / Railway / Fly.io
- **Runtime**: `Python 3`
- **Start Command**: `python server.py`

### Deploy Frontend on GitHub Pages / Netlify / Vercel
- Simply drag & drop or point to the root directory `index.html`.

---

## 🔒 Security Architecture

```
[ Alice (Sender) ]                  [ Jynx Relay ]                  [ Bob (Receiver) ]
        |                                 |                                 |
        |--- 1. Announce Room (PAKE) ---->|                                 |
        |                                 |<--- 2. Request Rendezvous ------|
        |<============= 3. Authenticated SPAKE2 Key Agreement =============>|
        |                                                                   |
        |============ 4. Direct AES-256-GCM Encrypted Binary =============>|
```

- **Cipher**: AES-256-GCM (128-bit authentication tag, 96-bit random IV, 128-bit random salt)
- **Key Derivation**: PBKDF2-HMAC-SHA256 (100,000 rounds)
- **Escrow**: None. The relay server never possesses or derives the encryption keys.

---

## 📄 License
MIT License &copy; 2026 Jynx Project.
