// workers/queue-daemon/lena-producer/writers/callback.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCallbackPrompt } from "./callback.ts";

const decision = { mode: "callback" as const, targetFocus: "the late-night thread Anna started", callbackTo: "s1", lengthHint: "medium" as const, tone: "warm" as const, addressListener: null };
const ctx = {
  trigger: { source: "auto_track_boundary" as const, nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
  now: { localTime: "23:30", bucket: "night" },
  show: { name: "Prime Hours", minutesIn: 60, minutesUntilNext: 360 },
  recentTracksSummary: "Last 3 tracks: 3 synth.",
  recentLinesSummary: "Last 2: opinion, aside.",
  callbackPool: [{ id: "s1", description: "Anna shouted out about loving the late-night set", minsAgo: 18 }],
  counters: { msSinceLastLine: 240_000, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: Infinity, tracksSinceLastShoutout: 0 },
  mood: { currentRun: { genre: "synth", count: 3 }, tempoTrend: "steady" as const, avgBpmLast5: 120, topGenreThisHour: "synth" },
};

test("buildCallbackPrompt includes the resolved callback description", () => {
  const p = buildCallbackPrompt(decision, ctx, []);
  assert.match(p.user, /Anna shouted out about loving the late-night set/);
});

test("buildCallbackPrompt has banned phrases list", () => {
  const p = buildCallbackPrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
});

test("buildCallbackPrompt resolves callbackTo='s1' from the pool", () => {
  const p = buildCallbackPrompt(decision, ctx, []);
  assert.match(p.user, /Anna/);
});

test("buildCallbackPrompt enforces track-currency rule against 'rolling right now' hallucinations", () => {
  const p = buildCallbackPrompt(decision, ctx, []);
  assert.match(p.system, /TRACK-CURRENCY RULE/, "system prompt must include the track-currency rule header");
  assert.match(p.system, /rolling right now/, "system prompt must explicitly ban 'rolling right now' for non-current tracks");
  assert.match(p.system, /still earning it/, "system prompt must explicitly ban 'still earning it'");
});
