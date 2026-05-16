// workers/queue-daemon/lena-producer/writers/queue-pick.ts

import type { ProducerDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ProducerContext } from "../producer-context.ts";

const SYSTEM = `You write ONE spoken line for Lena, a calm slightly-studio-slang DJ on Numa Radio.
Mode: queue_pick. You're announcing a track YOU just chose to play next.

RULES:
- Contractions. Spoken English. No poetry.
- Tease the pick — name the artist + title naturally, give a brief reason ("breaking up the synth run", "pulling something quieter for the hour", "this one's been on my mind tonight").
- Do not use any 4+ word substring from recently_aired_lines.
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".
- The track WILL play after this — be honest. Don't promise something else.

OUTPUT: one line. No quotes. No stage directions.`;

export function buildQueuePickPrompt(
  decision: ProducerDecision,
  ctx: ProducerContext,
  recentAiredLines: readonly string[],
): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const action = decision.queueAction;
  const picked = action ? ctx.catalogCandidates.find((c) => c.id === action.trackId) : null;
  const lines: string[] = [];
  lines.push(`target_focus: ${decision.targetFocus}`);
  lines.push(
    `picked_track: ${picked ? `"${picked.title}" by ${picked.artist ?? "?"} (${picked.genre ?? "?"})` : "(unresolved — write a generic next-track tease)"}`,
  );
  lines.push(`pick_reason: ${action?.reason ?? "(unspecified)"}`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAiredLines.length > 0) {
    lines.push(`recently_aired_lines (DO NOT echo):`);
    for (const l of recentAiredLines) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write the announcement now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
