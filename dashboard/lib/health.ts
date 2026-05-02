import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getDbPool } from "./db";

export interface HealthPing {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export async function checkNeon(timeoutMs = 2_000): Promise<HealthPing> {
  const start = Date.now();
  try {
    const pool = getDbPool();
    const query: Promise<HealthPing> = pool
      .query("SELECT 1 AS ok")
      .then(() => ({ ok: true, latencyMs: Date.now() - start }));
    const timeout = new Promise<HealthPing>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: `timeout after ${timeoutMs}ms` }), timeoutMs),
    );
    return await Promise.race([query, timeout]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "query failed" };
  }
}

let s3: S3Client | null = null;
function getS3(): S3Client {
  if (s3) return s3;
  s3 = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.B2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.B2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return s3;
}

// In-memory TTL cache for the B2 health probe. /api/status is polled
// every 5s by the dashboard, which would otherwise translate to ~17,280
// HeadObject ops/day against B2 — well above the free Class C cap and
// pure waste because B2 outages don't change minute-to-minute. Cache
// the result for 60s; if B2 went down inside that window we'll find
// out within a minute.
const B2_HEALTH_TTL_MS = 60_000;
let b2HealthCache: { at: number; result: HealthPing } | null = null;

export async function checkB2(timeoutMs = 2_000): Promise<HealthPing> {
  const now = Date.now();
  if (b2HealthCache && now - b2HealthCache.at < B2_HEALTH_TTL_MS) {
    return b2HealthCache.result;
  }
  const start = now;
  const bucket = process.env.B2_BUCKET_NAME;
  if (!bucket) {
    const r: HealthPing = { ok: false, error: "B2_BUCKET_NAME not set" };
    b2HealthCache = { at: now, result: r };
    return r;
  }
  let result: HealthPing;
  try {
    const cmd = new HeadObjectCommand({ Bucket: bucket, Key: "healthcheck.txt" });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      await getS3().send(cmd, { abortSignal: ctl.signal });
      result = { ok: true, latencyMs: Date.now() - start };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    const status = err.$metadata?.httpStatusCode;
    result = status === 404
      ? { ok: true, latencyMs: Date.now() - start }
      : { ok: false, error: err.name ?? err.Code ?? "unknown" };
  }
  b2HealthCache = { at: now, result };
  return result;
}
