// POST /api/internal/submissions/:id/approve
//
// Called by the dashboard's approve proxy. Does the heavy lifting:
//   1. Read submission row + load audio (and artwork if any) from B2
//   2. Resolve artwork via cascade: uploaded → ID3 → none
//      (tier 3 — generation — is intentionally deferred; operator can
//       attach artwork later from the existing library page)
//   3. Call lib/ingest.ingestTrack with airingPolicy mapped from the
//      submitter's preference (one_off → priority_request, permanent
//      → library)
//   4. Update the submission row (status=approved, trackId, reviewedBy,
//      reviewedAt, artworkSource)
//   5. Delete the originals from submissions/ in B2 (cost saver — the
//      production ingest already wrote new copies under tracks/)
//
// Auth: shared INTERNAL_API_SECRET in x-internal-secret header.
// Operator email in body for the audit trail (set by dashboard proxy).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ingestTrack } from "@/lib/ingest";
import { getObject, deleteObject } from "@/lib/storage";
import { extractId3Artwork } from "@/lib/extract-id3-artwork";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const operatorEmail =
    typeof (body as { operatorEmail?: unknown }).operatorEmail === "string"
      ? (body as { operatorEmail: string }).operatorEmail
      : "operator";

  const { id } = await params;
  const submission = await prisma.musicSubmission.findUnique({ where: { id } });
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.status !== "pending") {
    return NextResponse.json(
      { error: "not_pending", status: submission.status },
      { status: 409 },
    );
  }
  if (submission.trackId) {
    return NextResponse.json(
      { ok: true, trackId: submission.trackId, alreadyApproved: true },
      { status: 200 },
    );
  }

  const station = await prisma.station.findUniqueOrThrow({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });

  let audioBuffer: Buffer;
  try {
    audioBuffer = await getObject(submission.audioStorageKey);
  } catch (err) {
    return NextResponse.json(
      {
        error: "audio_fetch_failed",
        message: "Could not retrieve the audio from storage. Try again in a moment.",
      },
      { status: 502 },
    );
  }

  // Artwork cascade — tier 1 (uploaded) and tier 2 (ID3) only
  let artwork: { buffer: Buffer; mimeType: string } | undefined;
  let artworkSource: "upload" | "id3" | null = null;
  if (submission.artworkStorageKey) {
    try {
      const buf = await getObject(submission.artworkStorageKey);
      const mt = submission.artworkStorageKey.endsWith(".png") ? "image/png" : "image/jpeg";
      artwork = { buffer: buf, mimeType: mt };
      artworkSource = "upload";
    } catch {
      // Artwork fetch failed — fall through to ID3 or generation
    }
  }
  if (!artwork) {
    const fromId3 = await extractId3Artwork(audioBuffer);
    if (fromId3) {
      artwork = { buffer: fromId3.buffer, mimeType: fromId3.mimeType };
      artworkSource = "id3";
    }
  }
  // Tier 3 (generation) intentionally deferred — operator can attach
  // artwork later from the existing dashboard library page.

  const airingPolicy =
    submission.airingPreference === "permanent" ? "library" : "priority_request";

  const result = await ingestTrack({
    stationId: station.id,
    audioBuffer,
    show: "morning_room", // neutral default; operator can move via library
    title: `Untitled — ${submission.artistName}`,
    artistDisplay: submission.artistName,
    durationSeconds: submission.durationSeconds ?? undefined,
    airingPolicy,
    sourceType: "external_import",
    artwork,
  });

  if (result.status !== "ingested") {
    return NextResponse.json({ error: "ingest_failed", reason: result }, { status: 500 });
  }

  let updateOk = false;
  let updateErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await prisma.musicSubmission.update({
        where: { id: submission.id },
        data: {
          status: "approved",
          trackId: result.trackId,
          artworkSource: artworkSource ?? null,
          reviewedAt: new Date(),
          reviewedBy: operatorEmail,
        },
      });
      updateOk = true;
      break;
    } catch (err) {
      updateErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  if (!updateOk) {
    console.error(
      `[approve] CRITICAL: Track ${result.trackId} ingested but submission ${submission.id} update failed after retries`,
      updateErr,
    );
    return NextResponse.json(
      {
        error: "post_ingest_update_failed",
        trackId: result.trackId,
        message: "Track was ingested but the submission record didn't update. The track is live; manually mark the submission approved or remove the orphaned track.",
      },
      { status: 500 },
    );
  }

  await deleteObject(submission.audioStorageKey).catch(() => undefined);
  if (submission.artworkStorageKey) {
    await deleteObject(submission.artworkStorageKey).catch(() => undefined);
  }

  return NextResponse.json({ ok: true, trackId: result.trackId });
}
