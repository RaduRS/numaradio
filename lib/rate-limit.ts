import { createHash } from "node:crypto";
import { prisma } from "./db/index.ts";

const HOUR_LIMIT = 3;
const DAY_LIMIT = 10;

/**
 * Hash a raw IP with a server-side salt so the DB only stores an opaque token.
 * Salt defaults to INTERNAL_API_SECRET (already shared across machines) so the
 * same hash is stable across Vercel function invocations.
 */
export function hashIp(ip: string): string {
  const salt = process.env.INTERNAL_API_SECRET ?? "nasalt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/**
 * Best-effort client IP from Vercel / proxy headers.
 *
 * Prefer headers that the platform writes from scratch and clients can't
 * inject into. A raw `x-forwarded-for` first-value read lets anyone spoof
 * their rate-limit bucket by prepending a fake IP — don't do that.
 *
 * Order:
 *   1. cf-connecting-ip     — Cloudflare-set; CF strips any client-sent copy
 *   2. x-real-ip            — Vercel-set single value (connecting IP)
 *   3. x-vercel-forwarded-for — Vercel-platform header, not user-settable
 *   4. x-forwarded-for      — last-resort, take LAST hop (each proxy appends
 *                             on the right; a prepended fake stays to the
 *                             left of the real entry)
 *   5. "unknown"            — everyone shares a bucket
 */
export function clientIpFromRequest(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();

  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return "unknown";
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds?: number;
  reason?: "hour_limit" | "day_limit";
  hourCount: number;
  dayCount: number;
}

/**
 * Counts Shoutout rows matching this ipHash in the last hour and last 24h.
 * Blocks if either threshold is exceeded.
 */
export async function checkShoutoutRateLimit(ipHash: string): Promise<RateLimitResult> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [hourCount, dayCount] = await Promise.all([
    prisma.shoutout.count({
      where: { ipHash, createdAt: { gte: hourAgo } },
    }),
    prisma.shoutout.count({
      where: { ipHash, createdAt: { gte: dayAgo } },
    }),
  ]);

  if (hourCount >= HOUR_LIMIT) {
    const oldest = await prisma.shoutout.findFirst({
      where: { ipHash, createdAt: { gte: hourAgo } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const waitUntil = oldest ? oldest.createdAt.getTime() + 60 * 60 * 1000 : now.getTime() + 60 * 60 * 1000;
    return {
      ok: false,
      reason: "hour_limit",
      retryAfterSeconds: Math.max(60, Math.ceil((waitUntil - now.getTime()) / 1000)),
      hourCount,
      dayCount,
    };
  }
  if (dayCount >= DAY_LIMIT) {
    return {
      ok: false,
      reason: "day_limit",
      retryAfterSeconds: 60 * 60 * 6, // come back in 6h; precise time isn't worth the query
      hourCount,
      dayCount,
    };
  }

  return { ok: true, hourCount, dayCount };
}

export const SHOUTOUT_LIMITS = { HOUR_LIMIT, DAY_LIMIT };

const SONG_HOUR_LIMIT = 1;
const SONG_DAY_LIMIT = 3;

/**
 * Counts SongRequest rows matching this ipHash in the last hour and last 24h.
 * Blocks if either threshold is exceeded.
 * Mirrors checkShoutoutRateLimit but against the SongRequest table.
 */
export async function checkSongRateLimit(ipHash: string): Promise<RateLimitResult> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [hourCount, dayCount] = await Promise.all([
    prisma.songRequest.count({
      where: { ipHash, createdAt: { gte: hourAgo } },
    }),
    prisma.songRequest.count({
      where: { ipHash, createdAt: { gte: dayAgo } },
    }),
  ]);

  if (hourCount >= SONG_HOUR_LIMIT) {
    const oldest = await prisma.songRequest.findFirst({
      where: { ipHash, createdAt: { gte: hourAgo } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const waitUntil = oldest
      ? oldest.createdAt.getTime() + 60 * 60 * 1000
      : now.getTime() + 60 * 60 * 1000;
    return {
      ok: false,
      reason: "hour_limit",
      retryAfterSeconds: Math.max(60, Math.ceil((waitUntil - now.getTime()) / 1000)),
      hourCount,
      dayCount,
    };
  }
  if (dayCount >= SONG_DAY_LIMIT) {
    return {
      ok: false,
      reason: "day_limit",
      retryAfterSeconds: 60 * 60 * 6, // come back in 6h; precise time isn't worth the query
      hourCount,
      dayCount,
    };
  }

  return { ok: true, hourCount, dayCount };
}

export const SONG_LIMITS = {
  HOUR_LIMIT: SONG_HOUR_LIMIT,
  DAY_LIMIT: SONG_DAY_LIMIT,
};
