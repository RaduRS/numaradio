// Backfill Track.genre for any track whose column is null. Walks a
// chain of progressively-loose sources until something hits:
//
//   1. provenanceJson.styleTags[0]    — modern suno_manual ingests
//   2. provenanceJson.sunoGenres[0]   — older suno_manual format
//   3. provenanceJson.sunoMoods[0]    — fallback when no genre tag
//   4. Track.mood                     — older imports without provenance
//   5. SongRequest.prompt → deriveGenreFromText  — listener-generated
//      MiniMax songs, mined from the original prompt
//   6. Per sourceType default         — "Voice" for shoutouts,
//      "Listener Pick" for minimax, "Untagged" otherwise
//
// Dry-run by default. Pass --apply to write.

import "../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";
import { deriveGenreFromText } from "../lib/derive-genre.ts";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

type Provenance = {
  styleTags?: unknown;
  sunoGenres?: unknown;
  sunoMoods?: unknown;
  sunoRawTags?: unknown;
};

function firstNonEmptyTag(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().split(",")[0].trim();
  }
  return null;
}

function defaultGenreFor(sourceType: string | null, airingPolicy: string): string {
  if (sourceType === "external_import" && airingPolicy === "request_only") return "Voice";
  if (sourceType === "minimax_request") return "Listener Pick";
  return "Untagged";
}

async function main() {
  const candidates = await prisma.track.findMany({
    where: { genre: null },
    select: {
      id: true, title: true, mood: true,
      sourceType: true, airingPolicy: true,
      provenanceJson: true,
      songRequests: { select: { prompt: true }, take: 1 },
    },
  });

  const updates: Array<{ id: string; title: string; genre: string; via: string }> = [];
  for (const t of candidates) {
    const prov = (t.provenanceJson ?? null) as Provenance | null;

    const fromStyleTags = prov ? firstNonEmptyTag(prov.styleTags) : null;
    if (fromStyleTags) { updates.push({ id: t.id, title: t.title, genre: fromStyleTags, via: "styleTags" }); continue; }

    const fromSunoGenres = prov ? firstNonEmptyTag(prov.sunoGenres) : null;
    if (fromSunoGenres) { updates.push({ id: t.id, title: t.title, genre: fromSunoGenres, via: "sunoGenres" }); continue; }

    const fromSunoMoods = prov ? firstNonEmptyTag(prov.sunoMoods) : null;
    if (fromSunoMoods) { updates.push({ id: t.id, title: t.title, genre: fromSunoMoods, via: "sunoMoods" }); continue; }

    const fromMood = t.mood && t.mood.trim().length > 0 ? t.mood.trim() : null;
    if (fromMood) { updates.push({ id: t.id, title: t.title, genre: fromMood, via: "mood" }); continue; }

    const prompt = t.songRequests[0]?.prompt;
    const fromPrompt = deriveGenreFromText(prompt);
    if (fromPrompt) { updates.push({ id: t.id, title: t.title, genre: fromPrompt, via: "prompt" }); continue; }

    updates.push({ id: t.id, title: t.title, genre: defaultGenreFor(t.sourceType, t.airingPolicy), via: "default" });
  }

  console.log(`Tracks scanned: ${candidates.length}`);
  console.log(`Tracks that would gain a genre: ${updates.length}`);
  const byVia = updates.reduce<Record<string, number>>((acc, u) => { acc[u.via] = (acc[u.via] ?? 0) + 1; return acc; }, {});
  console.log("By source:", byVia);
  if (updates.length > 0) {
    console.log("\nFirst 15:");
    console.table(updates.slice(0, 15).map(u => ({ id: u.id.slice(0, 8), title: u.title, genre: u.genre, via: u.via })));
  }

  if (!apply) {
    console.log("\nDry-run. Pass --apply to write.");
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const u of updates) {
    await prisma.track.update({ where: { id: u.id }, data: { genre: u.genre } });
    written++;
  }
  console.log(`\nWrote genre on ${written} track(s).`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
