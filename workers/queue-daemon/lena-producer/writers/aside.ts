// workers/queue-daemon/lena-producer/writers/aside.ts

import type { ProducerDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ProducerContext } from "../producer-context.ts";

const SYSTEM = `You write ONE spoken line for Lena, a calm slightly-studio-slang DJ on Numa Radio.
Mode: aside. You're not talking about the music — you're talking about the moment.
Weather, time of day, late-shift vibe, station-running observation, a small noticing.

RULES:
- Contractions. Spoken English. No poetry.
- Match the bucket: late-night gets quieter, evening more conversational, morning brighter.
- Do not use any 4+ word substring from recently_aired_lines.
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".
- If the bucket is "late night" and target_focus is generic, prefer something a 2am DJ would actually notice.

OUTPUT: one line. No quotes. No stage directions.`;

export function buildAsidePrompt(
  decision: ProducerDecision,
  ctx: ProducerContext,
  recentAiredLines: readonly string[],
): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const lines: string[] = [];
  lines.push(`target_focus: ${decision.targetFocus}`);
  lines.push(`local_time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  lines.push(`show: ${ctx.show.name}`);
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
