/**
 * Predominantly-Latin script detection. Used as a guard at every input path
 * whose text ends up read out by Lena (Deepgram `aura-2-helena-en`, English-
 * only). Non-Latin script (Bengali / CJK / Arabic / Hebrew / Cyrillic etc.)
 * produces silence or garbled phonemes on air, so we drop it at the boundary
 * with a clear error rather than wasting a moderation API call + a botched
 * on-air segment.
 *
 * Wraps the same policy mainstream English-language radio (Capital, Kiss,
 * BBC Radio 1) applies to listener interaction.
 *
 * Threshold is 80% Latin so a single accented or foreign character in an
 * otherwise English message still passes (e.g. "café für meine Freunde",
 * "greetings from Tokyo 東 visiting today").
 *
 * Pure-punctuation/digit input is treated as accepted — the caller's length
 * filter handles those degenerate cases.
 */
export function isLatinScript(text: string): boolean {
  const stripped = text
    .replace(/\s+/g, "")
    .replace(/[\d\p{P}\p{S}]/gu, "");
  if (stripped.length === 0) return true;
  let latin = 0;
  for (const ch of stripped) {
    // Basic Latin + Latin-1 Supplement + Latin Extended-A/B (covers ASCII
    // a-z, accents like é à ñ ü, ß, etc.). Range A..ɏ ≈ U+0041..U+024F.
    if (/[A-ɏ]/.test(ch)) latin += 1;
  }
  return latin / stripped.length >= 0.8;
}
