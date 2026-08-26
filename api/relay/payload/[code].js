// Vercel Serverless Function: GET /api/relay/payload/[code]
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
  const key = roomKey(cleanCode);
  const room = await redis.get(key);

  if (!room || !room.payload_b64 || Date.now() > room.expiresAt) {
    if (room && room.r2Status === "complete" && r2Configured && Date.now() <= room.expiresAt) {
      const downloadUrl = await getSignedUrl(r2, new GetObjectCommand({
        Bucket: r2Bucket, Key: room.objectKey
      }), { expiresIn: 3600 });
      return res.redirect(302, downloadUrl);
    }
    return res.status(404).json({ error: "Payload not found or expired" });
  }

  room.downloads = (room.downloads || 0) + 1;

  // Re-save the updated download count, keeping the remaining TTL.
  const remainingTtl = Math.max(1, Math.floor((room.expiresAt - Date.now()) / 1000));
  await redis.set(key, room, { ex: remainingTtl });

  const binaryBuffer = Buffer.from(room.payload_b64, "base64");

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", binaryBuffer.length);
  return res.status(200).send(binaryBuffer);
}
