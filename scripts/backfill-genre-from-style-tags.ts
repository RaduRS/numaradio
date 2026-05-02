// Backfill Track.genre from provenanceJson.styleTags[0] for any track
// that has style tags recorded but no top-level genre. The dashboard's
// /library Genre column reads Track.genre, but the suno ingest path
// historically stored style tags only inside provenanceJson, leaving
// the column null for ~78% of the catalogue.
//
// Dry-run by default. Pass --apply to write.
//
//   npx tsx scripts/backfill-genre-from-style-tags.ts          # report only
//   npx tsx scripts/backfill-genre-from-style-tags.ts --apply  # write

import "../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

type Provenance = { styleTags?: unknown };

function firstStyleTag(prov: unknown): string | null {
  if (!prov || typeof prov !== "object") return null;
  const tags = (prov as Provenance).styleTags;
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    if (typeof t === "string" && t.trim().length > 0) return t.trim();
  }
  return null;
}

async function main() {
  const candidates = await prisma.track.findMany({
    where: { genre: null },
    select: { id: true, title: true, provenanceJson: true },
  });

  let willUpdate = 0;
  const updates: Array<{ id: string; title: string; genre: string }> = [];
  for (const t of candidates) {
    const tag = firstStyleTag(t.provenanceJson);
    if (!tag) continue;
    willUpdate++;
    updates.push({ id: t.id, title: t.title, genre: tag });
  }

  console.log(`Tracks scanned: ${candidates.length}`);
  console.log(`Tracks that would gain a genre: ${willUpdate}`);
  if (updates.length > 0) {
    console.log("\nFirst 12:");
    console.table(updates.slice(0, 12).map(u => ({ id: u.id.slice(0, 8), title: u.title, genre: u.genre })));
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
