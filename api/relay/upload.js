// Vercel Serverless Function: POST /api/relay/upload
let rooms = global._jynxRooms || (global._jynxRooms = new Map());

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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
    rooms.set(cleanCode, {
      code: cleanCode,
      manifest: manifest || {},
      verification: verification || "",
      payload_b64: payload_b64,
      mode: mode || "files",
      createdAt: Date.now(),
      expiresAt: Date.now() + (ttl || 86400) * 1000,
      downloads: 0,
      max_downloads: max_downloads || 10
    });

    console.log(`[JYNX RELAY] Room ${cleanCode} created in memory.`);

    return res.status(201).json({
      status: "STORED",
      code: cleanCode,
      bytes: payload_b64.length,
      expires_in: ttl || 86400
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
