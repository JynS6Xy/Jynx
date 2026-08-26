// Vercel Serverless Function: POST /api/relay/upload
import { redis, roomKey, setCorsHeaders } from "./_redis.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { code, manifest, verification, payload_b64, mode, ttl, max_downloads } = req.body || {};
    if (!code || !payload_b64) {
      return res.status(400).json({ error: "Missing code or payload" });
    }

    const cleanCode = code.trim().toLowerCase();
    const ttlSeconds = ttl || 86400;

    // Check payload size in bytes (base64 string length * 3/4 approx)
    const MAX_B64_LEN = Math.ceil(50 * 1024 * 1024 * 4 / 3);
    if (payload_b64 && payload_b64.length > MAX_B64_LEN + 1000) {
      return res.status(400).json({ error: "Payload exceeds maximum size limit of 50 MB" });
    }

    const room = {
      code: cleanCode,
      manifest: manifest || {},
      verification: verification || "",
      payload_b64: payload_b64,
      mode: mode || "files",
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlSeconds * 1000,
      downloads: 0,
      max_downloads: max_downloads || 10
    };

    // EX sets the key's TTL directly in Redis, so expired rooms are
    // automatically evicted without any manual pruning job.
    await redis.set(roomKey(cleanCode), room, { ex: ttlSeconds });

    console.log(`[JYNX RELAY] Room ${cleanCode} stored in Redis (ttl ${ttlSeconds}s).`);

    return res.status(201).json({
      status: "STORED",
      code: cleanCode,
      bytes: payload_b64.length,
      expires_in: ttlSeconds
    });
  } catch (err) {
    console.error("[JYNX RELAY] upload error:", err);
    return res.status(500).json({ error: err.message });
  }
}
