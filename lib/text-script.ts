/**
 * Predominantly-Latin script detection. First-line cheap reject for inputs
 * that end up read out by Lena (English-language host on Deepgram aura-2 /
 * Vertex Leda). Non-Latin script (Bengali / CJK / Arabic / Hebrew / Cyrillic
 * etc.) produces silence or garbled phonemes on air, so we drop it at the
 * boundary with a clear error rather than wasting a moderation API call
 * plus a botched on-air segment.
 *
 * NOTE: Latin script ≠ English. German, French, Spanish, Italian etc. all
 * pass this check. For English-only enforcement, layer `isEnglish(text)`
 * after this check.
 *
 * Threshold is 80% Latin so a single accented or foreign character in an
 * otherwise English message still passes (e.g. "greetings from Tokyo 東",
 * "café au lait").
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
    // U+1E00–U+1EFF (Latin Extended Additional) covers Vietnamese
    // diacritics like Ắ Ẹ Ợ and many Welsh/Turkish letters; without it
    // legitimate Vietnamese names get rejected as non-Latin.
    if (/[A-ɏḀ-ỿ]/.test(ch)) latin += 1;
  }
  return latin / stripped.length >= 0.8;
}

// ─── English-only enforcement ──────────────────────────────────────────
//
// Numa Radio is an English-language station. `isEnglish` is the second
// gate after `isLatinScript`: it rejects Latin-script text that is
// clearly in another European language (German, French, Spanish,
// Italian, Portuguese, Dutch, Polish, Romanian, Swedish) AND rejects
// prompts that ASK for content in a non-English language ("a song in
// German", "auf Deutsch please", "en español").
//
// Heuristic — three signals combine:
//   1. Explicit ask-for-language phrase  → immediate reject
//   2. Strong non-English function-word density → reject if dominant
//   3. Otherwise accept (short messages, names, mostly-English with a
//      loanword or two all pass)

// Phrases that explicitly ask for output in a non-English language.
// Listener may write the rest in English but the request itself is for
// non-English content — reject either way.
const ASKS_NON_ENGLISH = new RegExp(
  [
    // "in <language>" / "in <language>, please"
    "\\bin\\s+(german|french|spanish|italian|portuguese|dutch|polish|romanian|swedish|russian|chinese|japanese|korean|arabic|hebrew|turkish|greek|hindi|bengali|vietnamese|thai|czech|hungarian|finnish|danish|norwegian|catalan|ukrainian|bulgarian|serbian|croatian)\\b",
    // "<language> only", "<language> please", "<language> lyrics"
    "\\b(german|french|spanish|italian|portuguese|dutch|polish|romanian|swedish)\\s+(only|please|version|lyrics|song)",
    // German / French / Spanish / Italian native phrasing for "in <lang>"
    "\\bauf\\s+deutsch\\b",
    "\\ben\\s+(fran[cç]ais|espa[nñ]ol|italiano|portugu[êe]s)\\b",
  ].join("|"),
  "i",
);

// Strong function words that are very common in their language and
// nearly absent from English. Hitting two or more of these from the
// same family in a short text is a clean signal.
const NON_ENGLISH_MARKERS: Record<string, RegExp> = {
  german:
    /\b(der|die|das|und|ist|ein|eine|nicht|ich|du|mit|für|über|aber|auch|noch|wenn|dass|mein|dein|sein|ihr|haben|sind|werde|wirst|warum|wie|weil|deutsch|deutsche|deutschen)\b/gi,
  french:
    /\b(le|la|les|un|une|des|de|du|et|est|sont|je|tu|il|elle|nous|vous|ils|elles|mon|ma|ton|ta|son|sa|notre|votre|leur|pour|avec|sans|mais|aussi|parce|que|qui|quoi|où|quand|comment|fran[cç]ais|fran[cç]aise)\b/gi,
  spanish:
    /\b(el|la|los|las|un|una|unos|unas|y|o|pero|si|no|de|en|con|sin|para|por|que|qué|quién|cuál|cuándo|cómo|dónde|yo|tú|él|ella|nosotros|vosotros|ellos|ellas|mi|tu|su|nuestro|vuestro|espa[nñ]ol|espa[nñ]ola)\b/gi,
  italian:
    /\b(il|lo|la|gli|le|un|uno|una|e|o|ma|se|non|di|in|con|per|che|chi|cosa|quando|dove|come|io|tu|lui|lei|noi|voi|loro|mio|mia|tuo|tua|suo|sua|nostro|vostro|italiano|italiana)\b/gi,
  portuguese:
    /\b(o|a|os|as|um|uma|uns|umas|e|ou|mas|se|n[ãa]o|de|em|com|sem|para|por|que|quem|qual|quando|onde|como|eu|tu|ele|ela|n[óo]s|v[óo]s|eles|elas|meu|minha|teu|tua|seu|sua|nosso|vosso|portugu[êe]s|portuguesa)\b/gi,
  dutch:
    /\b(de|het|een|en|is|zijn|niet|ik|jij|je|hij|zij|wij|jullie|met|voor|over|maar|ook|nog|als|dat|mijn|jouw|nederlands|nederlandse)\b/gi,
};

/** Internal — count distinct non-English function words from a single family. */
function familyHits(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  if (!matches) return 0;
  const lowered = matches.map((m) => m.toLowerCase());
  return new Set(lowered).size;
}

/**
 * English-only check. Returns true when the text is short, plausibly
 * English, or fails to trigger any non-English signal. Returns false
 * when the text explicitly asks for non-English content OR shows
 * dominant non-English function-word density.
 */
export function isEnglish(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;

  if (ASKS_NON_ENGLISH.test(trimmed)) return false;

  // Count word-like tokens for density.
  const wordCount = (trimmed.match(/\b[\p{L}']+\b/gu) ?? []).length;
  if (wordCount < 3) {
    // Too short for density to mean anything — a 1-2 word handle like
    // "GlitchD84" or "merci" should not get blocked here.
    return true;
  }

  // Sum the strongest single family. Two or more distinct hits from one
  // family is the cut — one stray loanword ("café", "über") shouldn't
  // tank an otherwise English shoutout.
  let strongest = 0;
  for (const pattern of Object.values(NON_ENGLISH_MARKERS)) {
    const hits = familyHits(trimmed, pattern);
    if (hits > strongest) strongest = hits;
  }

  if (strongest >= 2) return false;
  // For very short inputs (3-5 words), even 1 strong hit is a tell —
  // English function words mostly dominate a 3-word English sentence.
  if (strongest >= 1 && wordCount <= 5) return false;

  return true;
}
