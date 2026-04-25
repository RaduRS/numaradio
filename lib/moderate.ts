/**
 * Lightweight MiniMax-backed moderator for listener shoutouts.
 *
 * Uses MiniMax's Anthropic-compatible /v1/messages endpoint with a small
 * classifier prompt. Returns one of:
 *   - "allowed"  → text is fine, air it as-is
 *   - "rewritten" → text edited into a broadcast-safe version
 *   - "held"     → borderline; operator must approve (future: dashboard queue)
 *   - "blocked"  → hard no (slurs, threats, explicit content, spam)
 */

const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const MODERATION_MODEL = process.env.MINIMAX_MODERATION_MODEL ?? "MiniMax-M2.7";

/**
 * Deterministic pre-filter for profanity. Anything matching here skips the
 * LLM entirely and lands in `held` so the operator reviews it. Word-boundary
 * matching keeps "class"/"mass"/"assume" from false-positive on "ass".
 */
const PROFANITY_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: "motherfucker", regex: /\bmotherfuck(ing|ed|er|ers|s)?\b/i },
  { name: "fuck", regex: /\bfuck(ing|ed|er|ers|s)?\b/i },
  { name: "bullshit", regex: /\bbullshit\b/i },
  { name: "shit", regex: /\bshit(ty|s|ting|ted|head|heads)?\b/i },
  { name: "ass", regex: /\bass(es|hole|holes|wipe|wipes|hat|hats)?\b/i },
  { name: "bitch", regex: /\bbitch(es|ing|y)?\b/i },
  { name: "cunt", regex: /\bcunt(s)?\b/i },
  { name: "dick", regex: /\bdick(head|s|heads)?\b/i },
  { name: "cock", regex: /\bcock(sucker|suckers|s)?\b/i },
  { name: "pussy", regex: /\bpussy\b/i },
  { name: "bastard", regex: /\bbastard(s)?\b/i },
];

export function profanityPrefilter(text: string): { matched: string } | null {
  for (const { name, regex } of PROFANITY_PATTERNS) {
    if (regex.test(text)) return { matched: name };
  }
  return null;
}

export type ModerationDecision = "allowed" | "rewritten" | "held" | "blocked";

export interface ModerationResult {
  decision: ModerationDecision;
  reason: string;
  text: string;
}

const SHOUTOUT_SYSTEM_PROMPT = `You moderate listener shoutouts for an internet radio station. A host reads each approved shoutout live on air.

Classify the submission into exactly one of:
- allowed: friendly, clearly broadcast-safe, no edits needed
- rewritten: mostly ok but needs a tidy-up (spelling, tone, removing minor profanity); provide a cleaned version
- held: ambiguous context, possibly a named person being called out, borderline language, or unclear intent — a human operator should review
- blocked: slurs, threats, harassment, explicit sexual content, doxxing, political incitement, or clear spam/advertising

Rules for "rewritten":
- Preserve the listener's name and the sentiment.
- Fix typos and soften only actual profanity.
- Never insert new claims, facts, or names.
- Max 240 characters.

Respond with ONLY a single minified JSON object, no surrounding text, matching:
{"decision":"allowed|rewritten|held|blocked","reason":"short explanation","text":"original or rewritten"}

If decision is "allowed", "text" must equal the original. If "blocked" or "held", "text" should echo the original (never empty).`;

const SONG_SYSTEM_PROMPT = `You moderate listener-submitted creative briefs for a MiniMax music-generation feature on an internet radio station. Each submission is a short description of the song the listener wants us to generate: mood, genre, tempo, key, instruments, vibe, scene. An AI generates music from the prompt and the resulting track airs on the stream.

Classify the submission into exactly one of:
- allowed: a normal creative music brief — moods, genres, tempos, instruments, emotions (including dark ones like "rage", "heartbreak", "funeral", "angry", "sad"), weather, colors, places, fictional scenes
- rewritten: mostly fine but needs a small edit (e.g. strip a real public person's name, remove a targeted barb) — provide a cleaned version, max 240 chars, preserve the musical intent
- held: unclear or ambiguous — e.g. mentions a specific living public figure in an unclear way; operator should review
- blocked: hate speech, slurs, explicit sexual content involving minors, threats against real people, attempts to impersonate identifiable artists/celebrities for defamation, doxxing, clearly illegal activity incitement

Default to "allowed". This is a creative brief, not a message read on air; dark or intense moods are normal and not grounds to hold or block. Do NOT apply the "must be a shoutout format" rule — it does not apply here.

Respond with ONLY a single minified JSON object, no surrounding text, matching:
{"decision":"allowed|rewritten|held|blocked","reason":"short explanation","text":"original or rewritten"}

If decision is "allowed", "text" must equal the original. If "blocked" or "held", "text" should echo the original (never empty).`;

/**
 * Pull a valid JSON object out of the moderator's reply.
 * Tolerates markdown code fences, stray prose, and multiple braces.
 */
function extractModerationJson(raw: string): Partial<ModerationResult> | null {
  const stripped = raw
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  // Fast path: whole response is valid JSON.
  try {
    return JSON.parse(stripped);
  } catch {
    // fall through
  }

  // Scan for the first balanced top-level object.
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = stripped.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          start = -1;
          // keep scanning for the next {...}
        }
      }
    }
  }
  return null;
}

async function runModerator(
  systemPrompt: string,
  rawText: string,
): Promise<ModerationResult> {
  const hit = profanityPrefilter(rawText);
  if (hit) {
    return {
      decision: "held",
      reason: `profanity_prefilter:${hit.matched}`,
      text: rawText,
    };
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return { decision: "held", reason: "moderator_not_configured", text: rawText };
  }

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
        model: MODERATION_MODEL,
        // MiniMax-M2.7 is a reasoning model — its `thinking` block runs
        // before the actual decision JSON and can easily swallow a small
        // budget. 3200 leaves comfortable headroom; operator has tokens.
        max_tokens: 3200,
        system: systemPrompt,
        messages: [{ role: "user", content: rawText }],
      }),
      // Fail-closed on a hung upstream — without this the booth submit
      // route hangs until Vercel's function timeout and the user sees
      // their spinner stall for 15+ seconds.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? "moderator_timeout"
        : "moderator_network";
    return { decision: "held", reason, text: rawText };
  }

  if (!res.ok) {
    return {
      decision: "held",
      reason: `moderator_http_${res.status}`,
      text: rawText,
    };
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textBlock = data.content?.find((b) => b.type === "text" && b.text)?.text ?? "";

  const parsed = extractModerationJson(textBlock);
  if (!parsed) {
    console.warn("[moderate] non-JSON moderator output:", textBlock.slice(0, 400));
    return { decision: "held", reason: "moderator_no_json", text: rawText };
  }

  const decision = parsed.decision;
  if (
    decision !== "allowed" &&
    decision !== "rewritten" &&
    decision !== "held" &&
    decision !== "blocked"
  ) {
    return { decision: "held", reason: "moderator_unknown_decision", text: rawText };
  }

  const text =
    typeof parsed.text === "string" && parsed.text.trim() ? parsed.text.trim() : rawText;
  const reason =
    typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim().slice(0, 200)
      : decision;

  return { decision, reason, text };
}

export function moderateShoutout(rawText: string): Promise<ModerationResult> {
  return runModerator(SHOUTOUT_SYSTEM_PROMPT, rawText);
}

export function moderateSongPrompt(rawText: string): Promise<ModerationResult> {
  return runModerator(SONG_SYSTEM_PROMPT, rawText);
}
