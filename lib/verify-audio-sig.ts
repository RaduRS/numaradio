// HMAC verification for the dashboard's signed
// `/api/submissions/[id]/audio` URLs. Pairs with
// `dashboard/lib/sign-audio-url.ts` — same secret, same algorithm.
//
// Returns true iff:
//   - exp + sig query params are present and parseable
//   - exp is in the future (URL hasn't expired)
//   - sig matches HMAC-SHA256(`${id}.${exp}`, INTERNAL_API_SECRET)
//
// Designed to fail closed: missing secret, missing params, malformed
// numbers, or any crypto error all return false. The route serves 404
// in that case (matches the existing not-found behaviour — never leaks
// whether the submission id exists).

import { createHmac, timingSafeEqual } from "node:crypto";

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
  if (expNum < Math.floor(Date.now() / 1000)) return false;
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
