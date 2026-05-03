// HMAC-signed URL generator for the public site's
// `/api/submissions/[id]/audio` route. Pending submission audio used
// to be reachable by anyone who guessed a cuid — the route lives on
// numaradio.com (Vercel) which is NOT behind CF Access, so the
// dashboard's auth boundary didn't apply. Now the dashboard signs a
// short-lived URL server-side; the public route verifies before
// streaming bytes.
//
// Mirror of `lib/verify-audio-sig.ts` in the main repo (the secret
// + algorithm must match exactly). Kept duplicated because dashboard
// is a separate Next app.

import "server-only";
import { createHmac } from "node:crypto";

const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour — operator workflow window.

/**
 * Returns the query-string suffix `?exp=<unix>&sig=<hex>` to append to
 * `/api/submissions/<id>/audio`. Throws if INTERNAL_API_SECRET is unset
 * (would be a misconfiguration in any environment that lists pending
 * submissions).
 */
export function signSubmissionAudioQuery(
  id: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) throw new Error("INTERNAL_API_SECRET not set");
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", secret)
    .update(`${id}.${exp}`)
    .digest("hex");
  return `?exp=${exp}&sig=${sig}`;
}
