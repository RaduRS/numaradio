import type { ShoutoutContext } from "./shoutout-context";

const SYSTEM = `You are the producer for Lena, a calm slightly-studio-slang DJ on Numa Radio.
A listener submitted a shoutout to be read on air. Decide HOW Lena narrates it.
You do NOT write her words — a separate Writer does. You emit a small JSON object.

OUTPUT — strict JSON, no prose, no markdown:
{
  "mode": "shoutout_classic" | "shoutout_inline" | "shoutout_quote" | "shoutout_callback",
  "target_focus": "<one short phrase>",
  "callback_to": "<id from recentShoutouts/recentLenaLines, or null>",
  "length_hint": "short" | "medium",
  "tone": "dry" | "warm" | "playful" | "low-key"
}

MODE SHAPES (vary across consecutive shoutouts — don't pick classic 3x in a row):
- shoutout_classic: "Going out to <recipient>. <Sender> says <paraphrase>." (legacy shape)
- shoutout_inline: single-sentence fold ("<Sender> wrote in to say <paraphrase>")
- shoutout_quote: quote the listener with minimal wrap ("<Sender> writes: <quoted line>")
- shoutout_callback: tie to a recent listener event by id (only if recentShoutouts/recentLenaLines has a fitting entry)

RULES:
- "silence" is NEVER valid here. Every approved shoutout MUST air.
- Pick callback only if a recent entry genuinely fits (same recipient, same theme, same listener returning).
- recentLenaLines is the anti-echo signal: if the last 2 Lena lines used shape X, prefer a different shape.
- length_hint: short=12-30 words, medium=30-60.
- callback_to must be a literal id from recentShoutouts OR recentLenaLines, or null.`;

export function buildShoutoutProducerPrompt(ctx: ShoutoutContext): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`New shoutout from: ${ctx.trigger.handle}`);
  lines.push(`Message: "${ctx.trigger.text}"`);
  lines.push(`Local time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  if (ctx.recentShoutouts.length === 0) {
    lines.push(`Recent shoutouts: (none in last 30 min)`);
  } else {
    lines.push(`Recent shoutouts (last 30 min):`);
    for (const s of ctx.recentShoutouts) {
      lines.push(`  - id=${s.id} (${s.handle}, ${s.minsAgo}min ago): ${s.text.slice(0, 60)}`);
    }
  }
  if (ctx.recentLenaLines.length > 0) {
    lines.push(`Recent Lena lines (anti-echo):`);
    for (const l of ctx.recentLenaLines.slice(0, 3)) {
      lines.push(`  - ${l.text.slice(0, 80)}`);
    }
  }
  lines.push("");
  lines.push("Emit the decision JSON now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
