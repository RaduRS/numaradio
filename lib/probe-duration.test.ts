import { test } from "node:test";
import assert from "node:assert/strict";
import { probeDurationSeconds } from "./probe-duration.ts";

// probeDurationSeconds is a thin wrapper around music-metadata's
// `{ duration: true }` mode. The library itself is well-tested upstream;
// our concern is the wrapper's failure-mode contract.

test("probeDurationSeconds: nonexistent file path returns null (no throw)", async () => {
  const r = await probeDurationSeconds("/tmp/this-mp3-does-not-exist-zzz.mp3", {
    timeoutMs: 2000,
  });
  assert.equal(r, null);
});

test("probeDurationSeconds: empty buffer returns null", async () => {
  const r = await probeDurationSeconds(Buffer.alloc(0), { timeoutMs: 2000 });
  assert.equal(r, null);
});

test("probeDurationSeconds: garbage buffer returns null", async () => {
  // Random bytes — definitely not a valid MP3.
  const r = await probeDurationSeconds(Buffer.from("not a real audio file"), {
    timeoutMs: 2000,
  });
  assert.equal(r, null);
});

test("probeDurationSeconds: invalid HTTP URL returns null", async () => {
  // Loopback to a definitely-unreachable port; fetch fails fast.
  const r = await probeDurationSeconds("http://127.0.0.1:1/nope.mp3", {
    timeoutMs: 1500,
  });
  assert.equal(r, null);
});
