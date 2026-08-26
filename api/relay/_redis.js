// Shared Upstash Redis client for all relay functions.
// Vercel auto-injects KV_REST_API_URL / KV_REST_API_TOKEN (or
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) once you attach
// an Upstash Redis database to this project in the Vercel dashboard.
//
// If Redis is NOT configured, we transparently fall back to the serverless
// instance's in-memory heap so the relay keeps working out-of-the-box.
// Note: in-memory rooms are lost if the function instance recycles.
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const useRedis = Boolean(url && token);

/** In-memory fallback that mimics the subset of the Upstash API we use. */
function createMemoryStore() {
  const store = new Map();

  return {
    async set(key, value, opts) {
      const ttlMs = (opts && opts.ex ? opts.ex : 86400) * 1000;
      const rec = { value, expiresAt: Date.now() + ttlMs };
      store.set(key, rec);
      return value;
    },

    async get(key) {
      const rec = store.get(key);
      if (!rec) return null;
      if (Date.now() > rec.expiresAt) {
        store.delete(key);
        return null;
      }
      return rec.value;
    },

    async keys(pattern) {
      if (pattern && typeof pattern === "string") {
        // Support the simple "jynx:room:*" glob used by stats.
        const prefix = pattern.split("*")[0];
        const keys = [];
        for (const k of store.keys()) {
          if (prefix && !k.startsWith(prefix)) continue;
          if (Date.now() > store.get(k).expiresAt) {
            store.delete(k);
            continue;
          }
          keys.push(k);
        }
        return keys;
      }
      return Array.from(store.keys());
    }
  };
}

export const redis = useRedis ? new Redis({ url, token }) : createMemoryStore();

export const usingFallbackStore = !useRedis;

if (!useRedis) {
  console.error(
    "[JYNX RELAY] Redis not configured — using in-memory fallback store. " +
    "Attach an Upstash Redis database in the Vercel dashboard (Storage tab) to persist rooms."
  );
}

const ROOM_PREFIX = "jynx:room:";

export function roomKey(code) {
  return ROOM_PREFIX + code.trim().toLowerCase();
}

export function setCorsHeaders(req, res, methods) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
