import { test } from "node:test";
import assert from "node:assert/strict";
import { StationFlagCache } from "./station-flag.ts";

test("StationFlagCache fetches on first call", async () => {
  let calls = 0;
  const cache = new StationFlagCache({
    ttlMs: 1000,
    fetchOnce: async () => { calls += 1; return true; },
    now: () => 0,
  });
  assert.equal(await cache.isEnabled(), true);
  assert.equal(calls, 1);
});

test("StationFlagCache returns cached value within TTL", async () => {
  let calls = 0;
  let t = 0;
  const cache = new StationFlagCache({
    ttlMs: 30_000,
    fetchOnce: async () => { calls += 1; return true; },
    now: () => t,
  });
  await cache.isEnabled();
  t = 10_000;  // 10s later, within TTL
  await cache.isEnabled();
  assert.equal(calls, 1);
});

test("StationFlagCache refreshes after TTL expires", async () => {
  let calls = 0;
  let t = 0;
  const responses = [true, false];
  const cache = new StationFlagCache({
    ttlMs: 30_000,
    fetchOnce: async () => { const v = responses[calls] ?? false; calls += 1; return v; },
    now: () => t,
  });
  assert.equal(await cache.isEnabled(), true);
  t = 31_000; // past TTL
  assert.equal(await cache.isEnabled(), false);
  assert.equal(calls, 2);
});

test("StationFlagCache keeps last good value on fetch error", async () => {
  let t = 0;
  let fail = false;
  const cache = new StationFlagCache({
    ttlMs: 1_000,
    fetchOnce: async () => { if (fail) throw new Error("boom"); return true; },
    now: () => t,
  });
  assert.equal(await cache.isEnabled(), true);
  t = 2_000;
  fail = true;
  assert.equal(await cache.isEnabled(), true); // sticky previous value
});
