import type { ChatDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ChatContext } from "../chat-context.ts";

const SYSTEM = `You write ONE spoken line for Lena confirming a listener's song request she's queuing — but they're BEHIND other listener picks already in queue.

RULES:
- Contractions. Spoken English. Warm, honest about the wait.
- Address listener by handle when natural.
- Name the track + artist + roughly when ("queued you up behind two other picks — about six minutes out").
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".
- Match tone + length exactly.

OUTPUT: one line. No quotes. No stage directions.`;

export function buildAcceptRequestDeferredPrompt(decision: ChatDecision, ctx: ChatContext): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const picked = ctx.catalogCandidates.find((c) => c.id === decision.pickedTrackId);
  // Rough wait estimate: avg track ~3min × queueDepth
  const minsBehind = Math.max(3, ctx.queueDepth * 3);
  const lines: string[] = [];
  lines.push(`listener_handle: ${ctx.trigger.handle}`);
  lines.push(`listener_said: "${ctx.trigger.text}"`);
  lines.push(`picked_track: ${picked ? `"${picked.title}" by ${picked.artist ?? "?"}` : "(unresolved)"}`);
  lines.push(`queue_depth_behind: ${ctx.queueDepth} other picks (~${minsBehind} min out)`);
  lines.push(`local_time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (ctx.recentLenaLines.length > 0) {
    lines.push(`recently_aired_lines (DO NOT echo phrasing):`);
    for (const l of ctx.recentLenaLines.slice(0, 3)) lines.push(`  - ${l.text}`);
  }
  lines.push("");
  lines.push("Write Lena's deferred confirmation now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
