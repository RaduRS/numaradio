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

export type ModerationDecision = "allowed" | "rewritten" | "held" | "blocked";

export interface ModerationResult {
  decision: ModerationDecision;
  reason: string;
  text: string;
}

const SYSTEM_PROMPT = `You moderate listener shoutouts for an internet radio station. A host reads each approved shoutout live on air.

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

export async function moderateShoutout(rawText: string): Promise<ModerationResult> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    // Fail closed: treat missing config as "held" so nothing airs by accident.
    return { decision: "held", reason: "moderator_not_configured", text: rawText };
  }

  const res = await fetch(MINIMAX_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODERATION_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: rawText }],
    }),
  });

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
  const jsonMatch = textBlock.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { decision: "held", reason: "moderator_no_json", text: rawText };
  }

  let parsed: Partial<ModerationResult>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { decision: "held", reason: "moderator_bad_json", text: rawText };
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
