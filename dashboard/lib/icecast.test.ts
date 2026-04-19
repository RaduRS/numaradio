import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseIcecastStatus } from "./icecast.ts";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf8"));
}

test("parses single-source Icecast status for /stream", () => {
  const parsed = parseIcecastStatus(fixture("icecast-single-source"), "/stream");
  assert.equal(parsed.mount, "/stream");
  assert.equal(parsed.bitrate, 192);
  assert.equal(typeof parsed.listeners, "number");
  assert.ok(parsed.nowPlaying);
  assert.equal(parsed.nowPlaying?.artist, "russellross");
  assert.equal(parsed.nowPlaying?.title, "One More Dance");
});

test("returns null-mount when no source is connected", () => {
  const parsed = parseIcecastStatus(fixture("icecast-no-source"), "/stream");
  assert.equal(parsed.mount, null);
  assert.equal(parsed.listeners, null);
});

test("picks the right mount when source is an array", () => {
  const parsed = parseIcecastStatus(fixture("icecast-multi-source"), "/stream");
  assert.equal(parsed.mount, "/stream");
  assert.equal(parsed.listeners, 2);
  assert.equal(parsed.bitrate, 192);
  assert.equal(parsed.nowPlaying?.title, "One More Dance");
});

test("empty title returns no nowPlaying", () => {
  const parsed = parseIcecastStatus(fixture("icecast-multi-source"), "/backup");
  assert.equal(parsed.mount, "/backup");
  assert.equal(parsed.nowPlaying, null);
});
