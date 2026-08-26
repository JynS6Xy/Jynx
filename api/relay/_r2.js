import { S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

const rawEndpoint = process.env.R2_ENDPOINT || (
  process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : ""
);
const endpoint = rawEndpoint.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
const accessKeyId = (process.env.R2_ACCESS_KEY_ID || "").trim();
const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
const bucket = (process.env.R2_BUCKET || "").trim();

let endpointError = "";
try {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:") endpointError = "R2_ENDPOINT must use https://";
} catch {
  endpointError = "R2_ENDPOINT must be a complete URL such as https://ACCOUNT_ID.r2.cloudflarestorage.com";
}
if (endpoint.includes("<") || endpoint.includes(">")) {
  endpointError = "R2_ENDPOINT still contains the placeholder account ID";
}

export const r2Configured = !endpointError && Boolean(endpoint && accessKeyId && secretAccessKey && bucket);
export const r2ConfigError = endpointError || "R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET are required";
export const r2Bucket = bucket;
export const r2 = r2Configured
  ? new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    })
  : null;

export function objectKey(code) {
  return `jynx/${code.trim().toLowerCase()}/${randomUUID()}.payload`;
}
