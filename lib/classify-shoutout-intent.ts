/**
 * Three-way classifier for YouTube live chat messages: should this be
 * aired as a shoutout, replied to conversationally by Lena, or skipped
 * as noise?
 *
 * Used only for messages coming in via the YouTube live chat poller
 * (workers/queue-daemon/youtube-chat-loop.ts) — booth submissions on
 * numaradio.com always go through the shoutout path because the form
 * itself self-selects for that intent.
 *
 * Returns { category, worthy, reason }:
 *   - "shoutout" → message dedicates / shouts out to someone or shares
 *     a listening context (verbatim-worthy text the host should narrate)
 *   - "reply"    → message is addressed TO Lena (thanks, hello, comment
 *     about the show, simple question) — generate a fresh 1-2 sentence
 *     response from Lena rather than reading the listener's words
 *   - "noise"    → low-effort, skip
 *
 * `worthy` is provided as a back-compat boolean (true for shoutout|reply,
 * false for noise) so older callers that only branched on worthy keep
 * working unchanged.
 *
 * Fail-open: if MiniMax is unreachable we return shoutout to keep the
 * existing pipeline running.
 */

const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const CLASSIFIER_MODEL =
  process.env.MINIMAX_INTENT_MODEL ?? "MiniMax-M2.7";

export type IntentCategory = "shoutout" | "reply" | "noise";

export interface IntentResult {
  category: IntentCategory;
  /** True when category is "shoutout" or "reply". Kept for older
   *  callers that only branched on a boolean. */
  worthy: boolean;
  reason: string;
}

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

const SYSTEM_PROMPT = `You triage a YouTube live chat message on a 24/7 AI radio station hosted by Lena. The message has ALREADY been filtered for an "@lena" trigger — that mention is stripped before you see it, so the addressee is implicitly Lena unless the listener explicitly names a different recipient.

Decide one of THREE outcomes:

1. "shoutout" — the listener wants Lena to dedicate / shout out / read their message TO someone else (a friend, family, place, group). Lena will narrate it on air to the whole listener pool.
2. "reply" — the message is for Lena herself: a thank-you, a comment about the show or music, ANY question (the listener wants an answer from Lena), a simple greeting, a place check-in WITHOUT a recipient. Lena answers back conversationally (1-2 sentences).
3. "noise" — low-effort or empty. Skip silently.

Hard rules:
- A question mark "?" with no third-party recipient → ALWAYS reply, never shoutout. Even meta questions about Lena/the show ("is this your first stream?", "how long have you been on?", "what's playing?") → reply.
- A compliment about the show / music / Lena with no recipient → reply.
- Only classify as shoutout when the listener names WHO the message is for ("to my brother", "for my mom", "hi friends in Berlin").

Heuristics:
- "shoutout to <someone>", "playing this for <someone>", "hi to my friends in <place>", "dedicating this to <X>" → shoutout
- "thanks", "you're awesome", "this is so chill", "love this song", "good morning lena", any question (direct or indirect), "tuning in from Tokyo" (no recipient) → reply
- single words, "lol", "first", "test", emoji-only, "hi"/"yo" alone → noise

Borderline messages go to "reply" rather than "shoutout" — a fresh Lena reply is always interesting; reading a flat message back can feel awkward.

Reply with EXACTLY one of these JSON shapes, nothing else:
{"d":"shoutout"}
{"d":"reply"}
{"d":"noise","r":"<short reason: lol|emoji|greeting|too_short|spam|test|empty>"}

Examples (input → output):
"lol" → {"d":"noise","r":"low_effort"}
"first" → {"d":"noise","r":"first_comment"}
"hi" → {"d":"noise","r":"greeting"}
"hey lena" → {"d":"reply"}
"shoutout to my brother in Bucharest" → {"d":"shoutout"}
"playing this for my mom on her birthday" → {"d":"shoutout"}
"can you play something dreamy?" → {"d":"reply"}
"this is hitting different at 2am" → {"d":"reply"}
"thanks for keeping me company tonight" → {"d":"reply"}
"big thank you for this one" → {"d":"reply"}
"you're amazing lena" → {"d":"reply"}
"how long have you been on tonight?" → {"d":"reply"}
"is this your first time streaming? sounds nice" → {"d":"reply"}
"is this your first stream?" → {"d":"reply"}
"how's your night going?" → {"d":"reply"}
"sounds nice" → {"d":"reply"}
"what's playing?" → {"d":"reply"}
"🔥🔥🔥" → {"d":"noise","r":"emoji_only"}
"yo" → {"d":"noise","r":"greeting"}
"first listening from Tokyo" → {"d":"reply"}
"hey friends in Berlin, hope your night is good" → {"d":"shoutout"}
"test" → {"d":"noise","r":"test"}`;

export interface ClassifyOpts {
  fetcher?: typeof fetch;
}

export async function classifyShoutoutIntent(
  rawText: string,
  opts: ClassifyOpts = {},
): Promise<IntentResult> {
  const fetcher = opts.fetcher ?? fetch;
  const text = rawText.trim();
  if (text.length < 4) {
    return { category: "noise", worthy: false, reason: "too_short" };
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    // Fail-open — we let it through as a shoutout; the existing
    // moderator still runs.
    return {
      category: "shoutout",
      worthy: true,
      reason: "classifier_not_configured",
    };
  }

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
        model: CLASSIFIER_MODEL,
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: text }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Fail-open on a hung classifier so a YouTube outage in MiniMax
    // doesn't black-hole the whole pipeline.
    return {
      category: "shoutout",
      worthy: true,
      reason:
        err instanceof Error && err.name === "TimeoutError"
          ? "classifier_timeout"
          : "classifier_network",
    };
  }

  if (!res.ok) {
    return {
      category: "shoutout",
      worthy: true,
      reason: `classifier_http_${res.status}`,
    };
  }

  let json: MinimaxResponse;
  try {
    json = (await res.json()) as MinimaxResponse;
  } catch {
    return {
      category: "shoutout",
      worthy: true,
      reason: "classifier_parse_error",
    };
  }

  const textBlock = (json.content ?? []).find(
    (b): b is MinimaxText => b?.type === "text",
  );
  const raw = (textBlock?.text ?? "").trim();
  return parseIntentReply(raw);
}

/** Parser is split out for direct unit testing without the LLM hop. */
export function parseIntentReply(reply: string): IntentResult {
  // Match the {"d":"...","r":"..."} shape; tolerant of stray
  // whitespace + extra prose around the JSON.
  const m = reply.match(/\{[^{}]*"d"\s*:\s*"(\w+)"[^{}]*\}/);
  if (!m) {
    // Couldn't parse — fail-open.
    return {
      category: "shoutout",
      worthy: true,
      reason: "classifier_no_decision",
    };
  }
  const decision = m[1].toLowerCase();
  if (decision === "shoutout" || decision === "worthy") {
    // "worthy" is the legacy token from before tri-state — treat
    // as shoutout for back-compat.
    return { category: "shoutout", worthy: true, reason: "ok" };
  }
  if (decision === "reply") {
    return { category: "reply", worthy: true, reason: "ok" };
  }
  if (decision === "noise") {
    const reasonMatch = reply.match(/"r"\s*:\s*"([^"]+)"/);
    return {
      category: "noise",
      worthy: false,
      reason: reasonMatch ? reasonMatch[1].slice(0, 32) : "noise",
    };
  }
  // Unknown decision token — fail-open.
  return {
    category: "shoutout",
    worthy: true,
    reason: `classifier_unknown:${decision.slice(0, 16)}`,
  };
}
