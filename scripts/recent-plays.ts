import "../lib/load-env";
import { prisma } from "../lib/db";

// One-shot diagnostic: list the last N minutes of PlayHistory rows so we
// can spot back-to-back repeats. Read-only.
// Usage: npx tsx scripts/recent-plays.ts [minutes]   (default: 30)
const MINUTES = Number(process.argv[2] ?? 30);

async function main() {
  const station = await prisma.station.findUniqueOrThrow({
    where: { slug: process.env.STATION_SLUG ?? "numaradio" },
    select: { id: true },
  });

  const since = new Date(Date.now() - MINUTES * 60_000);

  const plays = await prisma.playHistory.findMany({
    where: { stationId: station.id, startedAt: { gte: since } },
    orderBy: { startedAt: "asc" },
    select: {
      trackId: true,
      titleSnapshot: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
      completedNormally: true,
      segmentType: true,
      track: { select: { airingPolicy: true, artistDisplay: true } },
    },
  });

  console.log(`═══ Last ${MINUTES} min of PlayHistory (${plays.length} rows) ═══`);
  let prevTrackId: string | null = null;
  for (const r of plays) {
    const t = r.startedAt.toISOString().slice(11, 19);
    const dur = r.durationSeconds != null ? `${r.durationSeconds}s` : "?";
    const policy = r.track?.airingPolicy ?? "—";
    const artist = r.track?.artistDisplay ?? "?";
    const flag = prevTrackId && r.trackId === prevTrackId ? "  ⚠ SAME-AS-PREV" : "";
    const seg = r.segmentType.padEnd(11);
    const closed = r.endedAt ? "closed" : "OPEN  ";
    console.log(
      `${t}  ${seg}  ${closed}  ${dur.padStart(5)}  policy=${policy.padEnd(18)} ` +
        `${(r.titleSnapshot ?? "(no title)").slice(0, 40).padEnd(40)} | ${artist}${flag}`,
    );
    if (r.segmentType === "audio_track") prevTrackId = r.trackId ?? null;
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
