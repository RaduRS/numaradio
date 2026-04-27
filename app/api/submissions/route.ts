// POST /api/submissions
//
// Public endpoint accepting multipart/form-data:
//   - name (text, required, 2-80 chars)
//   - email (text, required, RFC-ish)
//   - audio (file, required, audio/mpeg ≤10MB, magic-byte verified)
//   - artwork (file, optional, image/png|jpeg ≤2MB, magic-byte verified)
//   - airingPreference (text: "one_off" | "permanent", default "one_off")
//   - vouched (text: "true", required)
//
// Side-effects on success: row in MusicSubmission (status=pending),
// audio (and artwork if present) uploaded to B2 under submissions/.
//
// Per-email pending rate-limit: only one pending submission per email
// at a time. Returns 429 with a clear message when blocked.

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { probeDurationSeconds } from "@/lib/probe-duration";
import {
  isValidEmail,
  isValidName,
  normalizeEmail,
  normalizeName,
  sniffMp3,
  sniffImage,
  audioStorageKey,
  artworkStorageKey,
  MAX_AUDIO_BYTES,
  MAX_ARTWORK_BYTES,
} from "@/lib/submissions";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

function fail(error: string, message: string, status = 400) {
  return NextResponse.json({ error, message }, { status });
}

function ipHashOf(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0]?.trim() ?? "0.0.0.0";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("bad_form", "Could not parse the form data.");
  }

  const name = form.get("name");
  const email = form.get("email");
  const vouched = form.get("vouched");
  const airingPrefRaw = form.get("airingPreference");
  const audioBlob = form.get("audio");
  const artworkBlob = form.get("artwork");

  if (typeof name !== "string" || !isValidName(name)) {
    return fail("bad_name", "Please enter a name between 2 and 80 characters.");
  }
  if (typeof email !== "string" || !isValidEmail(email)) {
    return fail("bad_email", "Please enter a valid email address.");
  }
  if (vouched !== "true") {
    return fail("not_vouched", "You must confirm the rights and broadcast authorisation.");
  }
  const airingPreference = airingPrefRaw === "permanent" ? "permanent" : "one_off";

  if (!(audioBlob instanceof Blob) || audioBlob.size === 0) {
    return fail("missing_audio", "Please attach an MP3 file.");
  }
  if (audioBlob.size > MAX_AUDIO_BYTES) {
    return fail("audio_too_large", "MP3 must be 10 MB or smaller.", 413);
  }

  const audioBuffer = Buffer.from(await audioBlob.arrayBuffer());
  if (!sniffMp3(audioBuffer)) {
    return fail("bad_mp3", "That file doesn't look like a valid MP3.");
  }

  // Optional artwork
  let artworkBuffer: Buffer | null = null;
  let artworkKind: "png" | "jpeg" | null = null;
  if (artworkBlob instanceof Blob && artworkBlob.size > 0) {
    if (artworkBlob.size > MAX_ARTWORK_BYTES) {
      return fail("artwork_too_large", "Artwork must be 2 MB or smaller.", 413);
    }
    artworkBuffer = Buffer.from(await artworkBlob.arrayBuffer());
    artworkKind = sniffImage(artworkBuffer);
    if (!artworkKind) {
      return fail("bad_artwork", "Artwork must be a PNG or JPEG image.");
    }
  }

  const normEmail = normalizeEmail(email);

  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) return fail("no_station", "Server misconfiguration.", 500);

  // Per-email pending rate-limit
  const existing = await prisma.musicSubmission.findFirst({
    where: { email: normEmail, status: "pending" },
    select: { id: true },
  });
  if (existing) {
    return fail(
      "pending_exists",
      "You've already got a submission pending. We'll respond before you can send another.",
      429,
    );
  }

  // Probe duration (frame-accurate, same as seed)
  let durationSeconds: number | null = null;
  try {
    const probed = await probeDurationSeconds(audioBuffer);
    if (probed !== null) {
      durationSeconds = Math.round(probed);
    }
  } catch {
    // Don't block submission on a probe failure — operator will see in dashboard
  }

  // Insert row first (id is generated server-side via cuid default), then
  // upload to B2 using that id as the key. Order keeps the DB authoritative.
  const submission = await prisma.musicSubmission.create({
    data: {
      stationId: station.id,
      artistName: normalizeName(name),
      email: normEmail,
      ipHash: ipHashOf(req),
      audioStorageKey: "", // filled after upload
      artworkStorageKey: null,
      durationSeconds,
      airingPreference,
      status: "pending",
      vouched: true,
    },
    select: { id: true },
  });

  const audioKey = audioStorageKey(submission.id);
  await putObject(audioKey, audioBuffer, "audio/mpeg");

  let artKey: string | null = null;
  if (artworkBuffer && artworkKind) {
    artKey = artworkStorageKey(submission.id, artworkKind);
    await putObject(artKey, artworkBuffer, artworkKind === "png" ? "image/png" : "image/jpeg");
  }

  await prisma.musicSubmission.update({
    where: { id: submission.id },
    data: { audioStorageKey: audioKey, artworkStorageKey: artKey },
  });

  return NextResponse.json({ ok: true, id: submission.id }, { status: 200 });
}
