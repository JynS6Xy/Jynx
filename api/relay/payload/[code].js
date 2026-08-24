// Vercel Serverless Function: GET /api/relay/payload/[code]
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

  if (!room || !room.payload_b64 || Date.now() > room.expiresAt) {
    return res.status(404).json({ error: "Payload not found or expired" });
  }

  room.downloads = (room.downloads || 0) + 1;

  const binaryBuffer = Buffer.from(room.payload_b64, "base64");

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", binaryBuffer.length);
  return res.status(200).send(binaryBuffer);
}
