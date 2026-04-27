// GET /api/station/stats
//
// Headline numbers for the Hero strip — honest, live figures.
//
//   {
//     tracksThisWeek: number,   // PlayHistory rows with segmentType=audio_track,
//                               // startedAt >= the most recent Monday 00:00 UTC
//                               // (i.e. resets every Monday at 00:00 UTC, not a
//                               // rolling 168h window).
//     libraryCount:   number,   // Track rows with airingPolicy=library and
//                               // trackStatus=ready (i.e. actually in rotation)
//     shoutoutCount:  number,   // Shoutout rows with deliveryStatus=aired
//   }

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

/**
 * Most recent Monday 00:00 UTC at or before `now`. Sunday counts as the
 * tail of the previous week, so a Sunday-23:59 viewer still sees the
 * stats from that calendar week.
 */
function startOfWeekUTC(now: Date = new Date()): Date {
  const out = new Date(now);
  out.setUTCHours(0, 0, 0, 0);
  // getUTCDay: Sunday=0, Monday=1 … Saturday=6
  // Distance back to Monday: Mon→0, Tue→1, …, Sun→6
  const daysSinceMonday = (out.getUTCDay() + 6) % 7;
  out.setUTCDate(out.getUTCDate() - daysSinceMonday);
  return out;
}

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

  const weekStart = startOfWeekUTC();

  const [tracksThisWeek, libraryCount, shoutoutCount] = await Promise.all([
    prisma.playHistory.count({
      where: {
        stationId: station.id,
        segmentType: "audio_track",
        startedAt: { gte: weekStart },
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
