// Delete the transient artifacts of an aired shoutout: B2 audio file,
// TrackAsset rows, QueueItem rows, PlayHistory rows, and the Track itself.
//
// Called from /api/internal/shoutout-ended after Liquidsoap signals the
// overlay has stopped. The corresponding Shoutout row in the moderation
// audit table is intentionally preserved — only the generated audio and
// its Track bookkeeping are transient.
//
// Defense: only deletes when the track is definitively a shoutout
// (sourceType='external_import' AND airingPolicy='request_only'). Music
// tracks use `library` / `priority_request`, so this filter prevents an
// accidental trackId argument from nuking music.

import { prisma } from "@/lib/db";
import { deleteObject } from "@/lib/storage";

export interface DeleteResult {
  deleted: boolean;
  reason?: string;
  assetsDeletedFromB2: number;
  b2Failures: number;
}

export async function deleteAiredShoutout(
  trackId: string,
): Promise<DeleteResult> {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      sourceType: true,
      airingPolicy: true,
      assets: { select: { id: true, storageKey: true } },
    },
  });

  if (!track) {
    return { deleted: false, reason: "track_not_found", assetsDeletedFromB2: 0, b2Failures: 0 };
  }

  const isShoutout =
    track.sourceType === "external_import" &&
    track.airingPolicy === "request_only";
  if (!isShoutout) {
    return {
      deleted: false,
      reason: `not_a_shoutout(sourceType=${track.sourceType},airingPolicy=${track.airingPolicy})`,
      assetsDeletedFromB2: 0,
      b2Failures: 0,
    };
  }

  // 1. B2 deletes first. Swallow individual failures so a missing or
  //    already-deleted object doesn't block the DB cleanup. We track
  //    counts so the caller can log them if desired.
  let assetsDeletedFromB2 = 0;
  let b2Failures = 0;
  for (const asset of track.assets) {
    try {
      await deleteObject(asset.storageKey);
      assetsDeletedFromB2++;
    } catch (e) {
      b2Failures++;
      console.warn(
        `deleteAiredShoutout: B2 delete failed for key=${asset.storageKey}: ${
          e instanceof Error ? e.message : "unknown"
        }`,
      );
    }
  }

  // 2. DB cleanup. Order matters — no cascade defined, so children first.
  //    Wrapped in a transaction so a partial failure doesn't leave the
  //    Track half-deleted.
  await prisma.$transaction([
    prisma.playHistory.deleteMany({ where: { trackId } }),
    prisma.queueItem.deleteMany({ where: { trackId } }),
    prisma.trackAsset.deleteMany({ where: { trackId } }),
    prisma.track.delete({ where: { id: trackId } }),
  ]);

  return {
    deleted: true,
    assetsDeletedFromB2,
    b2Failures,
  };
}
