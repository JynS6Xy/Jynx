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
- **Cloudflare R2 Multipart Relay**: Encrypted transfers up to 1 GB upload directly from the browser in 10 MB parts, avoiding Vercel request limits.
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

### ⚡ Auto-Deploy to Vercel on every `git push` (GitHub Actions)
This repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that deploys **to Vercel automatically on every push to `main`**. One-time setup:

1. **Create a Vercel Access Token**
   - Go to [vercel.com/account/tokens](https://vercel.com/account/tokens) → **Create Token** → copy it.

2. **Find your project IDs**
   - Install the Vercel CLI: `npm i -g vercel`
   - In the repo root run `vercel link` (or `vercel` on first deploy) to create the project.
   - Then run `vercel env pull` to generate `.vercel/project.json` containing `projectId` and the `orgId`.

3. **Add GitHub repository secrets** (Settings → Secrets and variables → Actions):
   - `VERCEL_TOKEN` = your access token
   - `VERCEL_ORG_ID` = the `orgId`
   - `VERCEL_PROJECT_ID` = the `projectId`

4. **Push once** (`git push origin main`) — the workflow builds and runs `vercel --prod`. Every subsequent push re-deploys automatically. 🚀

> Tip: commit messages containing `[skip ci]` will skip the auto-deploy.

### Cloudflare R2 (large transfers)

Transfers larger than 45 MB use browser-to-R2 multipart uploads. Add these Vercel
environment variables: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
and `R2_BUCKET`. The R2 bucket must allow CORS `PUT` and `GET` from your Vercel
origin and expose the `ETag` response header. The existing Upstash Redis
variables remain required for room metadata persistence.

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
