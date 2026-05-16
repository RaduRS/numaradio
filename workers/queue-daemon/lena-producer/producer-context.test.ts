// workers/queue-daemon/lena-producer/producer-context.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ShiftMemory } from "./shift-memory.ts";
import type { ShiftEvent } from "./shift-event.ts";
import { buildProducerContext, type AutoTrackBoundaryTrigger } from "./producer-context.ts";

const T0 = 1_700_000_000_000;

function trackEv(id: string, airedAt: number, genre: string | null, bpm: number | null): ShiftEvent {
  return { type: "track_aired", id, trackId: id, title: id, artist: null, genre, bpm, key: null, airedAt };
}

test("buildProducerContext for auto_track_boundary: assembles trigger + show + counters + mood + recentTracksSummary", () => {
  const mem = new ShiftMemory();
  mem.record(trackEv("a", T0 - 400_000, "synth", 120));
  mem.record(trackEv("b", T0 - 300_000, "synth", 118));
  mem.record(trackEv("c", T0 - 200_000, "synth", 115));
  const trigger: AutoTrackBoundaryTrigger = {
    source: "auto_track_boundary",
    nextTrack: { id: "d", title: "Dusk", artist: "Anna", genre: "synth", bpm: 112 },
  };
  const ctx = buildProducerContext({ memoryView: mem.view(T0), trigger, nowMs: T0 });
  assert.equal(ctx.trigger.source, "auto_track_boundary");
  assert.equal(ctx.trigger.nextTrack.title, "Dusk");
  assert.ok(typeof ctx.show.name === "string");
  assert.equal(ctx.mood.currentRun.genre, "synth");
  assert.equal(ctx.mood.currentRun.count, 3);
  assert.match(ctx.recentTracksSummary, /3 track/);
});

test("buildProducerContext recentLinesSummary is empty when no Lena lines yet", () => {
  const mem = new ShiftMemory();
  const trigger: AutoTrackBoundaryTrigger = {
    source: "auto_track_boundary",
    nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null },
  };
  const ctx = buildProducerContext({ memoryView: mem.view(T0), trigger, nowMs: T0 });
  assert.equal(ctx.recentLinesSummary, "(no recent Lena lines this shift)");
});

test("buildProducerContext recentLinesSummary describes last 3 modes with ages", () => {
  const mem = new ShiftMemory();
  mem.record({ type: "lena_line_aired", id: "c1", mode: "opinion", targetFocus: null, text: "x", airedAt: T0 - 300_000, trigger: "auto_track_boundary", addressedListener: null });
  mem.record({ type: "lena_line_aired", id: "c2", mode: "aside", targetFocus: null, text: "y", airedAt: T0 - 200_000, trigger: "auto_track_boundary", addressedListener: null });
  const trigger: AutoTrackBoundaryTrigger = {
    source: "auto_track_boundary",
    nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null },
  };
  const ctx = buildProducerContext({ memoryView: mem.view(T0), trigger, nowMs: T0 });
  assert.match(ctx.recentLinesSummary, /opinion/);
  assert.match(ctx.recentLinesSummary, /aside/);
});

test("buildProducerContext callbackPool exposes top entries with description + minsAgo", () => {
  const mem = new ShiftMemory();
  mem.record({ type: "shoutout_aired", id: "s1", handle: "anna", originalText: "love this set", airedAt: T0 - 600_000 });
  const trigger: AutoTrackBoundaryTrigger = {
    source: "auto_track_boundary",
    nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null },
  };
  const ctx = buildProducerContext({ memoryView: mem.view(T0), trigger, nowMs: T0 });
  assert.equal(ctx.callbackPool.length, 1);
  assert.equal(ctx.callbackPool[0].id, "s1");
  assert.equal(ctx.callbackPool[0].minsAgo, 10);
});
