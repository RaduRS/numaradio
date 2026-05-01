// POST /api/submissions/init
//
// Step 1 of the direct-upload flow: validates metadata + size hints,
// reserves a submission row in `uploading` status, and returns
// presigned PUT URLs the browser uses to upload directly to B2 (no
// file body passes through Vercel — bypasses the 4.5 MB serverless
// function payload cap).
//
// The browser then PUTs the audio (and optional artwork) and calls
// /api/submissions/finalize to flip the row to `pending` after the
// server has fetched + magic-byte-validated each file.

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { presignPut, deleteObject } from "@/lib/storage";
import {
  isValidEmail,
  isValidName,
  normalizeEmail,
  normalizeName,
  audioStorageKey,
  artworkStorageKey,
  MAX_AUDIO_BYTES,
  MAX_ARTWORK_BYTES,
} from "@/lib/submissions";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

function fail(error: string, message: string, status = 400) {
  return NextResponse.json({ error, message }, { status });
}

function ipHashOf(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0]?.trim() ?? "0.0.0.0";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

type InitRequest = {
  name?: unknown;
  email?: unknown;
  vouched?: unknown;
  airingPreference?: unknown;
  audioSize?: unknown;
  artworkKind?: unknown;
  artworkSize?: unknown;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: InitRequest;
  try {
    body = (await req.json()) as InitRequest;
  } catch {
    return fail("bad_json", "Could not parse JSON body.");
  }

  const { name, email, vouched, airingPreference, audioSize, artworkKind, artworkSize } = body;

  if (typeof name !== "string" || !isValidName(name)) {
    return fail("bad_name", "Please enter a name between 2 and 80 characters.");
  }
  if (typeof email !== "string" || !isValidEmail(email)) {
    return fail("bad_email", "Please enter a valid email address.");
  }
  if (vouched !== true) {
    return fail("not_vouched", "You must confirm the rights and broadcast authorisation.");
  }
  const airingPref = airingPreference === "permanent" ? "permanent" : "one_off";

  if (typeof audioSize !== "number" || !Number.isInteger(audioSize) || audioSize <= 0) {
    return fail("bad_audio_size", "Audio size must be a positive integer.");
  }
  if (audioSize > MAX_AUDIO_BYTES) {
    return fail("audio_too_large", "MP3 must be 10 MB or smaller.", 413);
  }

  let artKind: "png" | "jpeg" | null = null;
  if (artworkKind !== undefined && artworkKind !== null) {
    if (artworkKind !== "png" && artworkKind !== "jpeg") {
      return fail("bad_artwork_kind", "Artwork must be PNG or JPEG.");
    }
    artKind = artworkKind;
    if (typeof artworkSize !== "number" || !Number.isInteger(artworkSize) || artworkSize <= 0) {
      return fail("bad_artwork_size", "Artwork size must be a positive integer.");
    }
    if (artworkSize > MAX_ARTWORK_BYTES) {
      return fail("artwork_too_large", "Artwork must be 2 MB or smaller.", 413);
    }
  }

  const normEmail = normalizeEmail(email);
  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) return fail("no_station", "Server misconfiguration.", 500);

  // The partial unique index on (email) WHERE status IN ('pending',
  // 'uploading') is the source of truth — let it enforce one-active-
  // submission-per-email, then handle the conflict here. Removes the
  // findFirst→delete→create TOCTOU race the previous version had.
  let submission: { id: string };
  try {
    submission = await prisma.musicSubmission.create({
      data: {
        stationId: station.id,
        artistName: normalizeName(name),
        email: normEmail,
        ipHash: ipHashOf(req),
        audioStorageKey: "", // populated by finalize
        artworkStorageKey: null,
        airingPreference: airingPref,
        status: "uploading",
        vouched: true,
      },
      select: { id: true },
    });
  } catch (err) {
    if (
      typeof err !== "object" || err === null ||
      !("code" in err) || (err as { code: unknown }).code !== "P2002"
    ) {
      throw err;
    }
    // Unique violation — there's an existing pending or uploading row.
    // If it's a stale `uploading`, sweep it and retry once. Otherwise
    // rate-limit the caller.
    const conflict = await prisma.musicSubmission.findFirst({
      where: { email: normEmail, status: { in: ["pending", "uploading"] } },
      select: { id: true, status: true, createdAt: true },
    });
    const stale =
      conflict !== null &&
      conflict.status === "uploading" &&
      Date.now() - conflict.createdAt.getTime() > 30 * 60 * 1000;
    if (!stale || conflict === null) {
      return fail(
        "pending_exists",
        conflict?.status === "uploading"
          ? "You started a submission a moment ago — give it a minute to finish, or refresh and try again."
          : "You've already got a submission pending. We'll respond before you can send another.",
        429,
      );
    }
    // Sweep stale row + B2 objects atomically (deleteMany guards on the
    // status + age in case another request raced past), then retry.
    await Promise.all([
      deleteObject(audioStorageKey(conflict.id)).catch(() => undefined),
      deleteObject(artworkStorageKey(conflict.id, "png")).catch(() => undefined),
      deleteObject(artworkStorageKey(conflict.id, "jpeg")).catch(() => undefined),
    ]);
    await prisma.musicSubmission.deleteMany({
      where: {
        id: conflict.id,
        status: "uploading",
        createdAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
      },
    });
    submission = await prisma.musicSubmission.create({
      data: {
        stationId: station.id,
        artistName: normalizeName(name),
        email: normEmail,
        ipHash: ipHashOf(req),
        audioStorageKey: "",
        artworkStorageKey: null,
        airingPreference: airingPref,
        status: "uploading",
        vouched: true,
      },
      select: { id: true },
    });
  }

  // Presigned URL TTL: 600s (10 min). 90s was tight — a 10 MB MP3 on a
  // 1 Mbps uplink takes ~80 s just for the audio PUT, leaving the
  // artwork URL at near-zero margin since both URLs are signed at the
  // same wall-clock instant. 10 min is plenty for slow connections,
  // and the URL is tied to a specific Content-Type + Content-Length
  // so a longer TTL doesn't meaningfully expand the attack surface.
  const audioKey = audioStorageKey(submission.id);
  const audioPutUrl = await presignPut(audioKey, "audio/mpeg", audioSize as number, 600);

  let artworkPutUrl: string | null = null;
  let artKey: string | null = null;
  if (artKind) {
    artKey = artworkStorageKey(submission.id, artKind);
    artworkPutUrl = await presignPut(
      artKey,
      artKind === "png" ? "image/png" : "image/jpeg",
      artworkSize as number,
      600,
    );
  }

  return NextResponse.json({
    ok: true,
    id: submission.id,
    audioPutUrl,
    audioContentType: "audio/mpeg",
    artworkPutUrl,
    artworkContentType: artKind ? (artKind === "png" ? "image/png" : "image/jpeg") : null,
    expiresInSeconds: 600,
  });
}
