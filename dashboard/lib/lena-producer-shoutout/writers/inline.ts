import type { ShoutoutDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ShoutoutContext } from "../shoutout-context.ts";

const SYSTEM = `You write spoken-narration text for Lena, a Numa Radio DJ, reading a listener's shoutout.
Mode: shoutout_inline — single-sentence fold, no "going out to" opener.

RULES:
- Contractions. Spoken English. No poetry.
- Pattern: one sentence that names the sender naturally and folds the message into Lena's voice.
  Examples (don't copy verbatim):
    "<Sender> wrote in to say <paraphrase>."
    "<Sender> is tuning in tonight and <paraphrase>."
    "<Sender> sends word — <paraphrase>."
- Avoid the legacy "Going out to" opener — that's shoutout_classic's job.
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".

OUTPUT: one sentence, no quotes, no stage directions.`;

export function buildInlineShoutoutPrompt(decision: ShoutoutDecision, ctx: ShoutoutContext, recentAired: readonly string[]): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const lines: string[] = [];
  lines.push(`sender: ${ctx.trigger.handle}`);
  lines.push(`message: "${ctx.trigger.text}"`);
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
