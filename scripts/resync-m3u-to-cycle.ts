/**
 * Rewrite /etc/numa/playlist.m3u to contain only the unplayed tail of
 * the current cycle, preserving cycleOrder. Run before liquidsoap
 * starts (systemd ExecStartPre) so its internal position counter,
 * which resets to 0 on every restart, lines up with where the
 * dashboard's Up Next thinks we are.
 *
 * No-ops cleanly when cycleOrder isn't present (fresh install), when
 * nothing has played yet, or when the cycle is exhausted — runRefresh
 * will rebuild on its next tick.
 */
import "../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, renameSync } from "fs";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { join } from "path";

const CYCLE_PATH = process.env.NUMA_CYCLE_ORDER_PATH ?? "/etc/numa/cycle-order.json";
const PLAYLIST_PATH = process.env.NUMA_PLAYLIST_PATH ?? "/etc/numa/playlist.m3u";
const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

async function main() {
  let cycle: { trackIds: string[]; createdAt: number };
  try {
    cycle = JSON.parse(readFileSync(CYCLE_PATH, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("[resync-m3u] no cycle-order.json yet — skipping");
      return;
    }
    throw err;
  }
  if (!Array.isArray(cycle.trackIds) || cycle.trackIds.length === 0) {
    console.log("[resync-m3u] empty cycle — skipping");
    return;
  }

  const prisma = new PrismaClient();
  try {
    const station = await prisma.station.findUniqueOrThrow({ where: { slug: STATION_SLUG }, select: { id: true } });
    const [tracks, played, np] = await Promise.all([
      prisma.track.findMany({
        where: { id: { in: cycle.trackIds }, stationId: station.id },
        select: { id: true, assets: { where: { assetType: "audio_stream" }, take: 1, select: { publicUrl: true } } },
      }),
      prisma.playHistory.findMany({
        where: { stationId: station.id, trackId: { in: cycle.trackIds }, startedAt: { gte: new Date(cycle.createdAt) } },
        select: { trackId: true },
      }),
      prisma.nowPlaying.findUnique({ where: { stationId: station.id }, select: { currentTrackId: true } }),
    ]);

    const urlById = new Map(tracks.map((t) => [t.id, t.assets[0]?.publicUrl ?? null]));
    const playedSet = new Set(played.map((p) => p.trackId).filter((x): x is string => !!x));
    const npId = np?.currentTrackId ?? null;

    const upcoming = cycle.trackIds.filter(
      (id) => !playedSet.has(id) && id !== npId && urlById.get(id),
    );
    if (upcoming.length === 0) {
      console.log(`[resync-m3u] cycle exhausted (played=${playedSet.size}/${cycle.trackIds.length}) — leaving m3u alone, runRefresh will wrap`);
      return;
    }

    const content = upcoming.map((id) => urlById.get(id)!).join("\n") + "\n";
    const tmp = join(tmpdir(), `playlist-resync-${process.pid}-${randomBytes(4).toString("hex")}.m3u`);
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, PLAYLIST_PATH);
    console.log(`[resync-m3u] played=${playedSet.size}/${cycle.trackIds.length} nowPlaying=${npId?.slice(0, 12) ?? "(none)"} wrote ${upcoming.length} entries`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[resync-m3u] failed:", err);
  process.exit(1);
});
