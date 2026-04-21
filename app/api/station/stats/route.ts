// GET /api/station/stats
//
// Headline numbers for the Hero strip — honest, live figures.
//
//   {
//     tracksThisWeek: number,   // PlayHistory rows with segmentType=audio_track,
//                               // startedAt within the last 7 days
//     libraryCount:   number,   // Track rows with airingPolicy=library and
//                               // trackStatus=ready (i.e. actually in rotation)
//     shoutoutCount:  number,   // Shoutout rows with deliveryStatus=aired
//   }

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const HEADERS = {
  // Numbers tick up slowly — a minute of cache is fine and shields the DB.
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
  "Content-Type": "application/json",
};

type StatsPayload = {
  tracksThisWeek: number;
  libraryCount: number;
  shoutoutCount: number;
};

const EMPTY: StatsPayload = {
  tracksThisWeek: 0,
  libraryCount: 0,
  shoutoutCount: 0,
};

export async function GET() {
  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) {
    return new Response(JSON.stringify(EMPTY), { status: 200, headers: HEADERS });
  }

  const weekAgo = new Date(Date.now() - WEEK_MS);

  const [tracksThisWeek, libraryCount, shoutoutCount] = await Promise.all([
    prisma.playHistory.count({
      where: {
        stationId: station.id,
        segmentType: "audio_track",
        startedAt: { gte: weekAgo },
      },
    }),
    prisma.track.count({
      where: {
        stationId: station.id,
        airingPolicy: "library",
        trackStatus: "ready",
      },
    }),
    prisma.shoutout.count({
      where: { stationId: station.id, deliveryStatus: "aired" },
    }),
  ]);

  const payload: StatsPayload = { tracksThisWeek, libraryCount, shoutoutCount };
  return new Response(JSON.stringify(payload), { status: 200, headers: HEADERS });
}
