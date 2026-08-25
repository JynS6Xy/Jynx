// Shared Upstash Redis client for all relay functions.
// Vercel auto-injects KV_REST_API_URL / KV_REST_API_TOKEN (or
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) once you attach
// an Upstash Redis database to this project in the Vercel dashboard.
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error(
    "[JYNX RELAY] Missing Redis credentials. Attach an Upstash Redis database " +
    "to this project in the Vercel dashboard (Storage tab) so KV_REST_API_URL " +
    "and KV_REST_API_TOKEN are set."
  );
}

export const redis = new Redis({ url, token });

const ROOM_PREFIX = "jynx:room:";

export function roomKey(code) {
  return ROOM_PREFIX + code.trim().toLowerCase();
}

export function setCorsHeaders(req, res, methods) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
