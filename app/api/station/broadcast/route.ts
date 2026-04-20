// GET /api/station/broadcast
//
// One-shot feed for the landing page's "Now Playing / Just Played" section:
//
//   {
//     nowPlaying: { isPlaying, trackId?, title?, artistDisplay?, durationSeconds?,
//                   startedAt?, artworkUrl? },
//     upNext:     { trackId, title, artistDisplay?, reasonCode? } | null,
//     justPlayed: [ { trackId?, title, artistDisplay?, artworkUrl?, startedAt,
//                     durationSeconds? } ]
//   }
//
// We expose "up next" ONLY when a priority request is staged — the rotation
// source is a shuffled library feed, so the next rotation track is genuinely
// unknown. Showing a fake preview would lie. "Just played" reads from the
// PlayHistory table the mini-server writes on every track start, with the
// currently-playing row filtered out.

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const HISTORY_LIMIT = 4;
const STALE_GRACE_SECONDS = 30;

const HEADERS = {
  "Cache-Control": "public, s-maxage=5, stale-while-revalidate=15",
};

type TrackSummary = {
  trackId: string;
  title: string;
  artistDisplay?: string;
  artworkUrl?: string;
};

type NowPlayingPayload =
  | { isPlaying: false }
  | ({
      isPlaying: true;
      startedAt: string;
      durationSeconds?: number;
    } & TrackSummary);

type UpNextPayload = (TrackSummary & { reasonCode?: string }) | null;

type JustPlayedPayload = Array<
  TrackSummary & { startedAt: string; durationSeconds?: number }
>;

type BroadcastPayload = {
  nowPlaying: NowPlayingPayload;
  upNext: UpNextPayload;
  justPlayed: JustPlayedPayload;
};

function respond(payload: BroadcastPayload): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...HEADERS, "Content-Type": "application/json" },
  });
}

const EMPTY: BroadcastPayload = {
  nowPlaying: { isPlaying: false },
  upNext: null,
  justPlayed: [],
};

export async function GET() {
  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) return respond(EMPTY);

  const stationId = station.id;

  const [np, upNextRow, history] = await Promise.all([
    prisma.nowPlaying.findUnique({ where: { stationId } }),
    prisma.queueItem.findFirst({
      where: {
        stationId,
        priorityBand: "priority_request",
        queueStatus: { in: ["planned", "staged"] },
      },
      orderBy: { positionIndex: "asc" },
      select: {
        trackId: true,
        reasonCode: true,
        track: {
          select: {
            id: true,
            title: true,
            artistDisplay: true,
            assets: {
              where: { assetType: "artwork_primary" },
              take: 1,
              select: { publicUrl: true },
            },
          },
        },
      },
    }),
    prisma.playHistory.findMany({
      where: { stationId, segmentType: "audio_track" },
      orderBy: { startedAt: "desc" },
      // Over-fetch by 1 so we can drop the currently-playing row and still
      // return HISTORY_LIMIT entries.
      take: HISTORY_LIMIT + 1,
      select: {
        trackId: true,
        titleSnapshot: true,
        startedAt: true,
        durationSeconds: true,
        track: {
          select: {
            id: true,
            title: true,
            artistDisplay: true,
            assets: {
              where: { assetType: "artwork_primary" },
              take: 1,
              select: { publicUrl: true },
            },
          },
        },
      },
    }),
  ]);

  // ── Now playing ──────────────────────────────────────────────
  let nowPlaying: NowPlayingPayload = { isPlaying: false };
  let currentTrackId: string | null = null;

  if (np?.currentTrackId && np.startedAt) {
    const expired =
      np.expectedEndAt &&
      Date.now() - np.expectedEndAt.getTime() > STALE_GRACE_SECONDS * 1000;
    if (!expired) {
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
      if (track) {
        currentTrackId = track.id;
        nowPlaying = {
          isPlaying: true,
          trackId: track.id,
          title: track.title,
          artistDisplay: track.artistDisplay ?? undefined,
          durationSeconds: track.durationSeconds ?? undefined,
          startedAt: np.startedAt.toISOString(),
          artworkUrl: track.assets[0]?.publicUrl ?? undefined,
        };
      }
    }
  }

  // ── Up next ──────────────────────────────────────────────────
  const upNext: UpNextPayload =
    upNextRow?.track
      ? {
          trackId: upNextRow.track.id,
          title: upNextRow.track.title,
          artistDisplay: upNextRow.track.artistDisplay ?? undefined,
          artworkUrl: upNextRow.track.assets[0]?.publicUrl ?? undefined,
          reasonCode: upNextRow.reasonCode ?? undefined,
        }
      : null;

  // ── Just played ──────────────────────────────────────────────
  const justPlayed: JustPlayedPayload = history
    .filter((row) => row.trackId !== currentTrackId)
    .slice(0, HISTORY_LIMIT)
    .map((row) => {
      const t = row.track;
      const title = t?.title ?? row.titleSnapshot ?? "Unknown";
      return {
        trackId: t?.id ?? row.trackId ?? "",
        title,
        artistDisplay: t?.artistDisplay ?? undefined,
        artworkUrl: t?.assets[0]?.publicUrl ?? undefined,
        startedAt: row.startedAt.toISOString(),
        durationSeconds: row.durationSeconds ?? undefined,
      };
    });

  return respond({ nowPlaying, upNext, justPlayed });
}
