import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { redis, roomKey, setCorsHeaders, usingFallbackStore } from "./_redis.js";
import { objectKey, r2, r2Bucket, r2Configured, r2ConfigError } from "./_r2.js";

const MAX_SIZE = 1024 * 1024 * 1024;
const PART_SIZE = 10 * 1024 * 1024;

export default async function handler(req, res) {
  setCorsHeaders(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!r2Configured) return res.status(503).json({ error: `Cloudflare R2 configuration error: ${r2ConfigError}` });
  if (usingFallbackStore) {
    return res.status(503).json({
      error: "Persistent room storage is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN) to Vercel."
    });
  }

  try {
    const body = req.body || {};
    const action = body.action;
    const code = String(body.code || "").trim().toLowerCase();
    if (!code) return res.status(400).json({ error: "Missing code" });

    if (action === "init") {
      const size = Number(body.size);
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SIZE) {
        return res.status(400).json({ error: "Payload must be between 1 byte and 1 GB" });
      }
      const key = objectKey(code);
      const created = await r2.send(new CreateMultipartUploadCommand({
        Bucket: r2Bucket,
        Key: key,
        ContentType: "application/octet-stream"
      }));
      const partCount = Math.ceil(size / PART_SIZE);
      const urls = [];
      for (let partNumber = 1; partNumber <= partCount; partNumber++) {
        urls.push(await getSignedUrl(r2, new UploadPartCommand({
          Bucket: r2Bucket, Key: key, UploadId: created.UploadId, PartNumber: partNumber
        }), { expiresIn: 3600 }));
      }
      const ttl = Math.min(Number(body.ttl) || 86400, 86400 * 7);
      await redis.set(roomKey(code), {
        code, manifest: body.manifest || {}, verification: body.verification || "",
        mode: body.mode || "files", objectKey: key, uploadId: created.UploadId,
        r2Status: "uploading", createdAt: Date.now(), expiresAt: Date.now() + ttl * 1000,
        downloads: 0, max_downloads: body.max_downloads || 10
      }, { ex: ttl });
      return res.status(201).json({ uploadId: created.UploadId, key, partSize: PART_SIZE, urls });
    }

    const room = await redis.get(roomKey(code));
    if (!room || room.r2Status !== "uploading" || !room.uploadId) {
      return res.status(404).json({ error: "Multipart upload not found" });
    }

    if (action === "complete") {
      const parts = Array.isArray(body.parts) ? body.parts : [];
      if (!parts.length || parts.some((part) => (
        !Number.isInteger(Number(part.partNumber)) ||
        Number(part.partNumber) < 1 ||
        !part.etag
      ))) {
        return res.status(400).json({ error: "Missing or invalid uploaded part ETags" });
      }
      await r2.send(new CompleteMultipartUploadCommand({
        Bucket: r2Bucket, Key: room.objectKey, UploadId: room.uploadId,
        MultipartUpload: { Parts: parts.map(p => ({ PartNumber: Number(p.partNumber), ETag: p.etag })) }
      }));
      room.r2Status = "complete";
      delete room.uploadId;
      const ttl = Math.max(1, Math.floor((room.expiresAt - Date.now()) / 1000));
      await redis.set(roomKey(code), room, { ex: ttl });
      return res.status(200).json({ status: "STORED", code, bytes: body.size || null });
    }

    if (action === "abort") {
      await r2.send(new AbortMultipartUploadCommand({
        Bucket: r2Bucket, Key: room.objectKey, UploadId: room.uploadId
      }));
      return res.status(204).end();
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("[JYNX R2] multipart error:", err);
    return res.status(502).json({
      error: `Multipart upload failed${err?.message ? `: ${err.message}` : ""}`
    });
  }
}
