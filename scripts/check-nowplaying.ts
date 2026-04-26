import "../lib/load-env";
import { prisma } from "../lib/db";

async function main() {
  const station = await prisma.station.findUniqueOrThrow({
    where: { slug: process.env.STATION_SLUG ?? "numaradio" },
    select: { id: true },
  });

  const np = await prisma.nowPlaying.findUnique({
    where: { stationId: station.id },
  });
  console.log("NowPlaying:");
  console.log(JSON.stringify(np, null, 2));
  if (np?.currentTrackId) {
    const t = await prisma.track.findUnique({
      where: { id: np.currentTrackId },
      select: { id: true, title: true, artistDisplay: true, durationSeconds: true },
    });
    console.log("Track:", t);
  }

  const recent = await prisma.playHistory.findMany({
    where: { stationId: station.id, segmentType: "audio_track" },
    orderBy: { startedAt: "desc" },
    take: 6,
    select: { startedAt: true, endedAt: true, titleSnapshot: true, completedNormally: true },
  });
  console.log("\nLast 6 PlayHistory:");
  for (const r of recent) {
    console.log(`  ${r.startedAt.toISOString()}  end=${r.endedAt?.toISOString() ?? "OPEN"}  ${r.titleSnapshot ?? "(no title)"}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
