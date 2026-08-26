// Vercel Serverless Function: GET /api/relay/room/[code]
import { redis, roomKey, setCorsHeaders } from "../_redis.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, r2Bucket, r2Configured } from "../_r2.js";

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

  const result = {
    code: room.code,
    manifest: room.manifest,
    verification: room.verification,
    mode: room.mode,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt
  };
  if (room.r2Status === "complete" && r2Configured) {
    result.download_url = await getSignedUrl(r2, new GetObjectCommand({
      Bucket: r2Bucket, Key: room.objectKey
    }), { expiresIn: 3600 });
  }
  return res.status(200).json(result);
}
