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
// How long past Track.durationSeconds we keep showing the current track
// before flipping to "isPlaying: false". Bumped from 30s → 120s because
// many catalogue entries have durationSeconds shorter than actual
// playback (metadata extracted from MP3 frames vs Liquidsoap's real
// playout). At 30s, listeners saw the artwork + artist disappear in the
// last 20-30s of every long-running track. 120s comfortably covers
// normal duration variance while still flagging a genuinely dead
// broadcast (no track-started in 2 min = something's wrong).
const STALE_GRACE_SECONDS = 120;

const HEADERS = {
  // Very tight CDN TTL — this feed surfaces live track changes. Any extra
  // staleness gets perceived by the listener as "the UI is lying about
  // what I'm hearing". One second fresh, two seconds while revalidating.
  "Cache-Control": "public, s-maxage=1, stale-while-revalidate=2",
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

type ShoutoutPayload =
  | { active: false }
  | { active: true; startedAt: string; expectedEndAt: string };

type BroadcastPayload = {
  nowPlaying: NowPlayingPayload;
  upNext: UpNextPayload;
  justPlayed: JustPlayedPayload;
  shoutout: ShoutoutPayload;
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
  shoutout: { active: false },
};

export async function GET() {
  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) return respond(EMPTY);

  const stationId = station.id;

  const [np, ns, upNextRow, history] = await Promise.all([
    prisma.nowPlaying.findUnique({ where: { stationId } }),
    prisma.nowSpeaking.findUnique({ where: { stationId } }),
    prisma.queueItem.findFirst({
      where: {
        stationId,
        priorityBand: "priority_request",
        queueStatus: { in: ["planned", "staged"] },
        // Shoutouts ride a separate overlay source and are never songs; they
        // must not appear in Up Next even if a push accidentally landed on
        // the music queue. Defense in depth — the on-host daemon already
        // routes by kind.
        queueType: { not: "shoutout" },
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
  // Track the currently-playing row's startedAt so we can drop just the
  // matching PlayHistory entry later without also dropping older plays of
  // the same track (which would wipe history when a user re-requests a
  // previously-aired song).
  let currentStartedAtMs: number | null = null;

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
        currentStartedAtMs = np.startedAt.getTime();
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
  // Drop only the literal current-track row (matched by startedAt) — not
  // every row with the same trackId. Otherwise a re-requested track would
  // vanish from history as soon as it became current.
  const justPlayed: JustPlayedPayload = history
    .filter(
      (row) =>
        currentStartedAtMs === null ||
        row.startedAt.getTime() < currentStartedAtMs,
    )
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

  // ── Shoutout (voice overlay) ─────────────────────────────────
  // The bed keeps showing in title/artwork while Lena talks on top.
  // This flag tells the Hero to render a "• Lena on air" pill so the
  // listener knows why the music just ducked.
  let shoutout: ShoutoutPayload = { active: false };
  if (ns?.expectedEndAt) {
    const expiredMs = Date.now() - ns.expectedEndAt.getTime();
    if (expiredMs <= STALE_GRACE_SECONDS * 1000) {
      shoutout = {
        active: true,
        startedAt: ns.startedAt.toISOString(),
        expectedEndAt: ns.expectedEndAt.toISOString(),
      };
    }
  }

  return respond({ nowPlaying, upNext, justPlayed, shoutout });
}
