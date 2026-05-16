import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShiftEvent } from "./shift-event.ts";
import { deriveCallbacks } from "./derived-callbacks.ts";

const T0 = 1_700_000_000_000;

test("empty log → empty pool", () => {
  assert.deepEqual(deriveCallbacks([], T0, new Set()), []);
});

test("shoutout becomes a callback candidate with minsAgo", () => {
  const log: ShiftEvent[] = [
    { type: "shoutout_aired", id: "s1", handle: "anna", originalText: "love this set", airedAt: T0 - 18 * 60_000 },
  ];
  const pool = deriveCallbacks(log, T0, new Set());
  assert.equal(pool.length, 1);
  assert.equal(pool[0].id, "s1");
  assert.equal(pool[0].sourceType, "shoutout");
  assert.equal(pool[0].minsAgo, 18);
  assert.equal(pool[0].used, false);
});

test("usedSet flips the used flag", () => {
  const log: ShiftEvent[] = [
    { type: "shoutout_aired", id: "s1", handle: "anna", originalText: "x", airedAt: T0 - 60_000 },
  ];
  const pool = deriveCallbacks(log, T0, new Set(["s1"]));
  assert.equal(pool[0].used, true);
});

test("pool is capped at 8 most recent eligible events", () => {
  const log: ShiftEvent[] = Array.from({ length: 20 }, (_, i) => ({
    type: "shoutout_aired",
    id: `s${i}`,
    handle: "x",
    originalText: "y",
    airedAt: T0 - (20 - i) * 60_000,
  }));
  const pool = deriveCallbacks(log, T0, new Set());
  assert.equal(pool.length, 8);
  // last 8 ids should be the most recent (s12..s19)
  assert.equal(pool[0].id, "s19");
  assert.equal(pool[7].id, "s12");
});

test("track_aired is NOT a callback candidate by default (callbacks are listener-driven)", () => {
  const log: ShiftEvent[] = [
    { type: "track_aired", id: "t1", trackId: "tr1", title: "X", artist: "Y", genre: null, bpm: null, key: null, airedAt: T0 - 60_000 },
  ];
  assert.equal(deriveCallbacks(log, T0, new Set()).length, 0);
});

test("derives friendly handle (strips [YT] prefix + @)", () => {
  const log: ShiftEvent[] = [
    { type: "shoutout_aired", id: "s1", handle: "[YT] @inRhino", originalText: "hi", airedAt: T0 - 60_000 },
  ];
  const pool = deriveCallbacks(log, T0, new Set());
  assert.match(pool[0].description, /Shoutout from inRhino/);
  assert.doesNotMatch(pool[0].description, /\[YT\]|@inRhino/);
});
