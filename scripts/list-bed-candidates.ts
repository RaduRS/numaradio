import "../lib/load-env";
import { prisma } from "../lib/db";

// One-shot helper: lists library tracks with their B2 storageKey and
// duration so we can pick which ones to use as music beds in
// numaradio-videos. Filters out anything already in the bed pool.
async function main() {
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
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      durationSeconds: true,
      assets: {
        where: { assetType: "audio_stream" },
        take: 1,
        select: { storageKey: true },
      },
    },
  });

  for (const t of tracks) {
    const key = t.assets[0]?.storageKey ?? "(no asset)";
    const dur = t.durationSeconds ?? 0;
    console.log(`${(t.title ?? "(untitled)").padEnd(28)} ${String(dur).padStart(3)}s  ${key}`);
  }
  console.log(`\n${tracks.length} tracks total.`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
