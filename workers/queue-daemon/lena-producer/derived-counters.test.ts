import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShiftEvent } from "./shift-event.ts";
import { deriveCounters } from "./derived-counters.ts";

const T0 = 1_700_000_000_000; // arbitrary epoch ms anchor

test("empty log → all 'since' counters are Infinity, tracksSinceLastShoutout is 0", () => {
  const c = deriveCounters([], T0);
  assert.equal(c.msSinceLastLine, Infinity);
  assert.equal(c.msSinceLastWeatherMention, Infinity);
  assert.equal(c.tracksSinceLastShoutout, 0);
});

test("msSinceLastLine reads most recent lena_line_aired", () => {
  const log: ShiftEvent[] = [
    {
      type: "lena_line_aired",
      id: "c1",
      mode: "opinion",
      targetFocus: null,
      text: "hello",
      airedAt: T0 - 30_000,
      trigger: "auto_track_boundary",
      addressedListener: null,
    },
  ];
  const c = deriveCounters(log, T0);
  assert.equal(c.msSinceLastLine, 30_000);
});

test("tracksSinceLastShoutout counts track_aired events after the latest shoutout_aired", () => {
  const log: ShiftEvent[] = [
    {
      type: "shoutout_aired",
      id: "s1",
      handle: "anna",
      originalText: "hi",
      airedAt: T0 - 300_000,
    },
    { type: "track_aired", id: "t1", trackId: "tr1", title: "A", artist: null, genre: null, bpm: null, key: null, airedAt: T0 - 200_000 },
    { type: "track_aired", id: "t2", trackId: "tr2", title: "B", artist: null, genre: null, bpm: null, key: null, airedAt: T0 - 100_000 },
  ];
  const c = deriveCounters(log, T0);
  assert.equal(c.tracksSinceLastShoutout, 2);
});

test("msSinceLastWeatherMention scans lena_line_aired.text for weather-ish tokens", () => {
  const log: ShiftEvent[] = [
    {
      type: "lena_line_aired",
      id: "c1",
      mode: "aside",
      targetFocus: "weather",
      text: "rain in Tokyo tonight",
      airedAt: T0 - 60_000,
      trigger: "auto_track_boundary",
      addressedListener: null,
    },
  ];
  const c = deriveCounters(log, T0);
  assert.equal(c.msSinceLastWeatherMention, 60_000);
});
