// workers/queue-daemon/lena-producer/writers/aside.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAsidePrompt } from "./aside.ts";

const decision = { mode: "aside" as const, targetFocus: "late-shift station vibe", callbackTo: null, lengthHint: "short" as const, tone: "low-key" as const, addressListener: null };
const ctx = {
  trigger: { source: "auto_track_boundary" as const, nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
  now: { localTime: "02:30", bucket: "late night" },
  show: { name: "Night Shift", minutesIn: 90, minutesUntilNext: 60 },
  recentTracksSummary: "(no recent tracks)",
  recentLinesSummary: "(no recent Lena lines this shift)",
  callbackPool: [],
  counters: { msSinceLastLine: Infinity, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: Infinity, tracksSinceLastShoutout: 0 },
  mood: { currentRun: { genre: null, count: 0 }, tempoTrend: "steady" as const, avgBpmLast5: null, topGenreThisHour: null },
};

test("buildAsidePrompt returns {system, user}", () => {
  const p = buildAsidePrompt(decision, ctx, []);
  assert.equal(typeof p.system, "string");
});

test("buildAsidePrompt bans 'let it ride'", () => {
  const p = buildAsidePrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
});

test("buildAsidePrompt mentions the bucket and localTime so wording matches the hour", () => {
  const p = buildAsidePrompt(decision, ctx, []);
  assert.match(p.user, /02:30/);
  assert.match(p.user, /late night/);
});

test("buildAsidePrompt includes target_focus", () => {
  const p = buildAsidePrompt(decision, ctx, []);
  assert.match(p.user, /late-shift station vibe/);
});
