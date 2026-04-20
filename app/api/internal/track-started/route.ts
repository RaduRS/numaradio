// POST /api/internal/track-started
//
// Called by Liquidsoap on_track on the mini-server whenever a new track
// begins playing. Records the track's start time so the website can show a
// truthful elapsed/duration progress bar.
//
// Auth: shared secret in `x-internal-secret` header. The same secret must be
// in INTERNAL_API_SECRET on Vercel and in /etc/numa/env on the mini-server.
//
// Body: { sourceUrl?: string, trackId?: string, title?: string, artist?: string }
//   Trying, in order:
//     1. explicit trackId
//     2. trackId extracted from sourceUrl path (…/tracks/{id}/audio/…)
//     3. title+artist lookup against this station's library (ID3 fallback,
//        because playlist.reloadable pre-downloads HTTP tracks to /tmp and
//        strips the original URL from metadata)

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

function extractTrackId(url: string): string | null {
  const m = url.match(/\/tracks\/([^/]+)\/audio\//);
  return m?.[1] ?? null;
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-internal-secret");
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected || secret !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { sourceUrl?: string; trackId?: string; title?: string; artist?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) {
    return Response.json({ error: "unknown station" }, { status: 404 });
  }

  let trackId: string | null = body.trackId ?? null;
  if (!trackId && body.sourceUrl) trackId = extractTrackId(body.sourceUrl);

  let track: { id: string; stationId: string; durationSeconds: number | null } | null = null;
  if (trackId) {
    track = await prisma.track.findUnique({
      where: { id: trackId },
      select: { id: true, stationId: true, durationSeconds: true },
    });
  }
  if (!track && body.title) {
    track = await prisma.track.findFirst({
      where: {
        stationId: station.id,
        title: { equals: body.title, mode: "insensitive" },
        ...(body.artist
          ? { artistDisplay: { equals: body.artist, mode: "insensitive" } }
          : {}),
      },
      select: { id: true, stationId: true, durationSeconds: true },
      orderBy: { updatedAt: "desc" },
    });
  }
  if (!track) {
    return Response.json(
      {
        error: "track not found",
        tried: { trackId, title: body.title, artist: body.artist },
      },
      { status: 404 },
    );
  }
  if (station.id !== track.stationId) {
    return Response.json({ error: "station mismatch" }, { status: 400 });
  }

  const startedAt = new Date();
  const durationMs = (track.durationSeconds ?? 180) * 1000;
  const expectedEndAt = new Date(startedAt.getTime() + durationMs);

  const trackMeta = await prisma.track.findUnique({
    where: { id: track.id },
    select: { title: true },
  });

  await prisma.$transaction([
    prisma.nowPlaying.upsert({
      where: { stationId: station.id },
      create: {
        stationId: station.id,
        currentTrackId: track.id,
        startedAt,
        expectedEndAt,
        lastHeartbeatAt: startedAt,
      },
      update: {
        currentTrackId: track.id,
        startedAt,
        expectedEndAt,
        lastHeartbeatAt: startedAt,
      },
    }),
    prisma.playHistory.create({
      data: {
        stationId: station.id,
        trackId: track.id,
        segmentType: "audio_track",
        titleSnapshot: trackMeta?.title ?? null,
        startedAt,
        durationSeconds: track.durationSeconds,
        completedNormally: true,
      },
    }),
  ]);

  return Response.json({ ok: true, trackId: track.id, startedAt });
}
