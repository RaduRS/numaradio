import { test } from "node:test";
import assert from "node:assert/strict";
import { StationConfigCache, type StationConfig } from "./station-config.ts";

const AUTO: StationConfig = { mode: "auto", forcedUntil: null, forcedBy: null };
const FORCED_ON_30: StationConfig = {
  mode: "forced_on",
  forcedUntil: new Date("2026-04-24T10:30:00Z"),
  forcedBy: "op@example.com",
};

test("StationConfigCache fetches on first call", async () => {
  let calls = 0;
  const cache = new StationConfigCache({
    ttlMs: 30_000,
    fetchOnce: async () => { calls += 1; return AUTO; },
    now: () => 0,
  });
  assert.deepEqual(await cache.read(), AUTO);
  assert.equal(calls, 1);
});

test("StationConfigCache returns cached value within TTL", async () => {
  let calls = 0;
  let t = 0;
  const cache = new StationConfigCache({
    ttlMs: 30_000,
    fetchOnce: async () => { calls += 1; return AUTO; },
    now: () => t,
  });
  await cache.read();
  t = 29_000;
  await cache.read();
  assert.equal(calls, 1);
});

test("StationConfigCache refreshes after TTL", async () => {
  let calls = 0;
  let t = 0;
  const seq = [AUTO, FORCED_ON_30];
  const cache = new StationConfigCache({
    ttlMs: 30_000,
    fetchOnce: async () => { const v = seq[calls]!; calls += 1; return v; },
    now: () => t,
  });
  assert.deepEqual(await cache.read(), AUTO);
  t = 31_000;
  assert.deepEqual(await cache.read(), FORCED_ON_30);
});

test("StationConfigCache keeps last good value on fetch error", async () => {
  let t = 0;
  let fail = false;
  const cache = new StationConfigCache({
    ttlMs: 1_000,
    fetchOnce: async () => { if (fail) throw new Error("boom"); return FORCED_ON_30; },
    now: () => t,
  });
  await cache.read();
  t = 2_000;
  fail = true;
  assert.deepEqual(await cache.read(), FORCED_ON_30); // sticky
});

test("StationConfigCache invalidate() forces next read to hit db", async () => {
  let calls = 0;
  const cache = new StationConfigCache({
    ttlMs: 30_000,
    fetchOnce: async () => { calls += 1; return AUTO; },
    now: () => 0,
  });
  await cache.read();
  cache.invalidate();
  await cache.read();
  assert.equal(calls, 2);
});
