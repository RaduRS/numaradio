/**
 * One-off: walk every Track row and normalize the title (multi-word ALL-CAPS
 * → Title Case). Single-word all-caps titles like "DJ" or "GLOW" are left
 * alone so intentional acronyms / one-word stylistic titles survive.
 *
 * Run: npx tsx --env-file=.env.local scripts/backfill-titles.ts
 */
import { PrismaClient } from "@prisma/client";

function normalizeTitle(t: string): string {
  if (!t) return t;
  const trimmed = t.trim();
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  const hasSpace = /\s/.test(trimmed);
  if (hasSpace && letters.length >= 2 && letters === letters.toUpperCase()) {
    return trimmed.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return trimmed;
}

async function main() {
  const prisma = new PrismaClient();
  const tracks = await prisma.track.findMany({ select: { id: true, title: true } });
  console.log(`Scanning ${tracks.length} tracks…`);

  let changed = 0;
  for (const t of tracks) {
    const fixed = normalizeTitle(t.title);
    if (fixed === t.title) continue;
    console.log(`  ${t.id.slice(0, 8)}  "${t.title}" → "${fixed}"`);
    await prisma.track.update({ where: { id: t.id }, data: { title: fixed } });
    changed++;
  }

  console.log(`\nDone. updated=${changed} unchanged=${tracks.length - changed}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
