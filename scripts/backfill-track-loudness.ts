#!/usr/bin/env tsx
// Backfill loudness measurements + normalised audio for every Track
// row that doesn't have loudnessLufs yet. Idempotent — re-run anytime;
// already-normalised rows are skipped via the WHERE clause.
//
// Usage:
//   npx tsx scripts/backfill-track-loudness.ts             # dry-run (default)
//   npx tsx scripts/backfill-track-loudness.ts --apply     # actually run
//   npx tsx scripts/backfill-track-loudness.ts --apply --limit 5
//
// Recommended invocation on Orion (off-peak, defer to broadcast):
//   nice -n 19 npx tsx scripts/backfill-track-loudness.ts --apply
//
// Estimated cost: ~5s of CPU per track. ~130 tracks ≈ 11 minutes.

import "../lib/load-env.ts";
import { PrismaClient, type Prisma } from "@prisma/client";
import { loudnormaliseExistingTrack } from "../lib/loudnormalise-existing-track.ts";

interface Args {
  apply: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--dry-run") args.apply = false;
    else if (a === "--limit") {
      const next = argv[i + 1];
      const n = next ? parseInt(next, 10) : NaN;
      if (Number.isFinite(n) && n > 0) { args.limit = n; i++; }
      else { console.error(`--limit requires a positive integer, got: ${next}`); process.exit(2); }
    } else {
      console.error(`Unknown arg: ${a}`);
      console.error("Usage: tsx scripts/backfill-track-loudness.ts [--apply] [--limit N]");
      process.exit(2);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  // Pre-filter the same way the daemon poller does — exclude voice.
  const where: Prisma.TrackWhereInput = {
    loudnessLufs: null,
    NOT: {
      AND: [
        { sourceType: "external_import" },
        { airingPolicy: "request_only" },
        { title: { startsWith: "Shoutout" } },
      ],
    },
  };

  const candidates = await prisma.track.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, sourceType: true },
    ...(args.limit ? { take: args.limit } : {}),
  });

  console.log(`[backfill] ${candidates.length} candidate track(s) — apply=${args.apply}`);
  if (!args.apply) {
    for (const t of candidates) {
      console.log(`  would process: ${t.id} (${t.sourceType}) "${t.title}"`);
    }
    console.log(`[backfill] dry-run only. Re-run with --apply to actually normalise.`);
    await prisma.$disconnect();
    return;
  }

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (const t of candidates) {
    try {
      const result = await loudnormaliseExistingTrack(prisma, t.id);
      if ("ok" in result) {
        processed++;
        const m = result.measurement;
        const delta = m.outputI - m.inputI;
        const sign = delta >= 0 ? "+" : "";
        console.log(
          `[backfill] ${t.id} "${t.title}" ${m.inputI.toFixed(1)} → ${m.outputI.toFixed(1)} LUFS (delta ${sign}${delta.toFixed(1)})`,
        );
      } else if ("skipped" in result) {
        skipped++;
        console.log(`[backfill skip:${result.skipped}] ${t.id}`);
      } else {
        failed++;
        console.warn(`[backfill fail] ${t.id} "${t.title}": ${result.error}`);
      }
    } catch (err) {
      failed++;
      console.warn(`[backfill throw] ${t.id} "${t.title}": ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[backfill] done in ${elapsedSec}s — processed=${processed} skipped=${skipped} failed=${failed}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(`[backfill] fatal: ${String(err)}`);
  process.exit(1);
});
