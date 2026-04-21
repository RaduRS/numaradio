import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { fetchBandwidthToday, DEFAULT_CAP_BYTES } from "./bandwidth.ts";

interface FakeRow {
  bytes_today: string | number;
  sampled_rows: string | number;
  unaccounted_rows: string | number;
}

function fakePool(row: FakeRow): Pool {
  return {
    query: async () => ({ rows: [row] }),
  } as unknown as Pool;
}

test("fetchBandwidthToday returns zero when nothing has played today", async () => {
  const pool = fakePool({ bytes_today: "0", sampled_rows: "0", unaccounted_rows: "0" });
  const result = await fetchBandwidthToday(pool);
  assert.equal(result.bytesToday, 0);
  assert.equal(result.sampledRows, 0);
  assert.equal(result.unaccountedRows, 0);
  assert.equal(result.capBytes, DEFAULT_CAP_BYTES);
  assert.equal(result.fractionUsed, 0);
});

test("fetchBandwidthToday converts string aggregates from pg to numbers", async () => {
  // pg returns bigint aggregates as strings by default.
  const pool = fakePool({
    bytes_today: "3221225472", // 3 GiB
    sampled_rows: "42",
    unaccounted_rows: "2",
  });
  const result = await fetchBandwidthToday(pool);
  assert.equal(result.bytesToday, 3_221_225_472);
  assert.equal(result.sampledRows, 42);
  assert.equal(result.unaccountedRows, 2);
});

test("fetchBandwidthToday computes fractionUsed against the default 6 GiB cap", async () => {
  const pool = fakePool({
    bytes_today: String(3 * 1024 ** 3), // 3 GiB
    sampled_rows: "10",
    unaccounted_rows: "0",
  });
  const result = await fetchBandwidthToday(pool);
  // 3 GiB out of 6 GiB = 0.5
  assert.ok(Math.abs(result.fractionUsed - 0.5) < 1e-6);
});

test("fetchBandwidthToday clips fractionUsed at 1.0 when over cap", async () => {
  const pool = fakePool({
    bytes_today: String(10 * 1024 ** 3), // 10 GiB, over 6 GiB cap
    sampled_rows: "40",
    unaccounted_rows: "0",
  });
  const result = await fetchBandwidthToday(pool);
  assert.equal(result.fractionUsed, 1.0);
});

test("fetchBandwidthToday reads B2_DAILY_CAP_GB env to override the cap", async () => {
  const prev = process.env.B2_DAILY_CAP_GB;
  process.env.B2_DAILY_CAP_GB = "10";
  try {
    const pool = fakePool({
      bytes_today: String(5 * 1024 ** 3),
      sampled_rows: "5",
      unaccounted_rows: "0",
    });
    const result = await fetchBandwidthToday(pool);
    assert.equal(result.capBytes, 10 * 1024 ** 3);
    assert.ok(Math.abs(result.fractionUsed - 0.5) < 1e-6);
  } finally {
    if (prev === undefined) delete process.env.B2_DAILY_CAP_GB;
    else process.env.B2_DAILY_CAP_GB = prev;
  }
});

test("fetchBandwidthToday handles numeric pg aggregates (future-proof)", async () => {
  // Future pg versions or custom drivers may return numbers directly.
  const pool = fakePool({
    bytes_today: 1024,
    sampled_rows: 1,
    unaccounted_rows: 0,
  });
  const result = await fetchBandwidthToday(pool);
  assert.equal(result.bytesToday, 1024);
  assert.equal(result.sampledRows, 1);
});
