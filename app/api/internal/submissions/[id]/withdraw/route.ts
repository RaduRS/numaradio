// POST /api/internal/submissions/:id/withdraw
//
// Pulls an approved submission's track from rotation and deletes its
// audio + artwork assets from B2. The MusicSubmission row stays for
// audit. PII handling depends on the original airing preference:
//
//   permanent → keep email + name on the row. Disclosed in the
//               privacy page: we may contact the artist later (e.g.
//               if their track is lost or we're asking about a
//               re-submit). Status flips to 'withdrawn'.
//
//   one_off   → email + name are scrubbed (replaced with placeholders).
//               Audit row remains so historical play counts still
//               reconcile, but no PII survives. Status flips to
//               'withdrawn'.
//
// For an artist who wants TOTAL deletion regardless of preference,
// use /api/internal/submissions/:id/full-delete instead.
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
    : "artist requested withdrawal";
  const operatorEmail =
    typeof (body as { operatorEmail?: unknown }).operatorEmail === "string"
      ? (body as { operatorEmail: string }).operatorEmail
      : "operator";

  const { id } = await params;
  const submission = await prisma.musicSubmission.findUnique({ where: { id } });
  if (!submission) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (submission.status === "withdrawn") {
    return NextResponse.json(
      { error: "already_withdrawn", message: "This submission was already withdrawn." },
      { status: 409 },
    );
  }
  if (submission.status !== "approved") {
    return NextResponse.json(
      {
        error: "not_approved",
        message: `Cannot withdraw a ${submission.status} submission. Use full-delete to wipe a non-approved row.`,
      },
      { status: 409 },
    );
  }

  // Tear down the production Track + assets so the song stops airing.
  const collectedKeys: string[] = [];
  if (submission.trackId) {
    const assets = await prisma.trackAsset.findMany({
      where: { trackId: submission.trackId },
      select: { id: true, storageKey: true },
    });
    collectedKeys.push(...assets.map((a) => a.storageKey));
    await prisma.$transaction([
      // Detach pointers first so the asset deletes don't violate FKs.
      prisma.track.update({
        where: { id: submission.trackId },
        data: { primaryAudioAssetId: null, primaryArtAssetId: null },
      }),
      // Asset rows referencing the track. queue_items + broadcast_segments
      // still reference these via FK; if there's any historical play in
      // those tables this will fail and we surface as 500. In practice,
      // by the time an artist withdraws, the track has been live for
      // a while and that history is what we WANT to keep — see the
      // full-delete path for the destructive option.
      prisma.trackAsset.deleteMany({ where: { trackId: submission.trackId } }),
      prisma.track.delete({ where: { id: submission.trackId } }),
    ]);
  }
  // Best-effort B2 cleanup. Failures don't block the row update.
  for (const key of collectedKeys) {
    await deleteObject(key).catch(() => undefined);
  }

  // Now scrub the submission row according to the airing preference.
  const isPermanent = submission.airingPreference === "permanent";
  await prisma.musicSubmission.update({
    where: { id: submission.id },
    data: isPermanent
      ? {
          // Permanent rotation: keep email + name. Disclosed in the
          // privacy page — we may reach back out to the artist (e.g.
          // if we lose the file and need a re-submit).
          status: "withdrawn",
          trackId: null,
          withdrawnAt: new Date(),
          withdrawnReason: reason,
          reviewedBy: operatorEmail,
        }
      : {
          // One-off: scrub PII. Row + audit metadata survive (status,
          // dates, ipHash for abuse forensics) but the email + name
          // are replaced with non-identifying placeholders.
          status: "withdrawn",
          trackId: null,
          email: `withdrawn+${submission.id}@local.invalid`,
          artistName: "[withdrawn]",
          withdrawnAt: new Date(),
          withdrawnReason: reason,
          reviewedBy: operatorEmail,
        },
  });

  return NextResponse.json({
    ok: true,
    keptContact: isPermanent,
    message: isPermanent
      ? "Withdrawn. Email + name retained per permanent-rotation policy."
      : "Withdrawn. Email + name scrubbed per one-off policy.",
  });
}
