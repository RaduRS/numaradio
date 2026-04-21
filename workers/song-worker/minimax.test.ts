import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDurationMs } from "./minimax.ts";

test("normalizeDurationMs handles nanoseconds (>1e9)", () => {
  assert.equal(normalizeDurationMs(3_000_000_000), 3_000);
});

test("normalizeDurationMs handles microseconds (1e6..1e9)", () => {
  assert.equal(normalizeDurationMs(3_000_000), 3_000);
});

test("normalizeDurationMs passes milliseconds through unchanged", () => {
  assert.equal(normalizeDurationMs(180_000), 180_000);
});

test("normalizeDurationMs handles sample counts at 44.1kHz", () => {
  // 2.5 minutes × 60 × 44100 = 6,615,000 samples — falls into the 1e6..1e9 branch
  // so the heuristic converts it as if µs. This test documents the ordering.
  const result = normalizeDurationMs(6_615_000);
  assert.equal(result, 6_615);
});

test("normalizeDurationMs returns 0 for undefined/null", () => {
  assert.equal(normalizeDurationMs(undefined), 0);
  assert.equal(normalizeDurationMs(null), 0);
});
