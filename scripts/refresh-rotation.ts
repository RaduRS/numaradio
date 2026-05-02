import "../lib/load-env.ts";
import { randomBytes } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

export type RotationTrack = { id: string; url: string; title: string };

export type RefreshResult = {
  librarySize: number;
  cyclePlayed: number;
  poolSize: number;
  cycleWrapped: boolean;
};

const PLAYLIST_PATH = process.env.NUMA_PLAYLIST_PATH ?? "/etc/numa/playlist.m3u";

/**
 * Walk PlayHistory (most recent first) collecting distinct track ids until
 * we see a duplicate (= entered previous cycle) or until we've seen the
 * whole library (= cycle just completed). The returned set is "what has
 * already aired in the current generational cycle".
 */
export function cyclePlayedFrom(recentIds: string[], librarySize: number): Set<string> {
  const seen = new Set<string>();
  for (const id of recentIds) {
    if (seen.has(id)) break;
    seen.add(id);
    if (seen.size >= librarySize) break;
  }
  return seen;
}

/**
 * Generational rotation: shuffle the not-yet-aired tracks from the current
 * cycle. When the cycle is exhausted, wrap and shuffle the whole library
 * minus the bridge (currently-playing track) so the first track of the new
 * cycle can never be the last track of the old one.
 */
export function buildPlaylist(
  library: RotationTrack[],
  cycleExclude: Set<string>,
  bridgeExclude: Set<string>,
  rng: () => number = Math.random,
): string {
  if (library.length === 0) return "";
  let pool = library.filter((t) => !cycleExclude.has(t.id));
  if (pool.length === 0) {
    // Cycle wrap. Bridge: keep the just-played track out so the seam
    // between cycle N and N+1 can't repeat the same track back-to-back.
    pool = library.filter((t) => !bridgeExclude.has(t.id));
    // Degenerate library of size 1: bridge would empty the pool — accept
    // the immediate repeat rather than write nothing.
    if (pool.length === 0) pool = library;
  }
  // Fisher–Yates
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.map((t) => t.url).join("\n") + "\n";
}

/**
 * Reads the library, derives the current cycle from PlayHistory, shuffles
 * the remaining tracks, and atomically rewrites the playlist file. Exported
 * so the queue-daemon can fire this on every track-started callback in
 * addition to the safety-net systemd timer. Caller owns the prisma lifecycle.
 */
export async function runRefresh(
  prisma: Pick<PrismaClient, "station" | "track" | "playHistory" | "nowPlaying">,
): Promise<RefreshResult> {
  const station = await prisma.station.findUniqueOrThrow({
    where: { slug: process.env.STATION_SLUG ?? "numaradio" },
    select: { id: true },
  });

  const tracks = await prisma.track.findMany({
    where: {
      stationId: station.id,
      trackStatus: "ready",
      airingPolicy: "library",
    },
    select: {
      id: true,
      title: true,
      assets: {
        where: { assetType: "audio_stream" },
        take: 1,
        select: { publicUrl: true },
      },
    },
  });

  const library: RotationTrack[] = tracks.flatMap((t) => {
    const asset = t.assets[0];
    return asset?.publicUrl ? [{ id: t.id, url: asset.publicUrl, title: t.title }] : [];
  });

  // Read enough history to detect a cycle wrap (one full library + slack).
  const historyTake = Math.max(library.length * 2, 8);

  const readState = async (): Promise<{ cyclePlayed: Set<string>; nowPlayingId: string | null }> => {
    const [recent, nowPlaying] = await Promise.all([
      prisma.playHistory.findMany({
        where: { stationId: station.id, trackId: { not: null } },
        orderBy: { startedAt: "desc" },
        take: historyTake,
        select: { trackId: true },
      }),
      prisma.nowPlaying.findUnique({
        where: { stationId: station.id },
        select: { currentTrackId: true },
      }),
    ]);
    return {
      cyclePlayed: cyclePlayedFrom(
        recent.map((r) => r.trackId!).filter(Boolean),
        library.length,
      ),
      nowPlayingId: nowPlaying?.currentTrackId ?? null,
    };
  };

  // Race-guard: a `track-started` transaction (Liquidsoap → Vercel →
  // Neon: NowPlaying upsert + PlayHistory insert) takes ~100-500 ms to
  // commit. If we read in that window the just-started track is invisible
  // to both reads. Reading twice with a 300 ms gap and unioning closes
  // the window — same pattern that protected the old sliding-window
  // implementation against back-to-back airings.
  const before = await readState();
  await new Promise((r) => setTimeout(r, 300));
  const after = await readState();

  const cycleExclude = new Set<string>([...before.cyclePlayed, ...after.cyclePlayed]);
  const bridgeExclude = new Set<string>();
  const nowPlayingId = after.nowPlayingId ?? before.nowPlayingId;
  if (nowPlayingId) {
    cycleExclude.add(nowPlayingId);
    bridgeExclude.add(nowPlayingId);
  }

  const cycleWrapped = library.length > 0 && library.every((t) => cycleExclude.has(t.id));
  const content = buildPlaylist(library, cycleExclude, bridgeExclude);

  const suffix = randomBytes(4).toString("hex");
  const tmpPath = join(tmpdir(), `playlist-${process.pid}-${Date.now()}-${suffix}.m3u`);
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, PLAYLIST_PATH);

  return {
    librarySize: library.length,
    cyclePlayed: cycleExclude.size,
    poolSize: cycleWrapped
      ? Math.max(library.length - bridgeExclude.size, 0)
      : Math.max(library.length - cycleExclude.size, 0),
    cycleWrapped,
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await runRefresh(prisma);
    const tracks = await prisma.track.findMany({
      where: {
        stationId: (
          await prisma.station.findUniqueOrThrow({
            where: { slug: process.env.STATION_SLUG ?? "numaradio" },
            select: { id: true },
          })
        ).id,
        trackStatus: "ready",
        airingPolicy: "library",
      },
      select: { title: true },
      take: 3,
    });
    const sample = tracks.map((t) => t.title).join(", ");
    console.log(
      `[refresh-rotation] library=${result.librarySize} cyclePlayed=${result.cyclePlayed} poolSize=${result.poolSize} wrapped=${result.cycleWrapped} wrote=${PLAYLIST_PATH} sample=[${sample}]`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[refresh-rotation] failed", err);
    process.exit(1);
  });
}
