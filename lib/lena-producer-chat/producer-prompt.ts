import type { ChatContext } from "./chat-context.ts";

const REPLY_SYSTEM = `You are the producer for Lena, a calm slightly-studio-slang DJ on Numa Radio.
A listener just sent her a message on YouTube live chat. Decide HOW she responds.
You do NOT write her words — a separate Writer does. You emit a small JSON object.

OUTPUT — strict JSON, no prose, no markdown:
{
  "mode": "answer" | "callback",
  "target_focus": "<one short phrase>",
  "callback_to": "<id from recentShoutouts, or null>",
  "length_hint": "short" | "medium",
  "tone": "dry" | "warm" | "playful" | "low-key",
  "picked_track_id": null,
  "decline_reason": null
}

RULES:
- "silence" is NEVER valid here. Listener directly addressed Lena — she always responds.
- "callback" only if a recentShoutouts entry genuinely fits (e.g., listener's question relates to an earlier shoutout, OR the same listener appears recently).
- length_hint: short=4-25 words, medium=25-45.
- Tone tracks bucket: night/late-night → warm or low-key, morning → playful, afternoon → dry by default.
- callback_to must be a literal id from recentShoutouts, or null. Never invent.
- picked_track_id and decline_reason MUST both be null for reply-family modes.`;

const REQUEST_SYSTEM = `You are the producer for Lena, deciding how she handles a listener's song request on YouTube live chat.

OUTPUT — strict JSON, no prose, no markdown:
{
  "mode": "accept_request" | "accept_request_deferred" | "decline_request",
  "target_focus": "<one short phrase>",
  "callback_to": null,
  "length_hint": "short" | "medium",
  "tone": "dry" | "warm" | "playful" | "low-key",
  "picked_track_id": "<id from catalogCandidates, or null>",
  "decline_reason": "recently_aired" | "not_in_catalog" | "wrong_show_block" | "same_artist_too_soon" | "queue_full" | null
}

RULES:
- "silence" is NEVER valid.
- If catalogCandidates is empty → decline_request, decline_reason="not_in_catalog".
- If the best catalogCandidate's id appears in recentlyAiredTrackIds → decline_request, decline_reason="recently_aired".
- If queueDepth >= 2 → accept_request_deferred (Lena tells the listener they're behind others).
- Otherwise → accept_request, pick the highest-score (first) candidate.
- picked_track_id MUST be a literal id from catalogCandidates (never invent), or null on decline.
- decline_reason MUST be set when mode="decline_request" (null otherwise).
- callback_to MUST be null for request-family modes.
- length_hint: short=4-25 words, medium=25-45.
- Tone tracks bucket: night/late-night → warm or low-key, morning → playful, afternoon → dry by default.`;

export function buildChatProducerPrompt(ctx: ChatContext): { system: string; user: string } {
  const isRequest = ctx.trigger.intent === "request" || ctx.trigger.intent === "shoutout_with_request";
  const system = isRequest ? REQUEST_SYSTEM : REPLY_SYSTEM;

  const lines: string[] = [];
  lines.push(`Listener: ${ctx.trigger.handle}`);
  lines.push(`Message: "${ctx.trigger.text}"`);
  lines.push(`Local time: ${ctx.now.localTime} (${ctx.now.bucket})`);

  if (isRequest) {
    if (ctx.catalogCandidates.length === 0) {
      lines.push(`Catalog candidates: (none — request didn't match any library track)`);
    } else {
      lines.push(`Catalog candidates (pick from these by id):`);
      for (const c of ctx.catalogCandidates) {
        lines.push(`  - id=${c.id}: "${c.title}" by ${c.artist ?? "?"} (${c.genre ?? "?"})`);
      }
    }
    const recent = ctx.recentlyAiredTrackIds.slice(0, 10).join(", ") || "(none)";
    lines.push(`Recently aired track ids (decline if pick is here): ${recent}`);
    lines.push(`Current queue depth (priority_request): ${ctx.queueDepth}`);
  }

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
  return { system, user: lines.join("\n") };
}
