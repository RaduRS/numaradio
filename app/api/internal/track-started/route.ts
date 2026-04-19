// POST /api/internal/track-started
//
// Called by Liquidsoap on_track on the mini-server whenever a new track
// begins playing. Records the track's start time so the website can show a
// truthful elapsed/duration progress bar.
//
// Auth: shared secret in `x-internal-secret` header. The same secret must be
// in INTERNAL_API_SECRET on Vercel and in /etc/numa/env on the mini-server.
//
// Body: { sourceUrl: string }
//   sourceUrl is the B2 URL Liquidsoap pulled. We extract the trackId from
//   the path (which follows our canonical layout
//   `stations/{slug}/tracks/{trackId}/audio/stream.mp3`).

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

  let body: { sourceUrl?: string; trackId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  let trackId = body.trackId ?? null;
  if (!trackId && body.sourceUrl) trackId = extractTrackId(body.sourceUrl);
  if (!trackId) {
    return Response.json(
      { error: "trackId or sourceUrl required" },
      { status: 400 },
    );
  }

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { id: true, stationId: true, durationSeconds: true },
  });
  if (!track) {
    return Response.json({ error: "unknown trackId" }, { status: 404 });
  }

  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station || station.id !== track.stationId) {
    return Response.json({ error: "station mismatch" }, { status: 400 });
  }

  const startedAt = new Date();
  const durationMs = (track.durationSeconds ?? 180) * 1000;
  const expectedEndAt = new Date(startedAt.getTime() + durationMs);

  await prisma.nowPlaying.upsert({
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

  return Response.json({ ok: true, trackId: track.id, startedAt });
}
