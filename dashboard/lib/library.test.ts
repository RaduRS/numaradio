import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { fetchLibraryTracks, resolvePushTarget, pushToDaemon, fetchDaemonStatus } from "./library.ts";

function fakePool(rows: unknown[]): Pool {
  return {
    query: async () => ({ rows }),
  } as unknown as Pool;
}

test("fetchLibraryTracks maps rows including null asset URLs", async () => {
  const created = new Date("2026-04-20T12:00:00Z");
  const pool = fakePool([
    {
      id: "t1",
      title: "Sunset",
      artist: "russellross",
      durationSeconds: 184,
      bpm: 120,
      genre: "indie",
      mood: "warm",
      trackStatus: "ready",
      airingPolicy: "library",
      source_type: "suno_manual",
      createdAt: created,
      audio_stream_url: "https://b2/audio.mp3",
      artwork_url: "https://b2/art.jpg",
    },
    {
      id: "t2",
      title: "Draft Song",
      artist: null,
      durationSeconds: null,
      bpm: null,
      genre: null,
      mood: null,
      trackStatus: "draft",
      airingPolicy: "library",
      source_type: null, // legacy row — mapped to "unknown"
      createdAt: created,
      audio_stream_url: null,
      artwork_url: null,
    },
  ]);
  const tracks = await fetchLibraryTracks(pool);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].title, "Sunset");
  assert.equal(tracks[0].audioStreamUrl, "https://b2/audio.mp3");
  assert.equal(tracks[0].createdAt, "2026-04-20T12:00:00.000Z");
  assert.equal(tracks[0].sourceType, "suno_manual");
  assert.equal(tracks[1].audioStreamUrl, null);
  assert.equal(tracks[1].artworkUrl, null);
  assert.equal(tracks[1].sourceType, "unknown");
});

test("resolvePushTarget returns null when no row matches", async () => {
  const pool = fakePool([]);
  const result = await resolvePushTarget("missing", pool);
  assert.equal(result, null);
});

test("resolvePushTarget returns row mapped from snake_case", async () => {
  const pool = fakePool([
    { id: "t1", title: "Sunset", airingPolicy: "library", audio_stream_url: "https://b2/a.mp3" },
  ]);
  const result = await resolvePushTarget("t1", pool);
  assert.deepEqual(result, {
    id: "t1",
    title: "Sunset",
    airingPolicy: "library",
    audioStreamUrl: "https://b2/a.mp3",
  });
});

test("pushToDaemon returns ok with queueItemId on 200", async () => {
  const fakeFetch: typeof fetch = (async () =>
    new Response(JSON.stringify({ queueItemId: "q-123" }), { status: 200 })) as typeof fetch;
  const result = await pushToDaemon(
    { trackId: "t1", sourceUrl: "https://b2/a.mp3" },
    fakeFetch,
  );
  assert.deepEqual(result, { ok: true, queueItemId: "q-123" });
});

test("pushToDaemon returns error on non-200", async () => {
  const fakeFetch: typeof fetch = (async () =>
    new Response("daemon down", { status: 503 })) as typeof fetch;
  const result = await pushToDaemon(
    { trackId: "t1", sourceUrl: "https://b2/a.mp3" },
    fakeFetch,
  );
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.status, 503);
    assert.equal(result.error, "daemon down");
  }
});

test("pushToDaemon returns error when daemon body is not JSON", async () => {
  const fakeFetch: typeof fetch = (async () =>
    new Response("not json at all", { status: 200 })) as typeof fetch;
  const result = await pushToDaemon(
    { trackId: "t1", sourceUrl: "https://b2/a.mp3" },
    fakeFetch,
  );
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.status, 502);
    assert.match(result.error, /non-json/);
  }
});

test("pushToDaemon returns error when daemon throws", async () => {
  const fakeFetch: typeof fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const result = await pushToDaemon(
    { trackId: "t1", sourceUrl: "https://b2/a.mp3" },
    fakeFetch,
  );
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.status, 502);
    assert.equal(result.error, "ECONNREFUSED");
  }
});

test("fetchDaemonStatus returns empty arrays when daemon is down", async () => {
  const fakeFetch: typeof fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const status = await fetchDaemonStatus(fakeFetch);
  assert.deepEqual(status, { lastPushes: [], lastFailures: [] });
});

test("fetchDaemonStatus passes through arrays from daemon", async () => {
  const fakeFetch: typeof fetch = (async () =>
    new Response(
      JSON.stringify({
        socket: "connected",
        lastPushes: [{ trackId: "t1", pushedAt: "2026-04-20T12:00:00Z" }],
        lastFailures: [],
      }),
      { status: 200 },
    )) as typeof fetch;
  const status = await fetchDaemonStatus(fakeFetch);
  assert.equal(status.socket, "connected");
  assert.equal(status.lastPushes.length, 1);
  assert.equal(status.lastFailures.length, 0);
});

test("fetchDaemonStatus coerces missing arrays to []", async () => {
  const fakeFetch: typeof fetch = (async () =>
    new Response(JSON.stringify({ socket: "reconnecting" }), { status: 200 })) as typeof fetch;
  const status = await fetchDaemonStatus(fakeFetch);
  assert.deepEqual(status.lastPushes, []);
  assert.deepEqual(status.lastFailures, []);
});
