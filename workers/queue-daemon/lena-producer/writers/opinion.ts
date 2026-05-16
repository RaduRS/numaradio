// workers/queue-daemon/lena-producer/writers/opinion.ts

import type { ProducerDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ProducerContext } from "../producer-context.ts";

const SYSTEM = `You write ONE spoken line for Lena, a calm slightly-studio-slang DJ on Numa Radio.
Mode: opinion. You react to a track with TASTE — you have a view, not a description.

RULES:
- Contractions. Spoken English. No poetry. No "wandering piano lines" / "dawn peeking through curtains".
- Have an opinion: "I love this one", "earned its slot tonight", "I'd skip but it grew on me", "this is a re-listen kind of track".
- Reference the track in PAST or PRESENT tense — it is CURRENTLY PLAYING and ending as Lena speaks. "That one's a re-listen.", "This one's been growing on me.", "Just heard the synth turn on that one." Never future tense ("queued up", "next up", "coming through next").
- Do not use any 4+ word substring from recently_aired_lines.
- BANNED phrases (forever): "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to", "queued up", "coming up next", "coming through now", "next one's".
- Do not name the show unless it genuinely serves the line.

OUTPUT: one line. No quotes. No stage directions. No JSON. Just the spoken text.`;

export function buildOpinionPrompt(
  decision: ProducerDecision,
  ctx: ProducerContext,
  recentAiredLines: readonly string[],
): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const t = ctx.trigger.nextTrack;
  const lines: string[] = [];
  lines.push(`target_focus: ${decision.targetFocus}`);
  lines.push(`next_track: "${t.title}" by ${t.artist ?? "unknown"} (${t.genre ?? "?"}, ${t.bpm ?? "?"} BPM)`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAiredLines.length > 0) {
    lines.push(`recently_aired_lines (DO NOT echo their phrasing):`);
    for (const l of recentAiredLines) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write the line now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
