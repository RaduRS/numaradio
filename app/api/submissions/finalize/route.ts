// POST /api/submissions/finalize
//
// Step 3 of the direct-upload flow. The browser called /init, then PUT
// the audio (and optional artwork) to B2 using the presigned URLs.
// Now we:
//   1. Verify the row is still in `uploading`
//   2. Fetch the audio from B2 and magic-byte validate it
//   3. Fetch the artwork (if expected) and magic-byte validate it
//   4. Probe the duration for the operator preview
//   5. Flip status to `pending` so the operator sees it
//
// On any failure (bad file, missing upload, magic-byte mismatch) we
// delete the orphan B2 objects and the row so the artist isn't blocked
// by the per-email pending lock.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getObject, deleteObject, objectExists } from "@/lib/storage";
import { probeDurationSeconds } from "@/lib/probe-duration";
import { sniffMp3, sniffImage } from "@/lib/submissions";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function fail(error: string, message: string, status = 400) {
  return NextResponse.json({ error, message }, { status });
}

type FinalizeRequest = { id?: unknown; hasArtwork?: unknown };

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: FinalizeRequest;
  try {
    body = (await req.json()) as FinalizeRequest;
  } catch {
    return fail("bad_json", "Could not parse JSON body.");
  }

  const id = typeof body.id === "string" ? body.id : null;
  const hasArtwork = body.hasArtwork === true;
  if (!id) return fail("bad_id", "Submission id required.");

  const submission = await prisma.musicSubmission.findUnique({
    where: { id },
    select: { id: true, status: true, email: true },
  });
  if (!submission) return fail("not_found", "Submission not found.", 404);
  if (submission.status !== "uploading") {
    return fail("not_uploading", `Submission is in '${submission.status}' state, cannot finalize.`, 409);
  }

  const audioKey = `submissions/${id}.mp3`;

  // Verify the upload actually happened
  if (!(await objectExists(audioKey))) {
    await prisma.musicSubmission.delete({ where: { id } }).catch(() => undefined);
    return fail("audio_not_uploaded", "The audio upload did not complete. Please try again.", 409);
  }

  let audioBuffer: Buffer;
  try {
    audioBuffer = await getObject(audioKey);
  } catch {
    return fail("audio_fetch_failed", "Could not read the uploaded audio. Please try again.", 502);
  }

  if (!sniffMp3(audioBuffer)) {
    await deleteObject(audioKey).catch(() => undefined);
    await prisma.musicSubmission.delete({ where: { id } }).catch(() => undefined);
    return fail("bad_mp3", "That file doesn't look like a valid MP3.");
  }

  // Optional artwork — if the browser said it was uploading one, find + verify it
  let artKey: string | null = null;
  if (hasArtwork) {
    const pngKey = `submissions/${id}.png`;
    const jpgKey = `submissions/${id}.jpg`;
    if (await objectExists(pngKey)) artKey = pngKey;
    else if (await objectExists(jpgKey)) artKey = jpgKey;

    if (!artKey) {
      await deleteObject(audioKey).catch(() => undefined);
      await prisma.musicSubmission.delete({ where: { id } }).catch(() => undefined);
      return fail("artwork_not_uploaded", "The artwork upload did not complete. Please try again.", 409);
    }

    const artBuf = await getObject(artKey);
    const kind = sniffImage(artBuf);
    if (!kind) {
      await deleteObject(artKey).catch(() => undefined);
      await deleteObject(audioKey).catch(() => undefined);
      await prisma.musicSubmission.delete({ where: { id } }).catch(() => undefined);
      return fail("bad_artwork", "Artwork must be a PNG or JPEG image.");
    }
  }

  let durationSeconds: number | null = null;
  try {
    const probed = await probeDurationSeconds(audioBuffer);
    if (probed !== null) durationSeconds = Math.round(probed);
  } catch {
    // Don't block finalize on a probe failure — operator will see in dashboard
  }

  await prisma.musicSubmission.update({
    where: { id },
    data: {
      audioStorageKey: audioKey,
      artworkStorageKey: artKey,
      durationSeconds,
      status: "pending",
    },
  });

  return NextResponse.json({ ok: true, id });
}
