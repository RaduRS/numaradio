// workers/queue-daemon/lena-producer/queue-director.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { queueDirectorDecide } from "./queue-director.ts";

const T0 = new Date("2026-05-16T23:15:00").getTime();

function track(id: string, artist: string, genre: string) {
  return { id, title: id, artist, genre, bpm: 120 };
}

test("queueDirectorDecide rejects when track aired within last 60 min", () => {
  const r = queueDirectorDecide({
    proposedTrack: track("t1", "Anna", "synth"),
    currentTrack: { id: "t99", title: "X", artist: "Z", genre: "synth", bpm: 120 },
    recentTrackIds: ["t1"],
    currentShow: "Prime Hours",
    reason: "mood_shift",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /recently_aired/);
});

test("queueDirectorDecide rejects same artist back-to-back unless reason mentions 'double feature'", () => {
  const r1 = queueDirectorDecide({
    proposedTrack: track("t1", "Anna", "synth"),
    currentTrack: { id: "t99", title: "X", artist: "Anna", genre: "synth", bpm: 120 },
    recentTrackIds: [],
    currentShow: "Prime Hours",
    reason: "mood_shift",
  });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.match(r1.reason, /same_artist/);

  // Deliberate double feature exception
  const r2 = queueDirectorDecide({
    proposedTrack: track("t1", "Anna", "synth"),
    currentTrack: { id: "t99", title: "X", artist: "Anna", genre: "synth", bpm: 120 },
    recentTrackIds: [],
    currentShow: "Prime Hours",
    reason: "double feature — Anna spotlight",
  });
  assert.equal(r2.ok, true);
});

test("queueDirectorDecide rejects when genre doesn't fit current show", () => {
  const r = queueDirectorDecide({
    proposedTrack: track("t1", "Anna", "ambient"),
    currentTrack: { id: "t99", title: "X", artist: "Z", genre: "synth", bpm: 120 },
    recentTrackIds: [],
    currentShow: "Prime Hours",
    reason: "vibe",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /wrong_show_block/);
});

test("queueDirectorDecide accepts a valid pick", () => {
  const r = queueDirectorDecide({
    proposedTrack: track("t1", "Anna", "synth"),
    currentTrack: { id: "t99", title: "X", artist: "Z", genre: "rock", bpm: 120 },
    recentTrackIds: ["t5", "t6"],
    currentShow: "Prime Hours",
    reason: "mood_shift",
  });
  assert.equal(r.ok, true);
});

test("queueDirectorDecide accepts when currentTrack is null (cold-start, no current playing)", () => {
  const r = queueDirectorDecide({
    proposedTrack: track("t1", "Anna", "synth"),
    currentTrack: null,
    recentTrackIds: [],
    currentShow: "Prime Hours",
    reason: "first pick",
  });
  assert.equal(r.ok, true);
});
