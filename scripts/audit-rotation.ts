import "../lib/load-env";
import { prisma } from "../lib/db";

// Audit script — quantifies whether the rotation is actually random.
// Reads today's PlayHistory (UTC) and reports:
//   - total music plays vs library size (expected coverage)
//   - per-track play count + chi-square goodness-of-fit vs uniform
//   - back-to-back repeats (should be 0; refresher excludes recent)
//   - shortest gap (in plays) between two airings of the same track
//   - top 10 most-aired tracks today
async function main() {
  const station = await prisma.station.findUniqueOrThrow({
    where: { slug: process.env.STATION_SLUG ?? "numaradio" },
    select: { id: true },
  });

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const librarySize = await prisma.track.count({
    where: { stationId: station.id, trackStatus: "ready", airingPolicy: "library" },
  });

  const rows = await prisma.playHistory.findMany({
    where: {
      stationId: station.id,
      startedAt: { gte: startOfDay },
      trackId: { not: null },
      segmentType: "audio_track",
    },
    orderBy: { startedAt: "asc" },
    select: {
      trackId: true,
      titleSnapshot: true,
      startedAt: true,
      track: { select: { airingPolicy: true } },
    },
  });

  const libraryRows = rows.filter((r) => r.track?.airingPolicy === "library");

  console.log(`═══ ROTATION AUDIT — ${startOfDay.toISOString().slice(0, 10)} (UTC) ═══`);
  console.log(`Library size (ready + airingPolicy=library): ${librarySize}`);
  console.log(`PlayHistory rows today (segmentType=audio_track, trackId set): ${rows.length}`);
  console.log(`  ↳ where track is library-policy: ${libraryRows.length}`);
  console.log(`  ↳ other (request/shoutout aired as music): ${rows.length - libraryRows.length}`);

  if (libraryRows.length === 0) {
    console.log("\nNo library plays yet today — try again later.");
    await prisma.$disconnect();
    return;
  }

  // Coverage
  const counts = new Map<string, { count: number; title: string }>();
  for (const r of libraryRows) {
    const key = r.trackId!;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { count: 1, title: r.titleSnapshot ?? "(untitled)" });
  }
  console.log(`\nUnique library tracks aired: ${counts.size} / ${librarySize} (${((counts.size / librarySize) * 100).toFixed(1)}%)`);

  // Back-to-back repeats
  let btb = 0;
  for (let i = 1; i < libraryRows.length; i++) {
    if (libraryRows[i].trackId === libraryRows[i - 1].trackId) btb++;
  }
  console.log(`Back-to-back same-track repeats: ${btb} (should be 0)`);

  // Shortest gap (in #plays) between two airings of the same track
  const lastSeen = new Map<string, number>();
  let minGap = Infinity;
  let minGapTitle = "";
  let minGapAt: Date | null = null;
  const gapHistogram = new Map<number, number>(); // gap -> count
  for (let i = 0; i < libraryRows.length; i++) {
    const id = libraryRows[i].trackId!;
    const prev = lastSeen.get(id);
    if (prev !== undefined) {
      const gap = i - prev;
      gapHistogram.set(gap, (gapHistogram.get(gap) ?? 0) + 1);
      if (gap < minGap) {
        minGap = gap;
        minGapTitle = libraryRows[i].titleSnapshot ?? "(untitled)";
        minGapAt = libraryRows[i].startedAt;
      }
    }
    lastSeen.set(id, i);
  }
  console.log(`\nShortest gap between same-track airings: ${minGap === Infinity ? "n/a (no track aired twice)" : `${minGap} plays`}`);
  if (minGap !== Infinity) {
    console.log(`  ↳ "${minGapTitle}" at ${minGapAt?.toISOString()}`);
  }

  // Distribution of gaps (only for repeated tracks)
  if (gapHistogram.size > 0) {
    console.log("\nGap distribution (gap=N means same track returned N plays later):");
    const sortedGaps = [...gapHistogram.entries()].sort((a, b) => a[0] - b[0]);
    for (const [gap, c] of sortedGaps.slice(0, 15)) {
      console.log(`  gap=${gap.toString().padStart(3)} : ${"█".repeat(Math.min(40, c))} ${c}`);
    }
  }

  // Chi-square goodness-of-fit test against uniform-over-library
  // H0: each library track is equally likely. Expected count per track = N/L.
  // Only meaningful if N >= ~5 * librarySize (rule of thumb).
  const N = libraryRows.length;
  const L = librarySize;
  const expected = N / L;
  let chi2 = 0;
  for (const { count } of counts.values()) chi2 += ((count - expected) ** 2) / expected;
  // Tracks that haven't aired: count = 0 → contribution = expected
  const untouched = L - counts.size;
  chi2 += untouched * expected;
  const dof = L - 1;
  console.log(`\nχ² goodness-of-fit vs uniform:`);
  console.log(`  N=${N} plays, L=${L} tracks, expected count per track=${expected.toFixed(2)}`);
  console.log(`  χ² = ${chi2.toFixed(2)}, dof = ${dof}`);
  if (N < 5 * L) {
    console.log(`  ⚠ N < 5L — sample too small for χ² to be reliable yet.`);
  } else {
    // Critical values for α=0.05 (Wilson–Hilferty approximation)
    const critical = dof * Math.pow(1 - 2 / (9 * dof) + 1.6449 * Math.sqrt(2 / (9 * dof)), 3);
    console.log(`  α=0.05 critical: ${critical.toFixed(2)}`);
    console.log(`  ${chi2 < critical ? "✓ Cannot reject uniform" : "✗ Reject uniform — distribution skewed"}`);
  }

  // Top 10
  console.log("\nTop 10 most-aired today:");
  const top = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);
  for (const [, v] of top) {
    console.log(`  ${v.count.toString().padStart(3)}× ${v.title}`);
  }

  // Anything in the "never aired today" bucket worth surfacing? Just count.
  console.log(`\nNever aired today: ${untouched} / ${L} library tracks`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
