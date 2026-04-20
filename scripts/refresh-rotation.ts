import "../lib/load-env.ts";
import { writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

export type RotationTrack = { id: string; url: string };

const PLAYLIST_PATH = process.env.NUMA_PLAYLIST_PATH ?? "/etc/numa/playlist.m3u";
const RECENT_WINDOW = 20;
const MIN_POOL = 5;

export function buildPlaylist(
  library: RotationTrack[],
  recentIds: Set<string>,
  rng: () => number = Math.random,
): string {
  if (library.length === 0) return "";
  const excluded = library.filter((t) => !recentIds.has(t.id));
  const minPool = Math.min(MIN_POOL, library.length - 1);
  const pool = excluded.length < minPool ? library : excluded;
  // Fisher–Yates
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.map((t) => t.url).join("\n") + "\n";
}

async function main() {
  const prisma = new PrismaClient();
  try {
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
        assets: {
          where: { assetType: "audio_stream" },
          take: 1,
          select: { publicUrl: true },
        },
      },
    });

    const library: RotationTrack[] = tracks
      .filter((t) => t.assets[0]?.publicUrl)
      .map((t) => ({ id: t.id, url: t.assets[0].publicUrl }));

    const recent = await prisma.playHistory.findMany({
      where: { stationId: station.id, trackId: { not: null } },
      orderBy: { startedAt: "desc" },
      take: RECENT_WINDOW,
      select: { trackId: true },
    });
    const recentIds = new Set(recent.map((r) => r.trackId!).filter(Boolean));

    const content = buildPlaylist(library, recentIds);

    const tmpPath = join(tmpdir(), `playlist-${process.pid}-${Date.now()}.m3u`);
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, PLAYLIST_PATH);

    const firstTitles = library.slice(0, 3).map((t) => t.id).join(", ");
    console.log(
      `[refresh-rotation] library=${library.length} excluded=${recentIds.size} wrote=${PLAYLIST_PATH} sample=[${firstTitles}]`,
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
