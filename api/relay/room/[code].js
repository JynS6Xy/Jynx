// Vercel Serverless Function: GET /api/relay/room/[code]
let rooms = global._jynxRooms || (global._jynxRooms = new Map());

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: "Missing code query param" });
  }

  const cleanCode = code.trim().toLowerCase();
  const room = rooms.get(cleanCode);

  if (!room || Date.now() > room.expiresAt) {
    return res.status(404).json({ error: "Room not found or expired" });
  }

  return res.status(200).json({
    code: room.code,
    manifest: room.manifest,
    verification: room.verification,
    mode: room.mode,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt
  });
}
