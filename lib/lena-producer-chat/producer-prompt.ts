import type { ChatContext } from "./chat-context.ts";

const SYSTEM = `You are the producer for Lena, a calm slightly-studio-slang DJ on Numa Radio.
A listener just sent her a message on YouTube live chat. Decide HOW she responds.
You do NOT write her words — a separate Writer does. You emit a small JSON object.

OUTPUT — strict JSON, no prose, no markdown:
{
  "mode": "answer" | "callback",
  "target_focus": "<one short phrase>",
  "callback_to": "<id from recentShoutouts, or null>",
  "length_hint": "short" | "medium",
  "tone": "dry" | "warm" | "playful" | "low-key"
}

RULES:
- "silence" is NEVER valid here. Listener directly addressed Lena — she always responds.
- "callback" only if a recentShoutouts entry genuinely fits (e.g., listener's question relates to an earlier shoutout, OR the same listener appears recently).
- length_hint: short=4-25 words, medium=25-45.
- Tone tracks bucket: night/late-night → warm or low-key, morning → playful, afternoon → dry by default.
- callback_to must be a literal id from recentShoutouts, or null. Never invent.`;

export function buildChatProducerPrompt(ctx: ChatContext): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Listener: ${ctx.trigger.handle}`);
  lines.push(`Message: "${ctx.trigger.text}"`);
  lines.push(`Local time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  if (ctx.recentShoutouts.length === 0) {
    lines.push(`Recent shoutouts: (none in last 30 min)`);
  } else {
    lines.push(`Recent shoutouts (last 30 min):`);
    for (const s of ctx.recentShoutouts) {
      lines.push(`  - id=${s.id} (${s.handle}, ${s.minsAgo}min ago): ${s.originalText.slice(0, 60)}`);
    }
  }
  if (ctx.recentLenaLines.length > 0) {
    lines.push(`Recent Lena lines (for anti-echo awareness):`);
    for (const l of ctx.recentLenaLines.slice(0, 3)) {
      lines.push(`  - ${l.text.slice(0, 80)}`);
    }
  }
  lines.push("");
  lines.push("Emit the decision JSON now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
