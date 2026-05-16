import type { ShoutoutDecision } from "../modes";
import { LENGTH_WORDS } from "../modes";
import type { ShoutoutContext } from "../shoutout-context";

const SYSTEM = `You write a spoken response for Lena, Numa Radio's host, when a listener sends a compliment or shoutout TO the station itself (Numa Radio / Lena / the show / the music).

This is NOT narration. Lena responds in FIRST PERSON, warm and personable. The listener is talking TO her — she replies like a host would, briefly + with warmth. She CAN paraphrase what they said.

RULES:
- First person ("appreciate that", "thank you", "we're keeping it going", "love hearing this").
- Address the listener by their handle ONCE if it fits naturally.
- Brief, real. 1-2 sentences. Examples:
  "Slim said the flyest jams — appreciate it. More coming, we'll keep that hot."
  "Anna, that means a lot. Stay with us tonight, more good stuff up."
  "Whoever's out there saying nice things about the station — thank you, we hear you. Back to the music."
- BANNED phrases: "let it ride", "going out to", "hope this reaches them", "we'll take that one".
- Do NOT narrate ("Anna writes that..." / "Anna says..."). That's the classic mode, not this one.
- Don't repeat the listener's words verbatim — paraphrase + add Lena's voice.

OUTPUT: one or two sentences, no quotes, no stage directions.`;

export function buildMetaShoutoutPrompt(
  decision: ShoutoutDecision,
  ctx: ShoutoutContext,
  recentAired: readonly string[],
): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const lines: string[] = [];
  lines.push(`listener_handle: ${ctx.trigger.handle}`);
  lines.push(`listener_said: ${JSON.stringify(ctx.trigger.text)}`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAired.length > 0) {
    lines.push(`recently_aired (DO NOT echo phrasing):`);
    for (const l of recentAired.slice(0, 3)) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write Lena's first-person warm response now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
