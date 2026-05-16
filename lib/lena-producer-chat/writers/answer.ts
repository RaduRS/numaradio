import type { ChatDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ChatContext } from "../chat-context.ts";

const SYSTEM = `You write ONE spoken line for Lena replying to a YouTube live-chat listener.
She always replies — never silently. Warm, brief, in her DJ voice.

RULES:
- Contractions. Spoken English. No poetry. No "wandering piano lines" / "dawn peeking through curtains".
- Address the listener by their handle when natural. Don't force it.
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".
- Match tone + length exactly.

OUTPUT: one line. No quotes. No stage directions.`;

export function buildChatAnswerPrompt(decision: ChatDecision, ctx: ChatContext): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const lines: string[] = [];
  lines.push(`listener_handle: ${ctx.trigger.handle}`);
  lines.push(`listener_said: "${ctx.trigger.text}"`);
  lines.push(`local_time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  lines.push(`target_focus: ${decision.targetFocus}`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (ctx.recentLenaLines.length > 0) {
    lines.push(`recently_aired_lines (DO NOT echo phrasing):`);
    for (const l of ctx.recentLenaLines.slice(0, 3)) lines.push(`  - ${l.text}`);
  }
  lines.push("");
  lines.push("Write Lena's reply now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
