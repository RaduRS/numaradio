// Shared now-playing snapshot used by both the public API route and the
// server-rendered layout. Layout uses it to seed the client-side singleton
// on first paint so the hero shows artwork/title/artist without a flash
// of "— by —". The API route uses it for subsequent polls.

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
// Keep in sync with app/api/station/broadcast/route.ts. 120s allows for
// catalogue durationSeconds that underreport vs actual playback (common
// when metadata is extracted from MP3 frames). At 30s, the public site
// flipped artwork → placeholder in the last 20-30s of every long track.
const STALE_GRACE_SECONDS = 120;

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
