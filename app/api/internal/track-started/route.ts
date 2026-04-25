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
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

function extractTrackId(url: string): string | null {
  const m = url.match(/\/tracks\/([^/]+)\/audio\//);
  return m?.[1] ?? null;
}

export async function POST(req: Request) {
  if (!internalAuthOk(req)) {
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

  let track: {
    id: string;
    stationId: string;
    durationSeconds: number | null;
    title: string;
    airingPolicy: "library" | "request_only" | "priority_request" | "hold";
  } | null = null;
  if (trackId) {
    track = await prisma.track.findUnique({
      where: { id: trackId },
      select: { id: true, stationId: true, durationSeconds: true, title: true, airingPolicy: true },
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
      select: { id: true, stationId: true, durationSeconds: true, title: true, airingPolicy: true },
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

  // Close out the previous still-open PlayHistory row (if any) so
  // its endedAt and completedNormally reflect what actually
  // happened. Heuristic: if the previous row was within 5 s of its
  // expected duration, treat as completedNormally; if it's missing
  // a duration (legacy data) leave completedNormally untouched.
  // Without a track-ended Liquidsoap callback this is the closest
  // we can get to a truthful ledger — better than every row
  // showing completedNormally=true forever.
  const previous = await prisma.playHistory.findFirst({
    where: { stationId: station.id, endedAt: null, segmentType: "audio_track" },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, durationSeconds: true },
  });
  let closePreviousOp: ReturnType<typeof prisma.playHistory.update> | null = null;
  if (previous) {
    const elapsedSec = Math.round((startedAt.getTime() - previous.startedAt.getTime()) / 1000);
    const expected = previous.durationSeconds ?? null;
    const completedNormally =
      expected != null ? Math.abs(elapsedSec - expected) <= 5 : true;
    closePreviousOp = prisma.playHistory.update({
      where: { id: previous.id },
      data: { endedAt: startedAt, completedNormally },
    });
  }

  const nowPlayingOp = prisma.nowPlaying.upsert({
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
  });
  const playHistoryOp = prisma.playHistory.create({
    data: {
      stationId: station.id,
      trackId: track.id,
      segmentType: "audio_track",
      titleSnapshot: track.title,
      startedAt,
      durationSeconds: track.durationSeconds,
      // Optimistic — closed out by the NEXT track-started call (see
      // the previous-row close-out above). If Liquidsoap restarts
      // without firing a final track-started, this row stays open
      // indefinitely; an operator-side sweeper can clean those up.
      completedNormally: true,
    },
  });
  // After a listener-generated song airs once via the priority queue, move
  // it OUT of rotation by flipping to 'request_only'. The operator can
  // re-air it on demand from the dashboard library page (which now surfaces
  // request_only tracks and allows pushing them). This makes listener
  // submissions one-shot by default rather than permanent rotation adds.
  const ops: Promise<unknown>[] = [nowPlayingOp, playHistoryOp];
  if (closePreviousOp) ops.push(closePreviousOp);
  if (track.airingPolicy === "priority_request") {
    ops.push(
      prisma.track.update({
        where: { id: track.id },
        data: { airingPolicy: "request_only" },
      }),
    );
  }
  await prisma.$transaction(ops as never);

  return Response.json({ ok: true, trackId: track.id, startedAt });
}
