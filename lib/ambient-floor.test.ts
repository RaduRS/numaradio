import { test } from "node:test";
import assert from "node:assert/strict";
import { ambientFloor, AMBIENT_MIN, AMBIENT_MAX, AMBIENT_BUCKET_MS } from "./ambient-floor.ts";

test("ambientFloor stays within [AMBIENT_MIN, AMBIENT_MAX] across a full day", () => {
  // Sample every 6 minutes for 24 hours.
  const start = Date.UTC(2026, 3, 24, 0, 0, 0);
  for (let i = 0; i < (24 * 60) / 6; i += 1) {
    const v = ambientFloor(start + i * AMBIENT_BUCKET_MS);
    assert.ok(v >= AMBIENT_MIN, `bucket ${i}: ${v} < ${AMBIENT_MIN}`);
    assert.ok(v <= AMBIENT_MAX, `bucket ${i}: ${v} > ${AMBIENT_MAX}`);
    assert.ok(Number.isInteger(v), `bucket ${i}: ${v} not integer`);
  }
});

test("ambientFloor is deterministic within a bucket", () => {
  // Align to a bucket boundary so +5m59s stays in-bucket.
  const t = Math.floor(Date.UTC(2026, 3, 24, 12, 30, 0) / AMBIENT_BUCKET_MS) * AMBIENT_BUCKET_MS;
  const a = ambientFloor(t);
  // 30s later = same bucket
  const b = ambientFloor(t + 30_000);
  // 5m59s later = still same bucket
  const c = ambientFloor(t + 5 * 60_000 + 59_000);
  assert.equal(a, b);
  assert.equal(a, c);
});

test("ambientFloor changes at the 6-minute bucket boundary", () => {
  // Align to a bucket boundary so the "next" sample is definitely a new bucket.
  const aligned = Math.floor(Date.UTC(2026, 3, 24, 12, 0, 0) / AMBIENT_BUCKET_MS) * AMBIENT_BUCKET_MS;
  // Sample 100 adjacent buckets; at least one neighbour-pair must differ.
  const samples: number[] = [];
  for (let i = 0; i < 100; i += 1) samples.push(ambientFloor(aligned + i * AMBIENT_BUCKET_MS));
  let differences = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i] !== samples[i - 1]) differences += 1;
  }
  assert.ok(differences >= 50, `expected >=50 bucket-to-bucket differences in 100 samples, got ${differences}`);
});

test("ambientFloor trends high around the 20:00 UTC peak and low around 08:00 UTC trough", () => {
  // Average 6 hours around the peak vs. 6 hours around the trough on a fixed day.
  const day = Date.UTC(2026, 3, 24, 0, 0, 0);
  function avgRange(startHour: number, endHour: number): number {
    let sum = 0, count = 0;
    const step = AMBIENT_BUCKET_MS;
    for (let t = day + startHour * 3600_000; t < day + endHour * 3600_000; t += step) {
      sum += ambientFloor(t);
      count += 1;
    }
    return sum / count;
  }
  const peakAvg = avgRange(17, 23);   // around 20:00
  const troughAvg = avgRange(5, 11);  // around 08:00
  assert.ok(peakAvg > troughAvg + 5, `peakAvg=${peakAvg} troughAvg=${troughAvg}`);
});

test("ambientFloor handles edge constants (sanity)", () => {
  assert.equal(AMBIENT_MIN, 12);
  assert.equal(AMBIENT_MAX, 45);
  assert.equal(AMBIENT_BUCKET_MS, 6 * 60 * 1000);
});
