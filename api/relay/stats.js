// Vercel Serverless Function: GET /api/relay/stats
import { redis, usingFallbackStore, setCorsHeaders } from "./_redis.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // KEYS is fine at this scale (short-lived rooms with TTLs, low volume).
  // If this project grows a lot, swap to a maintained counter instead.
  const keys = await redis.keys("jynx:room:*");

  return res.status(200).json({
    active_rooms: keys.length,
    status: "ONLINE",
    relay: "Vercel Cloud",
    database: usingFallbackStore ? "In-memory (no Redis attached)" : "Upstash Redis"
  });
}
