// Vercel Serverless Global In-Memory Room Relay
let rooms = global._jynxRooms || (global._jynxRooms = new Map());

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { path } = req.query;

  // POST /api/relay/upload
  if (req.method === "POST") {
    const { code, manifest, verification, payload_b64, mode, ttl } = req.body || {};
    if (!code) return res.status(400).json({ error: "Missing code" });

    rooms.set(code.toLowerCase().trim(), {
      manifest,
      verification,
      payload_b64,
      mode: mode || "files",
      createdAt: Date.now(),
      expiresAt: Date.now() + (ttl || 86400) * 1000,
      downloads: 0
    });

    return res.status(201).json({ status: "STORED", code, bytes: payload_b64 ? payload_b64.length : 0 });
  }

  // GET /api/relay/stats
  if (req.method === "GET" && req.url.includes("stats")) {
    return res.status(200).json({
      active_rooms: rooms.size,
      status: "ONLINE",
      relay: "Vercel Edge Cloud"
    });
  }

  return res.status(404).json({ error: "Not found" });
}
