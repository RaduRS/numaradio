import { test } from "node:test";
import assert from "node:assert/strict";
import { RingBuffer } from "./status-buffers.ts";

test("RingBuffer keeps only the last N entries, newest-first", () => {
  const r = new RingBuffer<number>(3);
  r.push(1);
  r.push(2);
  r.push(3);
  r.push(4);
  assert.deepEqual(r.snapshot(), [4, 3, 2]);
});

test("RingBuffer snapshot returns a copy", () => {
  const r = new RingBuffer<string>(2);
  r.push("a");
  const s = r.snapshot();
  r.push("b");
  assert.deepEqual(s, ["a"]);
});

test("RingBuffer returns empty array when unused", () => {
  const r = new RingBuffer<number>(5);
  assert.deepEqual(r.snapshot(), []);
});
