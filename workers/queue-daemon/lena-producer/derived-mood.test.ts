import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShiftEvent } from "./shift-event.ts";
import { deriveMood } from "./derived-mood.ts";

const T0 = 1_700_000_000_000;

function track(id: string, airedAt: number, genre: string | null, bpm: number | null): ShiftEvent {
  return { type: "track_aired", id, trackId: id, title: id, artist: null, genre, bpm, key: null, airedAt };
}

test("empty log → null run, steady trend, no avg bpm", () => {
  const m = deriveMood([], T0);
  assert.equal(m.currentRun.genre, null);
  assert.equal(m.currentRun.count, 0);
  assert.equal(m.tempoTrend, "steady");
  assert.equal(m.avgBpmLast5, null);
  assert.equal(m.topGenreThisHour, null);
});

test("currentRun captures the tail of consecutive same-genre tracks", () => {
  const log: ShiftEvent[] = [
    track("a", T0 - 500_000, "rock", 110),
    track("b", T0 - 400_000, "synth", 120),
    track("c", T0 - 300_000, "synth", 118),
    track("d", T0 - 200_000, "synth", 115),
    track("e", T0 - 100_000, "synth", 112),
  ];
  const m = deriveMood(log, T0);
  assert.equal(m.currentRun.genre, "synth");
  assert.equal(m.currentRun.count, 4);
  assert.equal(m.currentRun.startedAt, T0 - 400_000);
});

test("tempoTrend = 'falling' when last 5 BPMs descend", () => {
  const log: ShiftEvent[] = [
    track("a", T0 - 500_000, "x", 130),
    track("b", T0 - 400_000, "x", 124),
    track("c", T0 - 300_000, "x", 120),
    track("d", T0 - 200_000, "x", 114),
    track("e", T0 - 100_000, "x", 108),
  ];
  const m = deriveMood(log, T0);
  assert.equal(m.tempoTrend, "falling");
  assert.equal(m.avgBpmLast5, 119);
});

test("topGenreThisHour counts only tracks in the last 60min", () => {
  const log: ShiftEvent[] = [
    track("old", T0 - 90 * 60_000, "ambient", 80),
    track("a", T0 - 30 * 60_000, "rock", 130),
    track("b", T0 - 20 * 60_000, "rock", 132),
    track("c", T0 - 10 * 60_000, "synth", 115),
  ];
  const m = deriveMood(log, T0);
  assert.equal(m.topGenreThisHour, "rock");
});
