/**
 * Radio-host speech formatter for Deepgram Aura-2.
 *
 * Principles:
 * - Short phrases: 8–14 words per line for natural conversational pacing
 * - Punctuation for emphasis, never ALL CAPS
 * - Periods and commas as breathing cues
 * - Preserve sentence variety — don't flatten everything uniform
 * - Quote marks around branded callouts for precise spoken emphasis
 */

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function ensureTerminal(text: string): string {
  const t = text.trimEnd();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function normalizeForSpeech(text: string): string {
  return text
    // Preserve newlines — when the humanize step has already split into
    // radio phrases we don't want to flatten its work. Collapse only
    // horizontal whitespace.
    .replace(/[ \t]+/g, " ")
    // Clamp runs of 3+ newlines down to a double break; Aura reads a
    // blank line as a noticeable beat, perfect for a "…thinking" gap.
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, ", ")
    .replace(/\((.*?)\)/g, ", $1, ")
    .trim();
}

/**
 * Split a long sentence into short radio-style phrases.
 * Targets 8–14 words per phrase, splitting on clause boundaries.
 */
function splitToPhrases(sentence: string): string[] {
  const clean = sentence.trim();
  if (!clean) return [];

  // Already short enough — keep it whole
  if (wordCount(clean) <= 14) {
    return [ensureTerminal(clean)];
  }

  // Split on clause boundaries: commas with conjunctions, semicolons, colons
  const clauseParts = clean
    .split(/,\s+(?=(?:and|but|so|or|which|that|because|while|when|where|though|yet)\b)|;\s*|:\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  // If we got usable clause breaks, build phrases from them
  if (clauseParts.length >= 2) {
    const out: string[] = [];
    let current = "";

    for (const part of clauseParts) {
      const candidate = current ? `${current}, ${part}` : part;

      if (wordCount(candidate) > 14 && wordCount(current) >= 5) {
        out.push(ensureTerminal(current));
        current = part;
      } else {
        current = candidate;
      }
    }

    if (current) out.push(ensureTerminal(current));
    return out;
  }

  // Fallback: split on any comma
  const commaParts = clean
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (commaParts.length >= 2) {
    const out: string[] = [];
    let current = "";

    for (const part of commaParts) {
      const candidate = current ? `${current}, ${part}` : part;

      if (wordCount(candidate) > 14 && wordCount(current) >= 5) {
        out.push(ensureTerminal(current));
        current = part;
      } else {
        current = candidate;
      }
    }

    if (current) out.push(ensureTerminal(current));
    return out;
  }

  // Last resort: keep as-is
  return [ensureTerminal(clean)];
}

/**
 * Add radio cadence — punctuation and isolation for emphasis.
 * No ALL CAPS. Uses periods and commas as pacing cues.
 */
function addRadioCadence(line: string): string {
  return (
    line
      .replace(/\bup next\b/gi, "Up next.")
      .replace(/\bright now\b/gi, "Right now.")
      .replace(/\bstay tuned\b/gi, "Stay tuned.")
      .replace(/\byou are listening to\b/gi, "You're listening to")
      .replace(/\bnuma radio\b/gi, '"Numa Radio"')
      // Clean up double periods from replacements
      .replace(/\.\./g, ".")
      .replace(/\.\,/g, ".")
  );
}

/**
 * Main transform: turn plain text into radio-host-ready copy.
 */
export function radioHostTransform(text: string): string {
  const cleaned = normalizeForSpeech(text);

  // If the input already has line breaks (typically from humanizeScript),
  // treat each non-empty line as a pre-split phrase. Run splitToPhrases
  // only on lines that still came through too long — otherwise the
  // humanize step's intentional pacing gets destroyed by sentence-level
  // re-splitting.
  const preLined = cleaned.includes("\n");

  const units = preLined
    ? cleaned
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : cleaned
        .match(/[^.!?]+[.!?]?/g)
        ?.map((s) => s.trim())
        .filter(Boolean) ?? [];

  const lines = units.flatMap(splitToPhrases).map(addRadioCadence);

  return lines.join("\n");
}