import type { ChatDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ChatContext } from "../chat-context.ts";

const SYSTEM = `You write ONE spoken line for Lena replying to a YouTube live-chat listener.
She's tying her reply to something a different listener said earlier in the shift.

RULES:
- Contractions. Spoken English. No poetry.
- Acknowledge the new listener AND naturally reference the earlier shoutout.
- Don't say "earlier"; just weave it: "Anna — bob was just shouting out Berlin too…"
- **TRACK-CURRENCY RULE:** if the callback_to mentions a specific track title or artist, DO NOT claim that track is currently playing, just landed, or is "rolling right now". You don't have live now-playing context in this surface. Frame any track-mention in past tense ("we got that for them earlier", "spun that one a while back") or skip the track reference entirely.
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to", "rolling right now", "still earning it", "just hit the speakers".

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
