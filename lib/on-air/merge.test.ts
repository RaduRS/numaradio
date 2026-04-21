import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mergeOnAirFeed, type TrackItem, type ShoutItem } from "./merge.ts";

describe("mergeOnAirFeed", () => {
  test("sorts interleaved tracks + shouts by timestamp desc", () => {
    const tracks: TrackItem[] = [
      { trackId: "t1", title: "Neon Fever", artistDisplay: "Russell Ross", startedAt: "2026-04-21T12:00:00Z" },
      { trackId: "t2", title: "Midnight Drive", artistDisplay: "Russell Ross", startedAt: "2026-04-21T11:55:00Z" },
    ];
    const shouts: ShoutItem[] = [
      { id: "s1", requesterName: "eddie", text: "hey lena", airedAt: "2026-04-21T11:58:00Z" },
    ];
    const merged = mergeOnAirFeed(tracks, shouts, 10);
    assert.deepEqual(
      merged.map((m) => m.kind + ":" + (m.kind === "track" ? m.trackId : m.id)),
      ["track:t1", "shout:s1", "track:t2"],
    );
  });

  test("caps to the requested limit", () => {
    const tracks: TrackItem[] = Array.from({ length: 20 }, (_, i) => ({
      trackId: `t${i}`,
      title: `Track ${i}`,
      startedAt: new Date(Date.now() - i * 60_000).toISOString(),
    }));
    const shouts: ShoutItem[] = [];
    const merged = mergeOnAirFeed(tracks, shouts, 5);
    assert.equal(merged.length, 5);
  });

  test("handles empty inputs without throwing", () => {
    assert.deepEqual(mergeOnAirFeed([], [], 20), []);
  });

  test("a shout without a track still appears", () => {
    const tracks: TrackItem[] = [];
    const shouts: ShoutItem[] = [
      { id: "s1", requesterName: "mike", text: "testing", airedAt: "2026-04-21T10:00:00Z" },
    ];
    const merged = mergeOnAirFeed(tracks, shouts, 10);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].kind, "shout");
  });
});
