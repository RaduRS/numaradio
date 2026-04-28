/**
 * "Is this YouTube chat message worth airing as a shoutout?" classifier.
 *
 * Used only for messages coming in via the YouTube live chat poller
 * (workers/queue-daemon/youtube-chat-loop.ts) — booth submissions on
 * numaradio.com self-select for intent (a listener went out of their
 * way to fill in the form). YouTube chat doesn't have that filter, so
 * we add this lightweight LLM check before burning a moderation call
 * on noise like "lol" or "first".
 *
 * Returns either { worthy: true } or { worthy: false; reason }. The
 * reason is short and machine-readable so it can land in the Shoutout
 * audit log (deliveryStatus="filtered").
 *
 * Fail-open: if MiniMax is unreachable we let the message through and
 * lean on the existing moderator/held flow downstream.
 */

const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const CLASSIFIER_MODEL =
  process.env.MINIMAX_INTENT_MODEL ?? "MiniMax-M2.7";

export type IntentDecision = "worthy" | "noise" | "skip";

export interface IntentResult {
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

const SYSTEM_PROMPT = `You decide whether a YouTube live chat message should be aired aloud on a 24/7 AI radio station hosted by Lena.

The radio is intimate and mood-driven — listeners type messages, the host reads the worthy ones over music. We air messages that show genuine intent: shoutouts, dedications, requests, reactions with substance, questions, "playing this for…" notes, mood reports, place check-ins, thank-yous.

We DO NOT air pure noise: "lol", "first", "hi", single emojis, single repeated chars, "test", "ping", spam URLs, low-effort one-word reactions ("nice", "ok", "yes"), greetings without content ("hey", "yo"), bot pings.

Borderline goes WORTHY. The downstream moderator handles abusive content separately — your only job is "low-effort noise" vs "real intent".

Reply with EXACTLY one of these JSON shapes, no prose, no markdown:
{"d":"worthy"}
{"d":"noise","r":"<short reason: lol|emoji|greeting|too_short|spam|test|empty>"}

Examples (input → output):
"lol" → {"d":"noise","r":"low_effort"}
"first" → {"d":"noise","r":"first_comment"}
"hi" → {"d":"noise","r":"greeting"}
"hey lena" → {"d":"worthy"}
"shoutout to my brother in Bucharest" → {"d":"worthy"}
"can you play something dreamy?" → {"d":"worthy"}
"this is hitting different at 2am" → {"d":"worthy"}
"thanks for keeping me company tonight" → {"d":"worthy"}
"🔥🔥🔥" → {"d":"noise","r":"emoji_only"}
"yo" → {"d":"noise","r":"greeting"}
"first listening from Tokyo" → {"d":"worthy"}
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
  if (text.length < 4) return { worthy: false, reason: "too_short" };

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    // Fail-open — we let it through; the existing moderator still runs.
    return { worthy: true, reason: "classifier_not_configured" };
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
      worthy: true,
      reason:
        err instanceof Error && err.name === "TimeoutError"
          ? "classifier_timeout"
          : "classifier_network",
    };
  }

  if (!res.ok) {
    return { worthy: true, reason: `classifier_http_${res.status}` };
  }

  let json: MinimaxResponse;
  try {
    json = (await res.json()) as MinimaxResponse;
  } catch {
    return { worthy: true, reason: "classifier_parse_error" };
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
    return { worthy: true, reason: "classifier_no_decision" };
  }
  const decision = m[1].toLowerCase();
  if (decision === "worthy") return { worthy: true, reason: "ok" };
  if (decision === "noise") {
    const reasonMatch = reply.match(/"r"\s*:\s*"([^"]+)"/);
    return {
      worthy: false,
      reason: reasonMatch ? reasonMatch[1].slice(0, 32) : "noise",
    };
  }
  // Unknown decision token — fail-open.
  return { worthy: true, reason: `classifier_unknown:${decision.slice(0, 16)}` };
}
