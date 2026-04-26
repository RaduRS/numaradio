// scripts/backfill-track-durations.ts
//
// Re-probes every Track's audio asset on B2 with ffprobe and updates
// Track.durationSeconds + the matching TrackAsset.durationSeconds. Uses
// the same probe library (lib/probe-duration.ts) that ingest-seed +
// song-worker now use, so existing rows match new ingests.
//
// USAGE:
//   npx tsx scripts/backfill-track-durations.ts            # dry-run
//   npx tsx scripts/backfill-track-durations.ts --apply    # writes
//
// Dry-run prints what WOULD change without touching the DB. Run that
// first, eyeball a few rows, then re-run with --apply.
//
// Why ffprobe over the URL: ffprobe natively understands HTTP, fetches
// only the byte ranges it needs to compute duration (typically the
// first few KB + the last few KB), and is frame-accurate. No download,
// no temp files.
//
// Safe to re-run. Idempotent — Tracks whose probed duration already
// matches DB are skipped.

import "../lib/load-env";
import { prisma } from "../lib/db";
import { probeDurationSeconds } from "../lib/probe-duration.ts";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const APPLY = process.argv.includes("--apply");
const CONCURRENCY = 6; // mild parallelism — ffprobe spawns + B2 connections

interface Row {
  id: string;
  title: string;
  artistDisplay: string | null;
  durationSeconds: number | null;
  assetId: string;
  publicUrl: string;
  assetDuration: number | null;
}

async function main() {
  const station = await prisma.station.findUniqueOrThrow({
    where: { slug: STATION_SLUG },
    select: { id: true },
  });

  // Pull every Track that has an audio_stream asset. We probe the
  // asset's publicUrl directly via ffprobe (HTTP-aware).
  const rows = await prisma.track.findMany({
    where: {
      stationId: station.id,
      assets: { some: { assetType: "audio_stream" } },
    },
    select: {
      id: true,
      title: true,
      artistDisplay: true,
      durationSeconds: true,
      assets: {
        where: { assetType: "audio_stream" },
        take: 1,
        select: { id: true, publicUrl: true, durationSeconds: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const candidates: Row[] = rows
    .filter((r) => r.assets[0]?.publicUrl)
    .map((r) => ({
      id: r.id,
      title: r.title,
      artistDisplay: r.artistDisplay,
      durationSeconds: r.durationSeconds,
      assetId: r.assets[0]!.id,
      publicUrl: r.assets[0]!.publicUrl,
      assetDuration: r.assets[0]!.durationSeconds ?? null,
    }));

  console.log(`\nNuma Radio — backfill track durations`);
  console.log(`Mode: ${APPLY ? "APPLY (writes to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Tracks with audio_stream asset: ${candidates.length}\n`);

  const stats = {
    probed: 0,
    skipped_match: 0,
    updated: 0,
    failed_probe: 0,
    diff_lt_1s: 0,
  };

  // Simple worker-pool over the candidate list.
  const queue = [...candidates];
  async function worker(id: number) {
    while (queue.length > 0) {
      const r = queue.shift();
      if (!r) return;
      const probed = await probeDurationSeconds(r.publicUrl, { timeoutMs: 20_000 });
      stats.probed += 1;
      if (!probed) {
        stats.failed_probe += 1;
        console.warn(`  [w${id}] PROBE_FAILED  ${r.id} "${r.title.slice(0, 40)}"`);
        continue;
      }
      const newDur = Math.round(probed);
      const oldDur = r.durationSeconds ?? null;
      const diff = oldDur === null ? Infinity : Math.abs(newDur - oldDur);
      if (diff < 1) {
        stats.skipped_match += 1;
        continue;
      }
      if (diff < 1) stats.diff_lt_1s += 1;
      stats.updated += 1;
      console.log(
        `  [w${id}] ${oldDur === null ? "NULL" : `${oldDur}s`.padStart(5)} → ${`${newDur}s`.padEnd(5)} (Δ${oldDur === null ? "?" : diff}) ${r.title.slice(0, 50)}`,
      );
      if (APPLY) {
        await prisma.$transaction([
          prisma.track.update({
            where: { id: r.id },
            data: { durationSeconds: newDur },
          }),
          prisma.trackAsset.update({
            where: { id: r.assetId },
            data: { durationSeconds: newDur },
          }),
        ]);
      }
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)),
  );

  console.log("\n─── Summary ──────────────────────────────────────");
  console.log(`Probed:           ${stats.probed}`);
  console.log(`Already correct:  ${stats.skipped_match}`);
  console.log(`Updated:          ${stats.updated}${APPLY ? "" : " (would update — re-run with --apply)"}`);
  console.log(`Probe failed:     ${stats.failed_probe}`);
  console.log("");
  if (!APPLY && stats.updated > 0) {
    console.log("Re-run with --apply to write these changes:\n  npx tsx scripts/backfill-track-durations.ts --apply\n");
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("backfill failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
