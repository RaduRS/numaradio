// workers/queue-daemon/lena-producer/producer-prompt.ts

import type { ProducerContext } from "./producer-context.ts";

const SYSTEM = `You are the producer for Lena, a calm slightly-studio-slang DJ on Numa Radio.
Your job: decide HOW she responds right now. You do NOT write her words — a separate Writer does.
You only emit a small JSON object describing the decision.

OUTPUT — strict JSON, no prose, no markdown, no code fence:
{
  "mode": "opinion" | "callback" | "aside" | "silence",
  "target_focus": "<one short phrase: what is this line about>",
  "callback_to": "<event id from callbackPool, or null>",
  "length_hint": "short" | "medium" | "long",
  "tone": "dry" | "warm" | "playful" | "low-key",
  "address_listener": null
}

RULES:
- "silence" is a valid and often correct choice here. Real DJs don't fill every break.
- Pick "callback" ONLY if a callbackPool entry genuinely fits the moment — never force one.
- Do not repeat a mode that already appears 3+ times in recentLinesSummary.
- length_hint: short=4-25 words, medium=25-45, long=50-80.
- Tone should track mood — low-key for mellow runs, playful for high-BPM moments, dry by default.
- For this trigger (auto_track_boundary), address_listener is always null.
- callback_to must be a literal id from callbackPool, or null. Never invent ids.`;

export function buildProducerPrompt(ctx: ProducerContext): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Trigger: auto_track_boundary`);
  lines.push(
    `Next track: "${ctx.trigger.nextTrack.title}" by ${ctx.trigger.nextTrack.artist ?? "?"} ` +
      `(${ctx.trigger.nextTrack.genre ?? "?"}, ${ctx.trigger.nextTrack.bpm ?? "?"} BPM)`,
  );
  lines.push(`Local time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  lines.push(
    `Show: ${ctx.show.name} — ${ctx.show.minutesIn}min in, ${ctx.show.minutesUntilNext}min until next`,
  );
  lines.push(`Recent tracks: ${ctx.recentTracksSummary}`);
  lines.push(`Recent Lena lines: ${ctx.recentLinesSummary}`);
  lines.push(
    `Mood: currentRun=${ctx.mood.currentRun.count}x ${ctx.mood.currentRun.genre ?? "?"}, ` +
      `trend=${ctx.mood.tempoTrend}, topGenreThisHour=${ctx.mood.topGenreThisHour ?? "?"}`,
  );
  lines.push(
    `Counters: msSinceLastLine=${ctx.counters.msSinceLastLine === Infinity ? "never" : Math.round(ctx.counters.msSinceLastLine / 1000) + "s"}, ` +
      `tracksSinceLastShoutout=${ctx.counters.tracksSinceLastShoutout}, ` +
      `msSinceLastWeather=${ctx.counters.msSinceLastWeatherMention === Infinity ? "never" : Math.round(ctx.counters.msSinceLastWeatherMention / 60000) + "min"}, ` +
      `msSinceLastStationDrop=${ctx.counters.msSinceLastStationDrop === Infinity ? "never" : Math.round(ctx.counters.msSinceLastStationDrop / 60000) + "min"}`,
  );

  if (ctx.callbackPool.length === 0) {
    lines.push(`Callback pool: (empty)`);
  } else {
    lines.push(`Callback pool:`);
    for (const c of ctx.callbackPool) {
      lines.push(`  - id=${c.id} (${c.minsAgo}min ago): ${c.description}`);
    }
  }

  lines.push("");
  lines.push("Emit the decision JSON now.");

  return { system: SYSTEM, user: lines.join("\n") };
}
