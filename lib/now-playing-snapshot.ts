// Shared now-playing snapshot used by both the public API route and the
// server-rendered layout. Layout uses it to seed the client-side singleton
// on first paint so the hero shows artwork/title/artist without a flash
// of "— by —". The API route uses it for subsequent polls.

import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";

export type ShoutoutPayload =
  | { active: false }
  | { active: true; startedAt: string; expectedEndAt: string };

export type NowPlayingSnapshot = {
  isPlaying: boolean;
  trackId?: string;
  title?: string;
  artistDisplay?: string;
  durationSeconds?: number;
  startedAt?: string;
  artworkUrl?: string;
  shoutout: ShoutoutPayload;
};

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
// Keep in sync with app/api/station/broadcast/route.ts. Frame-accurate
// durations (via lib/probe-duration.ts + the 2026-04-26 backfill) mean
// 30s is enough to absorb track-started callback latency.
const STALE_GRACE_SECONDS = 30;

const OFFLINE: NowPlayingSnapshot = {
  isPlaying: false,
  shoutout: { active: false },
};

export async function getNowPlayingSnapshot(): Promise<NowPlayingSnapshot> {
  const station = await prisma.station.findUnique({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });
  if (!station) return OFFLINE;

  const np = await prisma.nowPlaying.findUnique({
    where: { stationId: station.id },
  });
  if (!np?.currentTrackId || !np.startedAt) return OFFLINE;

  if (np.expectedEndAt) {
    const expiredMs = Date.now() - np.expectedEndAt.getTime();
    if (expiredMs > STALE_GRACE_SECONDS * 1000) return OFFLINE;
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
  if (!track) return OFFLINE;

  const ns = await prisma.nowSpeaking.findUnique({
    where: { stationId: station.id },
  });
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

  return {
    isPlaying: true,
    trackId: track.id,
    title: track.title,
    artistDisplay: track.artistDisplay ?? undefined,
    durationSeconds: track.durationSeconds ?? undefined,
    startedAt: np.startedAt.toISOString(),
    artworkUrl: track.assets[0]?.publicUrl,
    shoutout,
  };
}

// Cached wrapper for SSR call sites (notably app/layout.tsx, which fires
// on every uncached page visit). Without this, every cold visitor pays
// 4 sequential Prisma roundtrips of Vercel Active CPU. With a 5s
// revalidate window, one set of queries serves every SSR render in the
// window. The client-side poll (15s) catches up immediately on hydrate
// so the stale window is invisible. The /api/station/now-playing route
// keeps its own edge cache and is unaffected by this wrapper. (Added
// 2026-05-03 free-tier audit.)
export const getCachedNowPlayingSnapshot = unstable_cache(
  () => getNowPlayingSnapshot(),
  ["now-playing-snapshot-v1"],
  { revalidate: 5 },
);
