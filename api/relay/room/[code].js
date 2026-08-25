// Vercel Serverless Function: GET /api/relay/room/[code]
import { redis, roomKey, setCorsHeaders } from "../_redis.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: "Missing code query param" });
  }

  const cleanCode = code.trim().toLowerCase();
  const room = await redis.get(roomKey(cleanCode));

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
