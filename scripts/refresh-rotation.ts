import "../lib/load-env.ts";
import { randomBytes } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

export type RotationTrack = { id: string; url: string; title: string };

export type RefreshResult = {
  librarySize: number;
  excluded: number;
  poolSize: number;
};

const PLAYLIST_PATH = process.env.NUMA_PLAYLIST_PATH ?? "/etc/numa/playlist.m3u";
const MAX_RECENT_WINDOW = 20;
const MIN_POOL = 6;

// Size the "avoid recent" window so that the non-recent pool is at least
// MIN_POOL tracks. Liquidsoap's default `playlist()` mode is "randomize":
// when it exhausts the file it reshuffles and plays through again. With a
// tiny pool (2-3) that reshuffle has a ~1-in-pool chance of landing the
// just-played track first, so a 2-track pool gave back-to-back repeats
// in live operation. MIN_POOL=6 keeps the repeat probability ≤ 1/6 and
// gives listeners actual variety between refreshes. Capped at 20 to
// match the PlayHistory read limit; clamped to 1 for degenerate libraries.
export function recentWindowFor(librarySize: number): number {
  return Math.max(1, Math.min(MAX_RECENT_WINDOW, librarySize - MIN_POOL));
}

export function buildPlaylist(
  library: RotationTrack[],
  recentIds: Set<string>,
  rng: () => number = Math.random,
): string {
  if (library.length === 0) return "";
  const excluded = library.filter((t) => !recentIds.has(t.id));
  // Only fall back to the full library when the exclusion is empty; a pool of
  // 1 is still preferable to letting a just-played track air again. See the
  // 2026-04-20 repeat/starvation bug in the test file for why.
  const pool = excluded.length === 0 ? library : excluded;
  // Fisher–Yates
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.map((t) => t.url).join("\n") + "\n";
}

/**
 * Reads the library, computes the exclusion set, shuffles, and atomically
 * rewrites the playlist file. Exported so the queue-daemon can fire this
 * on every track-started callback (push-based) in addition to the 2-min
 * systemd timer (safety-net pull). Caller owns the prisma lifecycle.
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

  const window = recentWindowFor(library.length);
  const readExclusion = async (): Promise<Set<string>> => {
    const [recent, nowPlaying] = await Promise.all([
      prisma.playHistory.findMany({
        where: { stationId: station.id, trackId: { not: null } },
        orderBy: { startedAt: "desc" },
        take: window,
        select: { trackId: true },
      }),
      prisma.nowPlaying.findUnique({
        where: { stationId: station.id },
        select: { currentTrackId: true },
      }),
    ]);
    const s = new Set(recent.map((r) => r.trackId!).filter(Boolean));
    if (nowPlaying?.currentTrackId) s.add(nowPlaying.currentTrackId);
    return s;
  };

  // Race-guard: a `track-started` transaction (Liquidsoap → Vercel →
  // Neon: NowPlaying upsert + PlayHistory insert in one tx) takes
  // ~100-500 ms to commit. If the refresher reads in that window,
  // both NowPlaying *and* recent PlayHistory still show the previous
  // track — so the just-started track isn't excluded and Fisher-Yates
  // can land it at position 0, producing back-to-back airings when
  // Liquidsoap loops the playlist. Reading twice with a 300 ms gap
  // closes that window: any commit landing between the two reads
  // shows up in the second one, and we union the results.
  const before = await readExclusion();
  await new Promise((r) => setTimeout(r, 300));
  const after = await readExclusion();
  const recentIds = new Set([...before, ...after]);
  const newlyVisible = [...after].filter((id) => !before.has(id));
  if (newlyVisible.length > 0) {
    console.log(
      `[refresh-rotation] race-guard caught fresh track(s): ${newlyVisible.join(",")}`,
    );
  }

  const content = buildPlaylist(library, recentIds);

  // PID + Date.now() can collide if the timer double-fires inside
  // the same millisecond (rare but possible under load). Adding 8
  // bytes of randomness makes a collision essentially impossible.
  const suffix = randomBytes(4).toString("hex");
  const tmpPath = join(tmpdir(), `playlist-${process.pid}-${Date.now()}-${suffix}.m3u`);
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, PLAYLIST_PATH);

  return {
    librarySize: library.length,
    excluded: recentIds.size,
    poolSize: Math.max(library.length - recentIds.size, 0),
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
      `[refresh-rotation] library=${result.librarySize} excluded=${result.excluded} wrote=${PLAYLIST_PATH} sample=[${sample}]`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Only run main() when invoked directly (so tests can import without side effects).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[refresh-rotation] failed", err);
    process.exit(1);
  });
}
