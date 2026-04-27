// POST /api/internal/submissions/:id/full-delete
//
// Total wipe path — for an artist who explicitly asks to be removed
// entirely (right to erasure / GDPR Art 17). Goes further than the
// withdraw endpoint: ALSO deletes the MusicSubmission row, related
// PlayHistory rows, queue items, and broadcast segments tied to the
// track. Nothing left except station-level aggregate counts.
//
// Use sparingly — it's destructive and breaks downstream play-history
// integrity. The default response to a withdrawal request is the
// /withdraw endpoint, which keeps the audit row.
//
// Body: { reason?: string, operatorEmail?: string }
// Auth: x-internal-secret header.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteObject } from "@/lib/storage";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const reason = typeof (body as { reason?: unknown }).reason === "string"
    ? (body as { reason: string }).reason.trim().slice(0, 500)
    : "artist requested full deletion";
  const operatorEmail =
    typeof (body as { operatorEmail?: unknown }).operatorEmail === "string"
      ? (body as { operatorEmail: string }).operatorEmail
      : "operator";

  const { id } = await params;
  const submission = await prisma.musicSubmission.findUnique({ where: { id } });
  if (!submission) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Collect all B2 keys that need deletion before we tear down the
  // database rows that reference them.
  const b2Keys: string[] = [];
  if (submission.audioStorageKey) b2Keys.push(submission.audioStorageKey);
  if (submission.artworkStorageKey) b2Keys.push(submission.artworkStorageKey);

  if (submission.trackId) {
    const assets = await prisma.trackAsset.findMany({
      where: { trackId: submission.trackId },
      select: { id: true, storageKey: true },
    });
    for (const a of assets) b2Keys.push(a.storageKey);
    const assetIds = assets.map((a) => a.id);

    // Cascade delete every row that references the track. PlayHistory
    // rows null their trackId so historical row count survives without
    // an orphan FK. BroadcastSegment links to TrackAsset via assetId,
    // not directly to Track.
    await prisma.$transaction([
      prisma.playHistory.updateMany({
        where: { trackId: submission.trackId },
        data: { trackId: null },
      }),
      prisma.queueItem.deleteMany({ where: { trackId: submission.trackId } }),
      ...(assetIds.length > 0
        ? [prisma.broadcastSegment.deleteMany({ where: { assetId: { in: assetIds } } })]
        : []),
      prisma.track.update({
        where: { id: submission.trackId },
        data: { primaryAudioAssetId: null, primaryArtAssetId: null },
      }),
      prisma.trackAsset.deleteMany({ where: { trackId: submission.trackId } }),
      prisma.track.delete({ where: { id: submission.trackId } }),
    ]);
  }

  // Now delete the submission row itself.
  await prisma.musicSubmission.delete({ where: { id: submission.id } });

  // Best-effort B2 cleanup.
  for (const key of b2Keys) {
    await deleteObject(key).catch(() => undefined);
  }

  console.log(
    `[full-delete] submission ${submission.id} fully removed by ${operatorEmail} (reason: ${reason})`,
  );
  return NextResponse.json({
    ok: true,
    deletedAssets: b2Keys.length,
    message: "Fully deleted. Row, track, assets, and B2 files all removed.",
  });
}
