import { S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;

export const r2Configured = Boolean(
  R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET
);

export const r2Bucket = R2_BUCKET;
export const r2 = r2Configured
  ? new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY
      }
    })
  : null;

export function objectKey(code) {
  return `jynx/${code.trim().toLowerCase()}/${randomUUID()}.payload`;
}
