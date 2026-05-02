import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteLibraryTrack, type DeleteLibraryTrackDeps } from "./delete-library-track.ts";

function mkDeps(tracks: { id: string; assets: { id: string; storageKey: string }[] }[]): {
  deps: DeleteLibraryTrackDeps;
  ops: string[];
  b2: string[];
  surviving: () => Set<string>;
} {
  const map = new Map(tracks.map((t) => [t.id, t]));
  const ops: string[] = [];
  const b2: string[] = [];
  const txOps: Promise<unknown>[] = [];

  const deps: DeleteLibraryTrackDeps = {
    prisma: {
      track: {
        findUnique: async (args) => map.get((args.where as { id: string }).id) ?? null,
        update: async (args) => {
          ops.push(`track.update:${(args.where as { id: string }).id}:nulledPrimaries`);
          return { id: (args.where as { id: string }).id };
        },
        delete: async (args) => {
          map.delete((args.where as { id: string }).id);
          ops.push(`track.delete:${(args.where as { id: string }).id}`);
          return { id: (args.where as { id: string }).id };
        },
      },
      playHistory: { updateMany: async (a) => { ops.push(`playHistory.update:${a.where.trackId}:null`); return { count: 0 }; } },
      queueItem: { deleteMany: async (a) => { ops.push(`queueItem.delete:${a.where.trackId}`); return { count: 0 }; } },
      trackVote: { deleteMany: async (a) => { ops.push(`trackVote.delete:${a.where.trackId}`); return { count: 0 }; } },
      trackAsset: { deleteMany: async (a) => { ops.push(`trackAsset.delete:${a.where.trackId}`); return { count: 0 }; } },
      broadcastSegment: { deleteMany: async (a) => { ops.push(`broadcastSegment.delete:${a.where.assetId.in.join(",")}`); return { count: 0 }; } },
      songRequest: { updateMany: async (a) => { ops.push(`songRequest.update:${a.where.trackId}:null`); return { count: 0 }; } },
      musicSubmission: { updateMany: async (a) => { ops.push(`musicSubmission.update:${a.where.trackId}:null`); return { count: 0 }; } },
      $transaction: async (txOpsArg) => {
        // Resolve all in declared order — that's the actual order matters guarantee
        for (const op of txOpsArg) await op;
        return [];
      },
    },
    deleteObject: async (key: string) => {
      b2.push(key);
    },
  };
  // suppress unused warning
  void txOps;
  return { deps, ops, b2, surviving: () => new Set(map.keys()) };
}

test("deleteLibraryTrack returns track_not_found for an unknown id", async () => {
  const { deps } = mkDeps([]);
  const r = await deleteLibraryTrack("ghost", deps);
  assert.equal(r.deleted, false);
  assert.equal(r.reason, "track_not_found");
  assert.equal(r.assetsDeletedFromB2, 0);
});

test("deleteLibraryTrack cascades children, deletes the track, and removes B2 keys", async () => {
  const { deps, ops, b2, surviving } = mkDeps([
    { id: "t1", assets: [
      { id: "a1", storageKey: "stations/numa/tracks/t1/audio/stream.mp3" },
      { id: "a2", storageKey: "stations/numa/tracks/t1/artwork/cover.jpg" },
    ]},
  ]);
  const r = await deleteLibraryTrack("t1", deps);
  assert.equal(r.deleted, true);
  assert.equal(r.assetsDeletedFromB2, 2);
  assert.equal(r.b2Failures, 0);
  assert.equal(surviving().size, 0);
  // Order matters: children → primary-asset null → trackAsset → track
  const trackUpdateIdx = ops.findIndex((o) => o.startsWith("track.update:"));
  const trackAssetDeleteIdx = ops.findIndex((o) => o.startsWith("trackAsset.delete:"));
  const trackDeleteIdx = ops.findIndex((o) => o.startsWith("track.delete:"));
  assert.ok(trackUpdateIdx < trackAssetDeleteIdx, "primary-asset refs nulled before TrackAsset deleteMany");
  assert.ok(trackAssetDeleteIdx < trackDeleteIdx, "TrackAsset rows gone before Track.delete");
  // PlayHistory and SongRequest/MusicSubmission preserve audit (updateMany with null)
  assert.ok(ops.some((o) => o === "playHistory.update:t1:null"));
  assert.ok(ops.some((o) => o === "songRequest.update:t1:null"));
  assert.ok(ops.some((o) => o === "musicSubmission.update:t1:null"));
  // QueueItem + TrackVote actually deleted
  assert.ok(ops.some((o) => o === "queueItem.delete:t1"));
  assert.ok(ops.some((o) => o === "trackVote.delete:t1"));
  // BroadcastSegment cleaned up by asset id
  assert.ok(ops.some((o) => o === "broadcastSegment.delete:a1,a2"));
  // B2 keys hit
  assert.deepEqual(b2.sort(), [
    "stations/numa/tracks/t1/artwork/cover.jpg",
    "stations/numa/tracks/t1/audio/stream.mp3",
  ]);
});

test("deleteLibraryTrack skips broadcastSegment when track has no assets", async () => {
  const { deps, ops } = mkDeps([{ id: "t2", assets: [] }]);
  await deleteLibraryTrack("t2", deps);
  assert.ok(!ops.some((o) => o.startsWith("broadcastSegment.delete")));
});

test("deleteLibraryTrack still finishes when B2 deletion partially fails", async () => {
  const { deps, ...rest } = mkDeps([
    { id: "t3", assets: [
      { id: "a1", storageKey: "key1" },
      { id: "a2", storageKey: "key2-broken" },
    ]},
  ]);
  void rest;
  const failing: DeleteLibraryTrackDeps = {
    ...deps,
    deleteObject: async (key: string) => {
      if (key.includes("broken")) throw new Error("S3 404");
    },
  };
  const r = await deleteLibraryTrack("t3", failing);
  assert.equal(r.deleted, true);
  assert.equal(r.assetsDeletedFromB2, 1);
  assert.equal(r.b2Failures, 1);
});
