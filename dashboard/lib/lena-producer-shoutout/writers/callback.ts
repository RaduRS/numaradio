import type { ShoutoutDecision } from "../modes";
import { LENGTH_WORDS } from "../modes";
import type { ShoutoutContext } from "../shoutout-context";

const SYSTEM = `You write spoken-narration text for Lena, a Numa Radio DJ.
Mode: shoutout_callback — tie this new shoutout to a recent listener event.

RULES:
- Contractions. Spoken English.
- Acknowledge the new sender AND naturally reference the earlier event (don't say "earlier" — just weave it: "Anna joining Bob from Berlin — Bob's been here for a while too").
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".

OUTPUT: one or two lines, no quotes, no stage directions.`;

export function buildCallbackShoutoutPrompt(decision: ShoutoutDecision, ctx: ShoutoutContext, recentAired: readonly string[]): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const cb = ctx.recentShoutouts.find((s) => s.id === decision.callbackTo);
  const lines: string[] = [];
  lines.push(`sender: ${ctx.trigger.handle}`);
  lines.push(`message: "${ctx.trigger.text}"`);
  lines.push(`callback_event: ${cb ? `${cb.handle} (${cb.minsAgo}min ago): ${cb.text.slice(0, 80)}` : "(unresolved — write a general acknowledgement instead)"}`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAired.length > 0) {
    lines.push(`recently_aired (DO NOT echo):`);
    for (const l of recentAired.slice(0, 3)) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write Lena's narration now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
