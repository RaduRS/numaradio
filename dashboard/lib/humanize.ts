/**
 * Pre-TTS rewrite pass. Takes the listener's (already moderated) text
 * and rewrites it as a warm late-night radio host (Lena) NARRATING
 * the shoutout — not reading the listener's words verbatim.
 *
 * Critical rule: this step must NEVER block a shoutout. On any failure
 * (missing API key, HTTP error, non-string response, obviously broken
 * output, the model trying to be clever and changing the meaning), we
 * return the original text and let the pipeline continue. Better a dry
 * script than no shoutout.
 */

const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const HUMANIZE_MODEL = process.env.MINIMAX_HUMANIZE_MODEL ?? "MiniMax-M2.7";
// Shoutout framing ("Going out to <recipient>. <Sender> said …") adds
// words on top of the listener's text — allow up to ~2x expansion.
const MAX_EXPANSION_RATIO = 2.0;
const MIN_CONTRACTION_RATIO = 0.5;
/** Absolute char ceiling for any rewrite. ~32s of speech at 150wpm =
 *  the upper edge of "still a shoutout, not an essay". Replaces the
 *  ratio-only check for short inputs, which falsely flagged perfectly
 *  good humanizations like "Going out to inRhino, who asked for a
 *  shoutout on YouTube. There it is, straight from the source. We'll
 *  let it ride." (124 chars from 44 = 2.8× ratio, but legit). */
const MAX_REWRITE_CHARS = 320;
/** Below this input length the 2× expansion guard is too tight — the
 *  humanizer naturally needs to add sender context + perspective shift,
 *  which routinely doubles or triples a 30-50 char listener message.
 *  Above this length the 2× cap kicks back in to catch genuine
 *  hallucinations on already-meaty inputs. */
const EXPANSION_RATIO_MIN_LEN = 100;

// Mirrors lib/moderate.ts::profanityPrefilter from the main numaradio
// repo. Duplicated here because the dashboard is a separate Next app
// and doesn't import from the public site's lib. Any name containing
// one of these gets treated as anonymous so we never let listener-
// supplied profanity into Lena's voice via the requesterName field.
const NAME_PROFANITY_PATTERNS: ReadonlyArray<RegExp> = [
  /\bmotherfuck(ing|ed|er|ers|s)?\b/i,
  /\bfuck(ing|ed|er|ers|s)?\b/i,
  /\bbullshit\b/i,
  /\bshit(ty|s|ting|ted|head|heads)?\b/i,
  /\bass(es|hole|holes|wipe|wipes|hat|hats)?\b/i,
  /\bbitch(es|ing|y)?\b/i,
  /\bcunt(s)?\b/i,
  /\bdick(head|s|heads)?\b/i,
  /\bcock(sucker|suckers|s)?\b/i,
  /\bpussy\b/i,
  /\bbastard(s)?\b/i,
];

const ANONYMOUS_TOKENS = /^(anon|anonymous|n\/a|none|null|undefined)$/i;

/**
 * Sanitise the booth's requesterName before it reaches the humaniser.
 * Returns null when the name is missing, profanity-laced, or an
 * obvious "no name" placeholder — the humaniser then frames the
 * shoutout as "A listener said …" instead of "Fuckface said …" or
 * "Anonymous said …".
 */
export function sanitiseRequesterName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().slice(0, 60);
  if (!trimmed) return null;
  if (ANONYMOUS_TOKENS.test(trimmed)) return null;
  for (const re of NAME_PROFANITY_PATTERNS) {
    if (re.test(trimmed)) return null;
  }
  return trimmed;
}

const SYSTEM_PROMPT = `You're rewriting a listener shoutout so Lena (the warm late-night radio host) can deliver it on air. The listener wrote a message TO someone — your job is to reframe it as Lena NARRATING the shoutout to the whole listener pool, NOT reading the listener's words verbatim.

The user message you receive is formatted as:

Sender: <name, location, or anonymous>
Message: <the shoutout text>

CRITICAL — perspective shift (the whole point of this rewrite):
The listener wrote in first person to a recipient. Lena is a third-party narrator.
- The sender's "I / me / my" → the sender's name when known (or "they")
- The sender's "you / your" addressed to a named recipient → that recipient's name (or "him" / "her" / "them")
- The shoutout NEVER goes out to "you" — it goes out to the recipient by name, or "someone special" if no name is in the message.
- Lena never says "I" or "me" — she's the host, not the sender.

Sender-field interpretation — the value isn't always a clean name. Decide which it is:
- A personal name (one or two capitalised words like "Sophie", "Alex M") → use it directly: "Sophie said …"
- A location ("Bucharest", "From London", "London listener", "NYC") → reframe as "A listener in <place>" or "Someone in <place>": "A listener in Bucharest said …"
- "anonymous", empty, or unclear → "A listener" / "Someone": "A listener said …"
- A nickname / handle that reads naturally → keep it: "deadhound said …"
Never read the literal Sender field if it doesn't make sense as a speaker (numbers, single letters, gibberish) — fall back to "A listener".

Try to follow this shape:
  Line 1: This one's going out to <recipient>.   (or "Going out to <recipient>.")
  Line 2: <Sender> said <paraphrase of the message in 3rd person>.
  Optional final line (use SPARINGLY — only when one genuinely lands):
    A 5-10 word Lena aside reacting to what was said. Pick the tone from the message.
    Examples:
      Wonder what that's all about.
      Hope they hear this one.
      Big mood for the season.
      We'll let it ride.
      Same, honestly.

If the recipient is unclear or no name is mentioned in the message, drop the "going out to" line and lead with the sender:
  <Sender> wrote in to say <paraphrase>.

If the sender is anonymous (no name provided), use "A listener" or "Someone" once at the start, never "you".

Do:
- Use contractions ("you're", "they're", "that's", "she's", "he's").
- 6-14 words per line, one phrase per line.
- Use ellipses (...) for thinking-pauses, commas for breath.
- Stay warm, present, intimate — 2am voice.

Don't:
- Add facts, names, or places not in the original.
- Quote the listener verbatim when they're addressing the recipient ("I can't wait for summer" must become "they can't wait for summer" or "they're waiting for the summer").
- Always add an aside — only when one genuinely fits.
- Use ALL CAPS, exclamation overload, or "PARTY PEOPLE!" energy.
- Balloon — keep it tight, within 2x the original message length.
- Include stage directions like [breath] or [pause].

Output: one phrase per line, plain text only. No markdown, no preamble like "Here's the rewrite:", no quotes around the whole thing.`;

interface AnthropicMessage {
  content?: Array<{ type: string; text?: string }>;
}

/**
 * Strip anything that looks like the model commenting on its output:
 * leading "Sure!" lines, "Here's..." prefixes, bullet lists, code fences.
 */
function cleanModelOutput(raw: string): string {
  let s = raw.trim();
  s = s.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "");
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
  return cleaned.replace(/^["'`](.+)["'`]$/s, "$1").trim();
}

export function isSuspiciousRewrite(original: string, rewritten: string): boolean {
  if (!rewritten) return true;
  const origLen = original.trim().length;
  const rewLen = rewritten.trim().length;
  // Hard ceiling — never let a "shoutout" become an essay regardless
  // of how short the input was.
  if (rewLen > MAX_REWRITE_CHARS) return true;
  if (origLen >= 20) {
    // Strong contraction is still a red flag (lost meaning).
    if (rewLen < origLen * MIN_CONTRACTION_RATIO) return true;
    // Expansion guard only for already-meaty inputs — short messages
    // legitimately blow past 2× when the humanizer adds sender context
    // and flips perspective.
    if (origLen >= EXPANSION_RATIO_MIN_LEN && rewLen > origLen * MAX_EXPANSION_RATIO) {
      return true;
    }
  }
  if (/\b(as an? (ai|assistant|language model)|i (can't|cannot|won't))\b/i.test(rewritten)) {
    return true;
  }
  return false;
}

export interface HumanizeOpts {
  /** Sender's name as they entered it on the booth (e.g. "Sophie").
   *  When provided, Lena names the sender in third person; when absent
   *  Lena says "A listener" / "Someone". */
  requesterName?: string;
}

/**
 * Rewrite `text` into broadcast-voice copy. Always resolves; on any
 * failure the caller gets back the original text verbatim.
 */
export async function humanizeScript(
  text: string,
  opts: HumanizeOpts = {},
): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return text;

  const original = text.trim();
  if (!original) return text;

  // Sanitise INSIDE the humaniser so every call site is automatically
  // protected — no chance a future caller forgets to clean the name.
  const cleanName = sanitiseRequesterName(opts.requesterName);
  const senderLabel = cleanName ?? "anonymous";
  const userMessage = `Sender: ${senderLabel}\nMessage: ${original}`;

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
        // MiniMax-M2.7 is a reasoning model — its `thinking` block runs
        // before the rewritten output and can crowd a small budget,
        // which would trip the length-sanity check and drop us to the
        // original-text fallback. 3200 gives reasoning room.
        max_tokens: 3200,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
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
