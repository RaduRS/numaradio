export const AMBIENT_MIN = 12;
export const AMBIENT_MAX = 45;
export const AMBIENT_BUCKET_MS = 6 * 60 * 1000;

// Hour of day (UTC) where the sine hits its peak; trough is 12 hours earlier.
const PEAK_HOUR_UTC = 20;

// Per-bucket jitter amplitude. Sine amplitude is reduced by this much so
// jitter + sine together always stay inside [MIN, MAX] without clamping.
const JITTER_AMP = 4;

// Deterministic [0, 1) from a 32-bit seed (mulberry32).
function hash01(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Pseudo-random but deterministic ambient listener count for the public
 * hero. Replaces a fixed +15 boost — the number now drifts with time-of-day
 * (low late night / high evening) and jumps to a fresh value every 6 min,
 * so the frontend doesn't look frozen to someone watching it.
 *
 * Every client that hits the API within the same 6-min window sees the same
 * number. No timer, no DB, no cache — each request self-computes.
 */
export function ambientFloor(nowMs: number): number {
  const mid = (AMBIENT_MIN + AMBIENT_MAX) / 2;
  const amp = (AMBIENT_MAX - AMBIENT_MIN) / 2;

  // Snap to the bucket start so sine + jitter are identical for every
  // request inside the same 6-min window (stable display, no sub-bucket drift).
  const bucket = Math.floor(nowMs / AMBIENT_BUCKET_MS);
  const bucketStartMs = bucket * AMBIENT_BUCKET_MS;

  const d = new Date(bucketStartMs);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;

  // Cosine phased so peak is at PEAK_HOUR_UTC, trough 12 hours earlier.
  const phase = ((hour - PEAK_HOUR_UTC) * Math.PI) / 12;
  const sine = Math.cos(phase); // +1 at peak, −1 at trough

  const base = mid + (amp - JITTER_AMP) * sine;
  const jitter = (hash01(bucket) - 0.5) * 2 * JITTER_AMP;

  const val = Math.round(base + jitter);
  return Math.max(AMBIENT_MIN, Math.min(AMBIENT_MAX, val));
}
