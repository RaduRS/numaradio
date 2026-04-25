// One-shot: walk existing Tracks that have a Suno UUID but are missing
// bpm / musical key / genre, hit suno.com for the server-rendered metadata
// blob, and update the row. Safe to re-run; the WHERE clause filters tracks
// that already got everything.
//
// Usage:
//   npm run backfill:suno              — fill any track with missing fields
//   npm run backfill:suno -- --all     — re-fetch every Suno-sourced track
//                                        (overwrites existing values)

import "../lib/load-env";

import { prisma } from "../lib/db";
import { fetchSunoMetadata } from "../lib/suno";
import type { Prisma } from "@prisma/client";

const SLEEP_MS = 500;
const forceAll = process.argv.includes("--all");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const tracks = await prisma.track.findMany({
    where: {
      sourceReference: { not: null },
      sourceType: "suno_manual",
      ...(forceAll
        ? {}
        : {
            OR: [{ bpm: null }, { genre: null }, { mood: null }],
          }),
    },
    select: {
      id: true,
      title: true,
      artistDisplay: true,
      sourceReference: true,
      bpm: true,
      genre: true,
      mood: true,
      provenanceJson: true,
    },
  });

  if (tracks.length === 0) {
    console.log("Nothing to backfill — every Suno track already has metadata.");
    return;
  }

  console.log(
    `Backfilling ${tracks.length} track(s)${forceAll ? " (force --all)" : ""}`,
  );

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of tracks) {
    const uuid = t.sourceReference!;
    process.stdout.write(`\n── ${t.title} — ${t.artistDisplay} (${uuid})`);

    const result = await fetchSunoMetadata(uuid);
    if (!result.ok) {
      console.log(`\n  ✗ lookup failed: ${result.reason}${result.detail ? ` — ${result.detail}` : ""}`);
      failed += 1;
      await sleep(SLEEP_MS);
      continue;
    }

    const m = result.data;
    // If nothing new to write, skip the update.
    const willUpdate =
      forceAll ||
      (!t.bpm && m.bpm !== undefined) ||
      (!t.genre && (m.genres[0] || m.musicalKey)) ||
      (!t.mood && m.moods[0]);
    if (!willUpdate) {
      console.log("\n  · no new fields from Suno — skipping");
      skipped += 1;
      await sleep(SLEEP_MS);
      continue;
    }

    const existingProvenance = (t.provenanceJson ?? {}) as Record<string, unknown>;
    const data: Prisma.TrackUpdateInput = {
      bpm: forceAll ? (m.bpm ?? t.bpm) : (t.bpm ?? m.bpm),
      genre: forceAll ? (m.genres[0] ?? t.genre) : (t.genre ?? m.genres[0]),
      mood: forceAll ? (m.moods[0] ?? t.mood) : (t.mood ?? m.moods[0]),
      provenanceJson: {
        ...existingProvenance,
        sunoRawTags: m.rawTags,
        sunoModel: m.modelVersion,
        sunoGenres: m.genres,
        sunoMoods: m.moods,
        sunoMusicalKey: m.musicalKey,
        sunoBackfilledAt: new Date().toISOString(),
      },
    };

    await prisma.track.update({ where: { id: t.id }, data });
    console.log(
      `\n  ✓ ${[
        m.bpm && `${m.bpm} BPM`,
        m.musicalKey,
        m.genres[0],
        m.moods[0],
      ]
        .filter(Boolean)
        .join(" · ")}`,
    );
    updated += 1;
    await sleep(SLEEP_MS);
  }

  console.log(
    `\nDone. ${updated} updated · ${skipped} skipped · ${failed} failed`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
