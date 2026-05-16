/**
 * Five-way classifier for YouTube live chat messages: should this be
 * aired as a shoutout, replied to conversationally by Lena, treated as
 * a song request, treated as a shoutout combined with a song request,
 * or skipped as noise?
 *
 * Used only for messages coming in via the YouTube live chat poller
 * (workers/queue-daemon/youtube-chat-loop.ts) — booth submissions on
 * numaradio.com always go through the shoutout path because the form
 * itself self-selects for that intent.
 *
 * Returns { category, worthy, reason }:
 *   - "shoutout"              → dedicates to someone else, Lena reads on air
 *   - "reply"                 → addressed to Lena, generate a fresh response
 *   - "request"               → asks Lena to play a specific song (Phase 5
 *     QueueDirector will route this to a queue insert; until then it
 *     falls through to the shoutout path)
 *   - "shoutout_with_request" → combines a personal message with a song
 *     request (Phase 5 routes through Producer; until then, shoutout)
 *   - "noise"                 → low-effort, skip
 *
 * `worthy` is provided as a back-compat boolean (true for everything
 * except noise) so older callers that only branched on worthy keep
 * working unchanged.
 *
 * Fail-open: if MiniMax is unreachable we return shoutout to keep the
 * existing pipeline running.
 */

const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const CLASSIFIER_MODEL =
  process.env.MINIMAX_INTENT_MODEL ?? "MiniMax-M2.7";

export type IntentCategory = "shoutout" | "reply" | "noise" | "request" | "shoutout_with_request";

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

Decide one of FIVE outcomes:

1. "shoutout" — the listener wants Lena to dedicate / shout out / read their message TO someone else (a friend, family, group). Lena narrates it on air.
2. "reply" — the message is for Lena herself (thank-you, comment, question, greeting). Lena answers conversationally.
3. "request" — the listener is asking Lena to play a specific song. Example tokens: "play X by Y", "can you play <song>", "queue up <track>". The message has NO personal sentiment or shoutout target — it is purely a song request.
4. "shoutout_with_request" — the message contains BOTH a personal shoutout/sentiment AND a song request. Example: "loving this set, can you play Aphex Twin?" → personal love + song request. Lena will read the shoutout AND queue the requested track.
5. "noise" — low-effort or empty. Skip silently.

Hard rules:
- A question about Lena/the show/the station ("is this your first stream?", "how are you?", "what's playing?") → ALWAYS reply.
- A question that names a specific song or asks Lena to play music ("can you play X?", "got any Y?") → request, NOT reply.
- A compliment about the show / music / Lena with no recipient and no song request → reply.
- Only classify as shoutout when the listener names WHO the message is for AND there is no song-request component ("to my brother", "for my mom"). If a song request is also present → shoutout_with_request.

Heuristics:
- "shoutout to <someone>", "playing this for <someone>", "hi to my friends in <place>", "dedicating this to <X>" → shoutout
- "thanks", "you're awesome", "this is so chill", "love this song", "good morning lena", any question (direct or indirect), "tuning in from Tokyo" (no recipient) → reply
- single words, "lol", "first", "test", emoji-only, "hi"/"yo" alone → noise

Borderline messages go to "reply" rather than "shoutout" — a fresh Lena reply is always interesting; reading a flat message back can feel awkward.

Reply with EXACTLY one of these JSON shapes, nothing else:
{"d":"shoutout"}
{"d":"reply"}
{"d":"request"}
{"d":"shoutout_with_request"}
{"d":"noise","r":"<short reason: lol|emoji|greeting|too_short|spam|test|empty>"}

Examples (input → output):
"lol" → {"d":"noise","r":"low_effort"}
"first" → {"d":"noise","r":"first_comment"}
"hi" → {"d":"noise","r":"greeting"}
"hey lena" → {"d":"reply"}
"shoutout to my brother in Bucharest" → {"d":"shoutout"}
"playing this for my mom on her birthday" → {"d":"shoutout"}
"can you play something dreamy" → {"d":"request"}
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
"test" → {"d":"noise","r":"test"}
"play hotel california by eagles" → {"d":"request"}
"queue up aphex twin please" → {"d":"request"}
"loving this set, can you play any synthwave?" → {"d":"shoutout_with_request"}
"this is the best playlist, play more from this artist" → {"d":"shoutout_with_request"}
"thanks for the vibes — can you put on the next album by the same group" → {"d":"shoutout_with_request"}`;

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
    // Fail-closed — symmetric with moderate.ts which also fails
    // closed on missing key. A misconfigured deploy otherwise turns
    // every YouTube chat message (questions, hellos, "lol", emoji)
    // into a full shoutout pipeline run, burning Deepgram + B2 quota.
    return {
      category: "noise",
      worthy: false,
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
  if (decision === "request") {
    return { category: "request", worthy: true, reason: "ok" };
  }
  if (decision === "shoutout_with_request") {
    return { category: "shoutout_with_request", worthy: true, reason: "ok" };
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
