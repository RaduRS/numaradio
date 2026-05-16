import type { ChatDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ChatContext } from "../chat-context.ts";

const SYSTEM = `You write ONE spoken line for Lena replying to a YouTube live-chat listener.
She's tying her reply to something a different listener said earlier in the shift.

RULES:
- Contractions. Spoken English. No poetry.
- Acknowledge the new listener AND naturally reference the earlier shoutout.
- Don't say "earlier"; just weave it: "Anna — bob was just shouting out Berlin too…"
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".

OUTPUT: one line. No quotes. No stage directions.`;

export function buildChatCallbackPrompt(decision: ChatDecision, ctx: ChatContext): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const cb = ctx.recentShoutouts.find((s) => s.id === decision.callbackTo);
  const lines: string[] = [];
  lines.push(`listener_handle: ${ctx.trigger.handle}`);
  lines.push(`listener_said: "${ctx.trigger.text}"`);
  lines.push(`callback_to: ${cb ? `${cb.handle} (${cb.minsAgo}min ago): ${cb.originalText.slice(0, 60)}` : "(unresolved — drop the callback, write a direct answer)"}`);
  lines.push(`local_time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  lines.push(`target_focus: ${decision.targetFocus}`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  lines.push("");
  lines.push("Write Lena's reply now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
