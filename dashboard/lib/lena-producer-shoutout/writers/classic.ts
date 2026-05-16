import type { ShoutoutDecision } from "../modes";
import { LENGTH_WORDS } from "../modes";
import type { ShoutoutContext } from "../shoutout-context";

const SYSTEM = `You write spoken-narration text for Lena, a Numa Radio DJ, reading a listener's shoutout.
Mode: shoutout_classic — the legacy "Going out to X. Y says Z." shape.

RULES:
- Contractions. Spoken English. No poetry.
- Pattern: open with "Going out to <recipient>" OR "This one's going out to <recipient>" then "<Sender> says <paraphrase>".
- Optional final aside (sparingly — only when one genuinely lands).
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them".

OUTPUT: 1-2 lines, no quotes, no stage directions.`;

export function buildClassicShoutoutPrompt(decision: ShoutoutDecision, ctx: ShoutoutContext, recentAired: readonly string[]): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const lines: string[] = [];
  lines.push(`sender: ${ctx.trigger.handle}`);
  lines.push(`message: "${ctx.trigger.text}"`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAired.length > 0) {
    lines.push(`recently_aired (DO NOT echo openers):`);
    for (const l of recentAired.slice(0, 3)) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write Lena's narration now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
