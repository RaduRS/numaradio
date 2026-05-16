// workers/queue-daemon/lena-producer/writers/opinion.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpinionPrompt } from "./opinion.ts";

const decision = { mode: "opinion" as const, targetFocus: "this dusky synth", callbackTo: null, lengthHint: "medium" as const, tone: "warm" as const, addressListener: null };
const ctx = {
  trigger: { source: "auto_track_boundary" as const, nextTrack: { id: "x", title: "Dusk", artist: "Anna", genre: "synth", bpm: 112 } },
  now: { localTime: "23:15", bucket: "night" },
  show: { name: "Prime Hours", minutesIn: 60, minutesUntilNext: 360 },
  recentTracksSummary: "Last 3 tracks: 3 synth.",
  recentLinesSummary: "Last 2: opinion, aside.",
  callbackPool: [],
  counters: { msSinceLastLine: 240_000, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: Infinity, tracksSinceLastShoutout: 0 },
  mood: { currentRun: { genre: "synth", count: 3 }, tempoTrend: "falling" as const, avgBpmLast5: 115, topGenreThisHour: "synth" },
};

test("buildOpinionPrompt returns {system, user}", () => {
  const p = buildOpinionPrompt(decision, ctx, []);
  assert.equal(typeof p.system, "string");
  assert.equal(typeof p.user, "string");
});

test("buildOpinionPrompt bans 'let it ride' and similar in system", () => {
  const p = buildOpinionPrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
  assert.match(p.system, /banned/i);
});

test("buildOpinionPrompt includes target_focus + next track in user", () => {
  const p = buildOpinionPrompt(decision, ctx, []);
  assert.match(p.user, /this dusky synth/);
  assert.match(p.user, /Dusk/);
});

test("buildOpinionPrompt embeds recent_aired_lines for anti-echo", () => {
  const p = buildOpinionPrompt(decision, ctx, ["that one's a vibe", "letting this synth pile up"]);
  assert.match(p.user, /that one's a vibe/);
  assert.match(p.user, /letting this synth pile up/);
});

test("buildOpinionPrompt includes length window from lengthHint", () => {
  const p = buildOpinionPrompt(decision, ctx, []);
  assert.match(p.user, /25-45/); // medium
});
