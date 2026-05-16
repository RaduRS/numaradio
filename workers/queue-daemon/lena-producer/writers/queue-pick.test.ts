// workers/queue-daemon/lena-producer/writers/queue-pick.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueuePickPrompt } from "./queue-pick.ts";
import type { ProducerContext } from "../producer-context.ts";
import type { ProducerDecision } from "../modes.ts";

const ctx: ProducerContext = {
  trigger: { source: "auto_track_boundary" as const, nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
  now: { localTime: "23:15", bucket: "night" },
  show: { name: "Prime Hours", minutesIn: 60, minutesUntilNext: 360 },
  recentTracksSummary: "(none)",
  recentLinesSummary: "(none)",
  callbackPool: [],
  counters: { msSinceLastLine: Infinity, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: Infinity, tracksSinceLastShoutout: 0 },
  mood: { currentRun: { genre: null, count: 0 }, tempoTrend: "steady" as const, avgBpmLast5: null, topGenreThisHour: null },
  catalogCandidates: [{ id: "c1", title: "Dusk", artist: "Anna", genre: "synth", bpm: 112 }],
};

test("buildQueuePickPrompt includes picked track title/artist", () => {
  const decision: ProducerDecision = {
    mode: "queue_pick",
    targetFocus: "mood shift",
    callbackTo: null,
    lengthHint: "short",
    tone: "warm",
    addressListener: null,
    queueAction: { kind: "pick", trackId: "c1", reason: "mood_shift" },
  };
  const p = buildQueuePickPrompt(decision, ctx, []);
  assert.match(p.user, /Dusk/);
  assert.match(p.user, /Anna/);
});

test("buildQueuePickPrompt bans 'let it ride'", () => {
  const decision: ProducerDecision = {
    mode: "queue_pick",
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "short",
    tone: "warm",
    addressListener: null,
    queueAction: { kind: "pick", trackId: "c1", reason: "x" },
  };
  const p = buildQueuePickPrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
});

test("buildQueuePickPrompt falls back to generic tease when trackId not in catalog", () => {
  const decision: ProducerDecision = {
    mode: "queue_pick",
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "short",
    tone: "warm",
    addressListener: null,
    queueAction: { kind: "pick", trackId: "nope", reason: "x" },
  };
  const p = buildQueuePickPrompt(decision, ctx, []);
  assert.match(p.user, /unresolved/);
});

test("buildQueuePickPrompt includes pick_reason and length window", () => {
  const decision: ProducerDecision = {
    mode: "queue_pick",
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "medium",
    tone: "warm",
    addressListener: null,
    queueAction: { kind: "pick", trackId: "c1", reason: "breaking the synth run" },
  };
  const p = buildQueuePickPrompt(decision, ctx, []);
  assert.match(p.user, /breaking the synth run/);
  assert.match(p.user, /25-45 words/);
});
