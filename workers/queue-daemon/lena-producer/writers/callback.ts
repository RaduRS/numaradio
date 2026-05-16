// workers/queue-daemon/lena-producer/writers/callback.ts

import type { ProducerDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ProducerContext } from "../producer-context.ts";

const SYSTEM = `You write ONE spoken line for Lena, a calm slightly-studio-slang DJ on Numa Radio.
Mode: callback. You're tying THIS moment to something that happened earlier in the shift.

RULES:
- Contractions. Spoken English. No poetry.
- Reference the earlier event NATURALLY — don't say "earlier" or "before"; just place it: "Anna's been with us tonight", "third synth track since that shoutout".
- The callback_event is something that already happened. The next_track context (if any) is CURRENTLY playing. Reference both in past/present tense, never future.
- Do not use any 4+ word substring from recently_aired_lines.
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to", "queued up", "coming up next", "coming through now", "next one's".

OUTPUT: one line. No quotes. No stage directions.`;

export function buildCallbackPrompt(
  decision: ProducerDecision,
  ctx: ProducerContext,
  recentAiredLines: readonly string[],
): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const cb = ctx.callbackPool.find((c) => c.id === decision.callbackTo);
  const lines: string[] = [];
  lines.push(`target_focus: ${decision.targetFocus}`);
  lines.push(
    `callback_event: ${cb ? `${cb.description} (${cb.minsAgo}min ago)` : "(unresolved — write a general observation instead)"}`,
  );
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAiredLines.length > 0) {
    lines.push(`recently_aired_lines (DO NOT echo):`);
    for (const l of recentAiredLines) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write the line now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
