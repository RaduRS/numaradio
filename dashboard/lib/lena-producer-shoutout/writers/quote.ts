import type { ShoutoutDecision } from "../modes";
import { LENGTH_WORDS } from "../modes";
import type { ShoutoutContext } from "../shoutout-context";

const SYSTEM = `You write spoken-narration text for Lena, a Numa Radio DJ.
Mode: shoutout_quote — quote the listener's words with minimal wrap.

RULES:
- Contractions. Spoken English.
- Pattern: brief intro ("<Sender> writes:" or "From <sender>:") then the listener's message quoted nearly verbatim (paraphrase only if it's too long or has spelling/grammar that won't read aloud well).
- The listener's voice is the star here, not Lena's. Keep her intro tight (≤6 words).
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".

OUTPUT: one short intro + the quote, no JSON, no stage directions.`;

export function buildQuoteShoutoutPrompt(decision: ShoutoutDecision, ctx: ShoutoutContext, recentAired: readonly string[]): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const lines: string[] = [];
  lines.push(`sender: ${ctx.trigger.handle}`);
  lines.push(`message_verbatim: "${ctx.trigger.text}"`);
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
