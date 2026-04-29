/**
 * Conversational reply generator for YouTube live chat. When the
 * intent classifier flags a message as "reply" (a thank-you, hello,
 * comment about the show, simple question — addressed TO Lena rather
 * than dedicated to someone else), this module asks MiniMax to
 * compose a fresh 1-2 sentence response in Lena's voice.
 *
 * The generated text is what Lena will SAY on air. It does NOT need
 * the humanize / radio-host transform pass downstream because we're
 * already in Lena's voice. The shoutout endpoint passes
 * `skipHumanize=true` to /api/internal/shoutout so the text reaches
 * Deepgram TTS verbatim.
 *
 * Fail-closed: if MiniMax is unavailable or the model returns
 * something we can't use, this returns null and the caller skips
 * airing. A bad reply ("I don't know how to respond") is worse than
 * silence.
 */

const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const REPLY_MODEL = process.env.MINIMAX_REPLY_MODEL ?? "MiniMax-M2.7";

const MAX_REPLY_CHARS = 220;
const MIN_REPLY_CHARS = 6;

const SYSTEM_PROMPT = `You are Lena — the warm late-night host of Numa Radio, a 24/7 AI music station. A listener has sent a message in the YouTube live chat that's addressed to YOU (a thank-you, a comment about the show, a hello, a simple question). Write the response Lena would speak on air, right now, over the music.

Style:
- ONE or TWO short sentences. Total 12-30 words. NEVER more than 35 words.
- Conversational, warm, present-tense. You're a host on air, not a chatbot.
- Use the listener's first-name display name ONCE at most. If the name is unusable (numbers, slurs, "user1234", etc.) skip naming entirely.
- Speak as Lena ("I", "we") — never refer to yourself in third person.
- Acknowledge what they said specifically; don't be generic.
- Don't repeat the listener's words verbatim. Don't quote them.
- Don't ask follow-up questions back unless they asked one first.
- Don't say "thanks for tuning in" or "thanks for being here" — overused.
- Don't promise anything specific (no "I'll play X next").

What you DO say varies by message type:
- Thank-yous → "you're welcome" / "glad it's hitting" / "happy you're here"
- Comments about music → react to the comment with a vibe note
- Hellos / check-ins → warm acknowledgement, name them once if usable
- Questions → answer briefly in 1 sentence

Output ONLY the spoken text. No quotes, no labels, no markdown, no SSML, no emoji. Plain sentences only — what Lena says aloud.

Examples:

Listener: inRhino — "@lena this is so chill. Big thank you for this one!"
Output: You're so welcome, inRhino. Glad it's landing right.

Listener: anonymous — "@lena how long have you been on tonight?"
Output: A few hours in now. Just settling into the deep end.

Listener: maja — "@lena tuning in from Berlin"
Output: Hey Berlin. Glad you found us tonight.

Listener: anonymous — "@lena you're amazing"
Output: That means a lot. Stay with me — we've got hours to go.

Listener: anonymous — "@lena this song slaps"
Output: Right? It's been on heavy rotation tonight.`;

interface MinimaxText {
  type: "text";
  text: string;
}
interface MinimaxThinking {
  type: "thinking";
  thinking?: string;
}
interface MinimaxResponse {
  content?: Array<MinimaxText | MinimaxThinking>;
}

export interface GenerateReplyOpts {
  /** YouTube display name. Sanitised by the caller; pass null/undefined
   *  if missing or unusable. */
  displayName?: string | null;
  /** Override fetch (tests). */
  fetcher?: typeof fetch;
}

export interface ReplyResult {
  /** The text Lena should speak. Null when generation failed. */
  text: string | null;
  /** Short tag for the audit log. */
  reason: string;
}

const NAME_SAFE = /^[\p{L}\p{N} .'-]{1,40}$/u;
const NAME_BAD_TOKENS = /^(anon|anonymous|n\/a|none|null|undefined|user\d+)$/i;

function sanitiseName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (NAME_BAD_TOKENS.test(trimmed)) return null;
  if (!NAME_SAFE.test(trimmed)) return null;
  return trimmed;
}

export async function generateLenaReply(
  rawText: string,
  opts: GenerateReplyOpts = {},
): Promise<ReplyResult> {
  const fetcher = opts.fetcher ?? fetch;
  const text = rawText.trim();
  if (!text) return { text: null, reason: "empty_input" };

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return { text: null, reason: "minimax_not_configured" };
  }

  const cleanName = sanitiseName(opts.displayName);
  const userMessage = cleanName
    ? `Listener: ${cleanName} — "${text}"`
    : `Listener: anonymous — "${text}"`;

  let res: Response;
  try {
    res = await fetcher(MINIMAX_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: REPLY_MODEL,
        max_tokens: 2400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return {
      text: null,
      reason:
        err instanceof Error && err.name === "TimeoutError"
          ? "minimax_timeout"
          : "minimax_network",
    };
  }

  if (!res.ok) {
    return { text: null, reason: `minimax_http_${res.status}` };
  }

  let json: MinimaxResponse;
  try {
    json = (await res.json()) as MinimaxResponse;
  } catch {
    return { text: null, reason: "minimax_parse_error" };
  }

  const block = (json.content ?? []).find(
    (b): b is MinimaxText => b?.type === "text",
  );
  const raw = (block?.text ?? "").trim();
  return parseReply(raw);
}

/** Pull plain text out of the model's response and validate it. Split
 *  for direct testing without the LLM hop. */
export function parseReply(raw: string): ReplyResult {
  if (!raw) return { text: null, reason: "empty_response" };
  // Strip any accidental wrapping quotes / markdown / labels.
  let cleaned = raw.replace(/^["“”']+|["“”']+$/g, "").trim();
  cleaned = cleaned.replace(/^(output|response|reply|lena)\s*:\s*/i, "").trim();
  // Collapse whitespace including stray newlines from chain-of-thought leakage.
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.length < MIN_REPLY_CHARS) {
    return { text: null, reason: "reply_too_short" };
  }
  if (cleaned.length > MAX_REPLY_CHARS) {
    return { text: null, reason: "reply_too_long" };
  }
  // Bail on obvious refusal / error language.
  if (/^(i (can't|cannot|can not|won't)|sorry|i'm sorry|i don't know how)/i.test(cleaned)) {
    return { text: null, reason: "reply_refused" };
  }
  return { text: cleaned, reason: "ok" };
}
