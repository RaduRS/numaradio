// HMAC token for newsletter one-click unsubscribe. Signs
// `unsub:<email>.<exp>` with INTERNAL_API_SECRET. Email is lowercased
// before signing so the token survives Gmail's canonicalization (a
// recipient whose row stored "Artist@Example.com" gets a link that
// still verifies after their client may have lowercased it).
//
// Default TTL is 365 days — unsubscribe links should keep working long
// after the newsletter was sent, since email archives outlast bulk
// sends. The MAX_TTL ceiling on verify (2 years) is just a units-bug
// guard against `Date.now()` in millis being passed by mistake.
//
// Designed to fail closed — missing secret, bad inputs, expired exp,
// or any crypto error returns false (verify) or throws (sign).

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 365 * 24 * 60 * 60;
const MAX_TTL_SECONDS = 2 * 365 * 24 * 60 * 60;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface UnsubscribeToken {
  exp: number;
  sig: string;
}

export function signUnsubscribeToken(
  email: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): UnsubscribeToken {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) throw new Error("INTERNAL_API_SECRET not set");
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", secret)
    .update(`unsub:${normalizeEmail(email)}.${exp}`)
    .digest("hex");
  return { exp, sig };
}

export function verifyUnsubscribeToken(
  email: string,
  exp: string | null,
  sig: string | null,
): boolean {
  if (!email || !exp || !sig) return false;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  const expNum = Number.parseInt(exp, 10);
  if (!Number.isFinite(expNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (expNum < nowSec) return false;
  if (expNum - nowSec > MAX_TTL_SECONDS) return false;
  const expected = createHmac("sha256", secret)
    .update(`unsub:${normalizeEmail(email)}.${exp}`)
    .digest("hex");
  if (expected.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

/**
 * Builds the full unsubscribe URL for a recipient. Caller supplies
 * the public site origin (typically `https://numaradio.com`).
 */
export function buildUnsubscribeUrl(origin: string, email: string): string {
  const { exp, sig } = signUnsubscribeToken(email);
  const params = new URLSearchParams({
    email: normalizeEmail(email),
    exp: String(exp),
    sig,
  });
  return `${origin.replace(/\/$/, "")}/api/newsletter/unsubscribe?${params.toString()}`;
}
