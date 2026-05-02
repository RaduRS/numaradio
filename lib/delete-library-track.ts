// Operator-initiated total wipe of a library track. Removes the Track,
// all TrackAsset rows + their B2 objects, QueueItems, TrackVotes,
// BroadcastSegments tied to the assets, and nulls trackId on
// PlayHistory / SongRequest / MusicSubmission so audit rows survive
// without dangling FKs.
//
// Used by the bin icon in dashboard /library when the operator
// explicitly chooses to remove a track from rotation entirely. Distinct
// from delete-aired-shoutout (which is restricted to shoutout tracks
// and triggered by Liquidsoap on overlay-end).
//
// Best-effort B2 deletion: a missing or already-deleted object doesn't
// block the DB cleanup so a partial S3 outage can't leave the Track
// half-deleted. Counts surface in the result so the caller can log.

import { prisma as defaultPrisma } from "./db/index.ts";
import { deleteObject as defaultDeleteObject } from "./storage/index.ts";

export interface DeleteLibraryTrackResult {
  deleted: boolean;
  reason?: string;
  assetsDeletedFromB2: number;
  b2Failures: number;
}

interface MinimalAsset {
  id: string;
  storageKey: string;
}

export interface DeleteLibraryTrackDeps {
  prisma: {
    track: {
      findUnique(args: { where: { id: string }; select: unknown }): Promise<{ id: string; assets: MinimalAsset[] } | null>;
      update(args: { where: { id: string }; data: unknown }): Promise<unknown>;
      delete(args: { where: { id: string } }): Promise<unknown>;
    };
    playHistory: { updateMany(args: { where: { trackId: string }; data: { trackId: null } }): Promise<unknown> };
    queueItem: { deleteMany(args: { where: { trackId: string } }): Promise<unknown> };
    trackVote: { deleteMany(args: { where: { trackId: string } }): Promise<unknown> };
    trackAsset: { deleteMany(args: { where: { trackId: string } }): Promise<unknown> };
    broadcastSegment: { deleteMany(args: { where: { assetId: { in: string[] } } }): Promise<unknown> };
    songRequest: { updateMany(args: { where: { trackId: string }; data: { trackId: null } }): Promise<unknown> };
    musicSubmission: { updateMany(args: { where: { trackId: string }; data: { trackId: null } }): Promise<unknown> };
    $transaction(ops: Promise<unknown>[]): Promise<unknown>;
  };
  deleteObject(key: string): Promise<unknown>;
}

export async function deleteLibraryTrack(
  trackId: string,
  deps?: DeleteLibraryTrackDeps,
): Promise<DeleteLibraryTrackResult> {
  const prisma = (deps?.prisma ?? defaultPrisma) as DeleteLibraryTrackDeps["prisma"];
  const deleteObject = deps?.deleteObject ?? defaultDeleteObject;

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      assets: { select: { id: true, storageKey: true } },
    },
  });
  if (!track) {
    return { deleted: false, reason: "track_not_found", assetsDeletedFromB2: 0, b2Failures: 0 };
  }

  const assetIds = track.assets.map((a) => a.id);
  // Order matters — children first, then primary-asset references on
  // Track itself nulled so the TrackAsset deleteMany doesn't trip an
  // FK from Track.primaryAudioAssetId / primaryArtAssetId.
  const ops: Promise<unknown>[] = [
    prisma.playHistory.updateMany({ where: { trackId }, data: { trackId: null } }),
    prisma.queueItem.deleteMany({ where: { trackId } }),
    prisma.trackVote.deleteMany({ where: { trackId } }),
    prisma.songRequest.updateMany({ where: { trackId }, data: { trackId: null } }),
    prisma.musicSubmission.updateMany({ where: { trackId }, data: { trackId: null } }),
  ];
  if (assetIds.length > 0) {
    ops.push(prisma.broadcastSegment.deleteMany({ where: { assetId: { in: assetIds } } }));
  }
  ops.push(
    prisma.track.update({
      where: { id: trackId },
      data: { primaryAudioAssetId: null, primaryArtAssetId: null },
    }),
    prisma.trackAsset.deleteMany({ where: { trackId } }),
    prisma.track.delete({ where: { id: trackId } }),
  );
  await prisma.$transaction(ops);

  // Best-effort B2 cleanup AFTER the DB transaction succeeds. If we did
  // it first and a single object 404'd we'd block the whole delete; if
  // we did it first and the DB rolled back we'd have orphan keys.
  let assetsDeletedFromB2 = 0;
  let b2Failures = 0;
  for (const asset of track.assets) {
    try {
      await deleteObject(asset.storageKey);
      assetsDeletedFromB2++;
    } catch (e) {
      b2Failures++;
      console.warn(
        `deleteLibraryTrack: B2 delete failed for key=${asset.storageKey}: ${e instanceof Error ? e.message : "unknown"}`,
      );
    }
  }

  return { deleted: true, assetsDeletedFromB2, b2Failures };
}
