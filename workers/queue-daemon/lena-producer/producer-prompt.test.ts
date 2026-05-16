// workers/queue-daemon/lena-producer/producer-prompt.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProducerPrompt } from "./producer-prompt.ts";
import type { ProducerContext } from "./producer-context.ts";

function ctx(): ProducerContext {
  return {
    trigger: {
      source: "auto_track_boundary",
      nextTrack: { id: "x", title: "Dusk", artist: "Anna", genre: "synth", bpm: 112 },
    },
    now: { localTime: "23:15", bucket: "night" },
    show: { name: "Prime Hours", minutesIn: 120, minutesUntilNext: 300 },
    recentTracksSummary: "Last 3 tracks: 3 synth; BPM trending down to 115.",
    recentLinesSummary: "Last 2: opinion, aside.",
    callbackPool: [{ id: "s1", description: "Anna shouted out about the late-night set", minsAgo: 18 }],
    counters: { msSinceLastLine: 240_000, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: 1800_000, tracksSinceLastShoutout: 2 },
    mood: { currentRun: { genre: "synth", count: 3 }, tempoTrend: "falling", avgBpmLast5: 115, topGenreThisHour: "synth" },
    catalogCandidates: [],
  };
}

test("buildProducerPrompt returns {system, user} strings", () => {
  const p = buildProducerPrompt(ctx());
  assert.equal(typeof p.system, "string");
  assert.equal(typeof p.user, "string");
});

test("buildProducerPrompt enforces strict JSON output instruction in system", () => {
  const p = buildProducerPrompt(ctx());
  assert.match(p.system, /strict JSON/i);
  assert.match(p.system, /no prose/i);
});

test("buildProducerPrompt includes mode allowlist", () => {
  const p = buildProducerPrompt(ctx());
  assert.match(p.system, /"opinion"/);
  assert.match(p.system, /"callback"/);
  assert.match(p.system, /"aside"/);
  assert.match(p.system, /"silence"/);
});

test("buildProducerPrompt mentions silence is valid for auto_track_boundary", () => {
  const p = buildProducerPrompt(ctx());
  assert.match(p.system, /silence/i);
});

test("buildProducerPrompt user message contains trigger + show + tracks + mood", () => {
  const p = buildProducerPrompt(ctx());
  assert.match(p.user, /Dusk/);
  assert.match(p.user, /Prime Hours/);
  assert.match(p.user, /23:15/);
  assert.match(p.user, /synth/);
  assert.match(p.user, /Anna shouted out/);
});
