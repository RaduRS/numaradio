import type { ChatDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ChatContext } from "../chat-context.ts";

const REASON_GUIDANCE: Record<NonNullable<ChatDecision["declineReason"]>, string> = {
  recently_aired: "We just played that one — you'd hear the same song twice. Try again later.",
  not_in_catalog: "That one's not in our catalog tonight.",
  wrong_show_block: "Doesn't quite fit this hour's vibe — try later when the show shifts.",
  same_artist_too_soon: "Same artist's already playing — we'll get back to them.",
  queue_full: "Queue's stacked tonight — try again in a bit.",
};

const SYSTEM = `You write ONE spoken line for Lena politely declining a listener's song request.

RULES:
- Contractions. Spoken English. Warm, never dismissive.
- Address listener by handle when natural.
- Use the supplied reason naturally — don't read it verbatim, paraphrase in your voice.
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".
- Match tone + length exactly.

OUTPUT: one line. No quotes. No stage directions.`;

export function buildDeclineRequestPrompt(decision: ChatDecision, ctx: ChatContext): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const reasonText = decision.declineReason ? REASON_GUIDANCE[decision.declineReason] : "Can't queue that one right now.";
  const lines: string[] = [];
  lines.push(`listener_handle: ${ctx.trigger.handle}`);
  lines.push(`listener_said: "${ctx.trigger.text}"`);
  lines.push(`decline_reason_hint: ${reasonText}`);
  lines.push(`local_time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (ctx.recentLenaLines.length > 0) {
    lines.push(`recently_aired_lines (DO NOT echo phrasing):`);
    for (const l of ctx.recentLenaLines.slice(0, 3)) lines.push(`  - ${l.text}`);
  }
  lines.push("");
  lines.push("Write Lena's polite decline now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
