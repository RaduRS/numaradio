// HMAC verification for the dashboard's signed
// `/api/submissions/[id]/audio` URLs. Pairs with
// `dashboard/lib/sign-audio-url.ts` — same secret, same algorithm.
//
// Returns true iff:
//   - exp + sig query params are present and parseable
//   - exp is in the future (URL hasn't expired)
//   - exp is within MAX_TTL_SECONDS of now (defends against a
//     units-bug token where exp is `Date.now()` in milliseconds
//     instead of seconds — that token would otherwise validate for
//     ~50,000 years)
//   - sig matches HMAC-SHA256(`${id}.${exp}`, INTERNAL_API_SECRET)
//
// Designed to fail closed: missing secret, missing params, malformed
// numbers, or any crypto error all return false. The route serves 404
// in that case (matches the existing not-found behaviour — never leaks
// whether the submission id exists).

import { createHmac, timingSafeEqual } from "node:crypto";

// 4h ceiling. The minting helper uses 1h (operator workflow window);
// 4h is 4× headroom for clock skew and any legitimate longer TTL while
// still rejecting a token whose `exp` is millis-instead-of-seconds.
const MAX_TTL_SECONDS = 4 * 60 * 60;

export function verifySubmissionAudioSig(
  id: string,
  exp: string | null,
  sig: string | null,
): boolean {
  if (!exp || !sig) return false;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  const expNum = Number.parseInt(exp, 10);
  if (!Number.isFinite(expNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (expNum < nowSec) return false;
  if (expNum - nowSec > MAX_TTL_SECONDS) return false;
  const expected = createHmac("sha256", secret)
    .update(`${id}.${exp}`)
    .digest("hex");
  if (expected.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}
