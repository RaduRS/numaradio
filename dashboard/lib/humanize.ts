/**
 * Pre-TTS rewrite pass. Takes the listener's (already moderated) text
 * and rewrites it as a warm late-night radio host would deliver it.
 *
 * Critical rule: this step must NEVER block a shoutout. On any failure
 * (missing API key, HTTP error, non-string response, obviously broken
 * output, the model trying to be clever and changing the meaning), we
 * return the original text and let the pipeline continue. Better a dry
 * script than no shoutout.
 */

const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const HUMANIZE_MODEL = process.env.MINIMAX_HUMANIZE_MODEL ?? "MiniMax-M2.7";
const MAX_EXPANSION_RATIO = 1.6;
const MIN_CONTRACTION_RATIO = 0.5;

const SYSTEM_PROMPT = `You rewrite shoutouts so a warm late-night radio host can deliver them naturally on air.

Goal: turn flat text into something that SOUNDS like a host speaking — not like a script being read. The listener's meaning, names, and places must survive unchanged.

Do:
- Use contractions ("you're", "we're", "that's", "I'll").
- Break into short natural phrases, 6–14 words each, one per line.
- Use ellipses (...) for thinking-pauses, commas for breath.
- Add at most one casual opener when it fits the tone: "Alright...", "Okay so...", "Listen...", "Hey...", "Tonight..."
- Keep it warm, present, intimate — like talking to one person at 2am.

Don't:
- Add facts, names, places, or claims not in the original.
- Make it cheesy or over-excited ("PARTY PEOPLE!", "WOOO!").
- Use ALL CAPS.
- Add more than one "alright" / "okay" / "listen" opener per shoutout.
- Balloon it — output should be within 1.5x the input length.
- Include stage directions like [breath] or [pause] — rely on punctuation and line breaks.

Output exactly one line of plain text per spoken phrase, joined by newlines. No markdown, no quotes around the whole thing, no prefixes like "Here's the rewrite:". Just the spoken copy.`;

interface AnthropicMessage {
  content?: Array<{ type: string; text?: string }>;
}

/**
 * Strip anything that looks like the model commenting on its output:
 * leading "Sure!" lines, "Here's..." prefixes, bullet lists, code fences.
 */
function cleanModelOutput(raw: string): string {
  let s = raw.trim();

  // Remove code fences wholesale.
  s = s.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "");

  // Drop obvious preamble lines.
  const lines = s.split(/\n/).map((l) => l.trim());
  const startIdx = lines.findIndex(
    (l) =>
      l &&
      !/^(sure|here('s| is)|okay|ok)[,!.:]/i.test(l) &&
      !/^rewrite|^output:|^result:/i.test(l),
  );
  const cleaned = (startIdx >= 0 ? lines.slice(startIdx) : lines)
    .filter((l) => l.length > 0)
    .join("\n")
    .trim();

  // Strip wrapping quotes if the model quoted the whole thing.
  return cleaned.replace(/^["'`](.+)["'`]$/s, "$1").trim();
}

function isSuspiciousRewrite(original: string, rewritten: string): boolean {
  if (!rewritten) return true;

  // Length sanity: must stay in a reasonable window of the original.
  const origLen = original.trim().length;
  const rewLen = rewritten.trim().length;
  if (origLen >= 20) {
    if (rewLen > origLen * MAX_EXPANSION_RATIO) return true;
    if (rewLen < origLen * MIN_CONTRACTION_RATIO) return true;
  }

  // Obvious "I'm a language model" or refusal leaks.
  if (/\b(as an? (ai|assistant|language model)|i (can't|cannot|won't))\b/i.test(rewritten)) {
    return true;
  }

  return false;
}

/**
 * Rewrite `text` into broadcast-voice copy. Always resolves; on any
 * failure the caller gets back the original text verbatim.
 */
export async function humanizeScript(text: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return text;

  const original = text.trim();
  if (!original) return text;

  let res: Response;
  try {
    res = await fetch(MINIMAX_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: HUMANIZE_MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: original }],
      }),
    });
  } catch (e) {
    console.warn("[humanize] network error:", e instanceof Error ? e.message : e);
    return text;
  }

  if (!res.ok) {
    console.warn("[humanize] http", res.status);
    return text;
  }

  let data: AnthropicMessage;
  try {
    data = (await res.json()) as AnthropicMessage;
  } catch {
    return text;
  }

  const raw = data.content?.find((b) => b.type === "text" && b.text)?.text;
  if (!raw) return text;

  const cleaned = cleanModelOutput(raw);
  if (isSuspiciousRewrite(original, cleaned)) {
    console.warn("[humanize] suspicious rewrite, falling back. Got:", cleaned.slice(0, 200));
    return text;
  }

  return cleaned;
}
