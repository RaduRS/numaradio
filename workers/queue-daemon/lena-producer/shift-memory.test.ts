import { test } from "node:test";
import assert from "node:assert/strict";
import { ShiftMemory } from "./shift-memory.ts";
import type { ShiftEvent } from "./shift-event.ts";

function track(id: string, airedAt: number, genre: string | null = null, bpm: number | null = null): ShiftEvent {
  return { type: "track_aired", id, trackId: id, title: id, artist: null, genre, bpm, key: null, airedAt };
}

test("ShiftMemory.record appends to event log and view reflects it", () => {
  const mem = new ShiftMemory();
  const now = Date.now();
  mem.record(track("t1", now - 60_000, "rock", 120));
  const v = mem.view(now);
  assert.equal(v.events.length, 1);
  assert.equal(v.events[0].id, "t1");
});

test("ShiftMemory caps log at 50 events (oldest evicted)", () => {
  const mem = new ShiftMemory();
  const t0 = Date.now() - 60 * 60_000; // 1h ago
  for (let i = 0; i < 60; i += 1) {
    mem.record(track(`t${i}`, t0 + i * 60_000));
  }
  const v = mem.view(Date.now());
  assert.equal(v.events.length, 50);
  assert.equal(v.events[0].id, "t10"); // first 10 evicted
});

test("ShiftMemory view exposes counters, mood, show, recentLines", () => {
  const mem = new ShiftMemory();
  const now = Date.now();
  mem.record(track("t1", now - 60_000, "synth", 110));
  const v = mem.view(now);
  assert.equal(v.counters.tracksSinceLastShoutout, 1);
  assert.equal(v.mood.currentRun.genre, "synth");
  assert.ok(typeof v.show.name === "string");
  assert.equal(v.recentLines.length, 0);
});

test("ShiftMemory.recentLines returns last 10 lena_line_aired events newest-first", () => {
  const mem = new ShiftMemory();
  const now = Date.now();
  for (let i = 0; i < 12; i += 1) {
    mem.record({
      type: "lena_line_aired",
      id: `c${i}`,
      mode: "opinion",
      targetFocus: null,
      text: `line ${i}`,
      airedAt: now - (12 - i) * 60_000,
      trigger: "auto_track_boundary",
      addressedListener: null,
    });
  }
  const v = mem.view(now);
  assert.equal(v.recentLines.length, 10);
  assert.equal(v.recentLines[0].text, "line 11");
  assert.equal(v.recentLines[9].text, "line 2");
});

test("ShiftMemory.markCallbackUsed flips the used flag in callbackPool", () => {
  const mem = new ShiftMemory();
  const now = Date.now();
  mem.record({
    type: "shoutout_aired",
    id: "s1",
    handle: "anna",
    originalText: "hi",
    airedAt: now - 60_000,
  });
  assert.equal(mem.view(now).callbackPool[0].used, false);
  mem.markCallbackUsed("s1");
  assert.equal(mem.view(now).callbackPool[0].used, true);
});

test("ShiftMemory.evictOlderThan removes events older than the cutoff", () => {
  const mem = new ShiftMemory();
  const now = Date.now();
  mem.record(track("old", now - 10 * 60 * 60_000));
  mem.record(track("new", now - 5 * 60_000));
  mem.evictOlderThan(now - 60 * 60_000); // evict events older than 1h
  const v = mem.view(now);
  assert.equal(v.events.length, 1);
  assert.equal(v.events[0].id, "new");
});
