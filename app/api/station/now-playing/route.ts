// GET /api/station/now-playing
//
// Public read of the currently airing track + when it started. The frontend
// uses startedAt + durationSeconds to compute a local elapsed/progress
// display without polling per-second.

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

type Response = {
  isPlaying: boolean;
  trackId?: string;
  title?: string;
  artistDisplay?: string;
  durationSeconds?: number;
  startedAt?: string;
  artworkUrl?: string;
};

const HEADERS = {
  "Cache-Control": "public, s-maxage=2, stale-while-revalidate=10",
};

export async function GET() {
  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) {
    return new globalThis.Response(
      JSON.stringify({ isPlaying: false } satisfies Response),
      { status: 200, headers: { ...HEADERS, "Content-Type": "application/json" } },
    );
  }

  const np = await prisma.nowPlaying.findUnique({
    where: { stationId: station.id },
  });
  if (!np?.currentTrackId || !np.startedAt) {
    return new globalThis.Response(
      JSON.stringify({ isPlaying: false } satisfies Response),
      { status: 200, headers: { ...HEADERS, "Content-Type": "application/json" } },
    );
  }

  const track = await prisma.track.findUnique({
    where: { id: np.currentTrackId },
    select: {
      id: true,
      title: true,
      artistDisplay: true,
      durationSeconds: true,
      assets: {
        where: { assetType: "artwork_primary" },
        take: 1,
        select: { publicUrl: true },
      },
    },
  });
  if (!track) {
    return new globalThis.Response(
      JSON.stringify({ isPlaying: false } satisfies Response),
      { status: 200, headers: { ...HEADERS, "Content-Type": "application/json" } },
    );
  }

  const payload: Response = {
    isPlaying: true,
    trackId: track.id,
    title: track.title,
    artistDisplay: track.artistDisplay ?? undefined,
    durationSeconds: track.durationSeconds ?? undefined,
    startedAt: np.startedAt.toISOString(),
    artworkUrl: track.assets[0]?.publicUrl,
  };

  return new globalThis.Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...HEADERS, "Content-Type": "application/json" },
  });
}
