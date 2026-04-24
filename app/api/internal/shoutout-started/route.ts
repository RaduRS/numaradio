// POST /api/internal/shoutout-started
//
// Called by Liquidsoap's overlay_queue.on_track callback whenever Lena
// begins speaking on top of the music bed. Writes NowSpeaking + a
// PlayHistory row with segmentType='audio_host' so the Hero can light up
// its "• Lena on air" pill, and the Just Played list stays music-only
// (the existing broadcast filter already drops non-audio_track rows).
//
// Intentionally does NOT touch NowPlaying — the music bed keeps playing
// underneath, so nowPlaying should continue pointing at the song, not at
// the shoutout.
//
// Auth: shared secret in `x-internal-secret` header.
//
// Body: { sourceUrl?, trackId?, title?, artist?, durationSeconds? }
//   Resolution order matches /api/internal/track-started — explicit
//   trackId → extracted from sourceUrl → title+artist lookup.

import { prisma } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
// If shoutout-ended never arrives, age NowSpeaking out after a generous
// default so the pill doesn't stick forever.
const DEFAULT_DURATION_SECONDS = 30;
const HEARTBEAT_GRACE_SECONDS = 30;

function extractTrackId(url: string): string | null {
  const m = url.match(/\/tracks\/([^/]+)\/audio\//);
  return m?.[1] ?? null;
}

export async function POST(req: Request) {
  if (!internalAuthOk(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    sourceUrl?: string;
    trackId?: string;
    title?: string;
    artist?: string;
    durationSeconds?: number;
  };
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

  let track: { id: string; stationId: string; durationSeconds: number | null; title: string } | null = null;
  if (trackId) {
    track = await prisma.track.findUnique({
      where: { id: trackId },
      select: { id: true, stationId: true, durationSeconds: true, title: true },
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
      select: { id: true, stationId: true, durationSeconds: true, title: true },
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
  // Prefer the body-provided duration (Liquidsoap can read it from the
  // request metadata), fall back to Track.durationSeconds, then a safe
  // default so the pill ages out even if nothing downstream is correct.
  const durationSeconds =
    body.durationSeconds ?? track.durationSeconds ?? DEFAULT_DURATION_SECONDS;
  const expectedEndAt = new Date(
    startedAt.getTime() + (durationSeconds + HEARTBEAT_GRACE_SECONDS) * 1000,
  );

  await prisma.$transaction([
    prisma.nowSpeaking.upsert({
      where: { stationId: station.id },
      create: {
        stationId: station.id,
        trackId: track.id,
        startedAt,
        expectedEndAt,
        lastHeartbeatAt: startedAt,
      },
      update: {
        trackId: track.id,
        startedAt,
        expectedEndAt,
        lastHeartbeatAt: startedAt,
      },
    }),
    prisma.playHistory.create({
      data: {
        stationId: station.id,
        trackId: track.id,
        segmentType: "audio_host",
        titleSnapshot: track.title,
        startedAt,
        durationSeconds: track.durationSeconds,
        completedNormally: true,
      },
    }),
  ]);

  return Response.json({ ok: true, trackId: track.id, startedAt });
}
