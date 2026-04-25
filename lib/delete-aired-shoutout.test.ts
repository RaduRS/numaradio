// The deleteAiredShoutout safety guard is the single thing standing
// between a misfired Liquidsoap callback and obliterating real music.
// Pin its allowlist contract so a future change that "relaxes" the
// filter surfaces immediately as a test failure.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { DeleteAiredShoutoutDeps } from "./delete-aired-shoutout.ts";

interface MockTrack {
  id: string;
  sourceType: string;
  airingPolicy: string;
  assets: { id: string; storageKey: string }[];
}

function mkDeps(tracks: MockTrack[]): {
  deps: DeleteAiredShoutoutDeps;
  __deleted: string[];
  __b2Deleted: string[];
  __remaining: () => string[];
} {
  const map = new Map(tracks.map((t) => [t.id, t]));
  const __deleted: string[] = [];
  const __b2Deleted: string[] = [];

  const deps: DeleteAiredShoutoutDeps = {
    prisma: {
      track: {
        findUnique: async (args) => map.get(args.where.id) ?? null,
        delete: async (args) => {
          map.delete(args.where.id);
          __deleted.push(`track:${args.where.id}`);
          return { id: args.where.id };
        },
      },
      playHistory: {
        deleteMany: async (args) => {
          __deleted.push(`playHistory:${args.where.trackId}`);
          return { count: 0 };
        },
      },
      queueItem: {
        deleteMany: async (args) => {
          __deleted.push(`queueItem:${args.where.trackId}`);
          return { count: 0 };
        },
      },
      trackAsset: {
        deleteMany: async (args) => {
          __deleted.push(`trackAsset:${args.where.trackId}`);
          return { count: 0 };
        },
      },
      $transaction: async (ops) => Promise.all(ops),
    },
    deleteObject: async (key: string) => {
      __b2Deleted.push(key);
    },
  };

  return { deps, __deleted, __b2Deleted, __remaining: () => Array.from(map.keys()) };
}

test("deleteAiredShoutout deletes external_import + request_only tracks", async () => {
  const { deleteAiredShoutout } = await import("./delete-aired-shoutout.ts");
  const m = mkDeps([
    {
      id: "t1",
      sourceType: "external_import",
      airingPolicy: "request_only",
      assets: [{ id: "a1", storageKey: "stations/numaradio/tracks/t1/audio/x.mp3" }],
    },
  ]);
  const r = await deleteAiredShoutout("t1", m.deps);
  assert.equal(r.deleted, true);
  assert.equal(r.assetsDeletedFromB2, 1);
  assert.deepEqual(m.__b2Deleted, ["stations/numaradio/tracks/t1/audio/x.mp3"]);
  assert.ok(m.__deleted.includes("track:t1"));
  assert.equal(m.__remaining().length, 0);
});

test("deleteAiredShoutout REFUSES library music (sourceType=minimax_request, policy=library)", async () => {
  const { deleteAiredShoutout } = await import("./delete-aired-shoutout.ts");
  const m = mkDeps([
    {
      id: "music-1",
      sourceType: "minimax_request",
      airingPolicy: "library",
      assets: [{ id: "a1", storageKey: "stations/numaradio/tracks/music-1/audio/x.mp3" }],
    },
  ]);
  const r = await deleteAiredShoutout("music-1", m.deps);
  assert.equal(r.deleted, false);
  assert.match(r.reason ?? "", /not_a_shoutout/);
  assert.equal(m.__b2Deleted.length, 0);
  assert.equal(m.__deleted.length, 0);
  // Track still exists — proves the guard didn't touch it.
  assert.deepEqual(m.__remaining(), ["music-1"]);
});

test("deleteAiredShoutout REFUSES external_import + priority_request (operator-pushed track)", async () => {
  const { deleteAiredShoutout } = await import("./delete-aired-shoutout.ts");
  const m = mkDeps([
    {
      id: "pri-1",
      sourceType: "external_import",
      airingPolicy: "priority_request",
      assets: [],
    },
  ]);
  const r = await deleteAiredShoutout("pri-1", m.deps);
  assert.equal(r.deleted, false);
  assert.match(r.reason ?? "", /not_a_shoutout/);
});

test("deleteAiredShoutout REFUSES suno_manual + request_only (mismatched sourceType)", async () => {
  const { deleteAiredShoutout } = await import("./delete-aired-shoutout.ts");
  const m = mkDeps([
    {
      id: "suno-1",
      sourceType: "suno_manual",
      airingPolicy: "request_only",
      assets: [],
    },
  ]);
  const r = await deleteAiredShoutout("suno-1", m.deps);
  assert.equal(r.deleted, false);
  assert.match(r.reason ?? "", /not_a_shoutout/);
});

test("deleteAiredShoutout reports track_not_found for unknown id (idempotent on double-fire)", async () => {
  const { deleteAiredShoutout } = await import("./delete-aired-shoutout.ts");
  const m = mkDeps([]);
  const r = await deleteAiredShoutout("ghost", m.deps);
  assert.equal(r.deleted, false);
  assert.equal(r.reason, "track_not_found");
});

test("deleteAiredShoutout records b2Failures but completes DB cleanup when B2 deletes throw", async () => {
  const { deleteAiredShoutout } = await import("./delete-aired-shoutout.ts");
  const m = mkDeps([
    {
      id: "t-flaky",
      sourceType: "external_import",
      airingPolicy: "request_only",
      assets: [
        { id: "a1", storageKey: "k1" },
        { id: "a2", storageKey: "k2" },
      ],
    },
  ]);
  // Override deleteObject to throw on the first key.
  const badDeps: DeleteAiredShoutoutDeps = {
    ...m.deps,
    deleteObject: async (key: string) => {
      if (key === "k1") throw new Error("b2 down");
      m.__b2Deleted.push(key);
    },
  };
  const r = await deleteAiredShoutout("t-flaky", badDeps);
  assert.equal(r.deleted, true);
  assert.equal(r.assetsDeletedFromB2, 1);
  assert.equal(r.b2Failures, 1);
  // Track still got removed despite the B2 partial failure.
  assert.equal(m.__remaining().length, 0);
});
