// One-time (and safely re-runnable) cleanup: delete every shoutout-shaped
// Track and its B2 audio left behind before the shoutout-ended callback
// started doing this automatically.
//
// A shoutout Track is identified by:
//   sourceType = 'external_import' AND airingPolicy = 'request_only'
//
// Defensive — refuses to touch a track that doesn't match BOTH. The
// moderation-audit `Shoutout` rows are NOT affected; only the generated
// audio + Track bookkeeping.
//
// Run: npx tsx scripts/purge-orphan-shoutouts.ts
// Options: --dry-run   count only, don't delete

import "../lib/load-env";
import { prisma } from "../lib/db";
import { deleteAiredShoutout } from "../lib/delete-aired-shoutout";

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const candidates = await prisma.track.findMany({
    where: {
      sourceType: "external_import",
      airingPolicy: "request_only",
    },
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `Found ${candidates.length} shoutout-shaped Track rows to purge.`,
  );
  if (DRY_RUN) {
    for (const t of candidates.slice(0, 5)) {
      console.log(`  - ${t.id}  ${t.createdAt.toISOString()}  ${t.title}`);
    }
    if (candidates.length > 5) {
      console.log(`  …and ${candidates.length - 5} more`);
    }
    console.log("(dry run — no deletes performed)");
    return;
  }

  let deleted = 0;
  let b2Files = 0;
  let b2Failures = 0;
  let skipped = 0;
  for (const t of candidates) {
    try {
      const result = await deleteAiredShoutout(t.id);
      if (result.deleted) {
        deleted++;
        b2Files += result.assetsDeletedFromB2;
        b2Failures += result.b2Failures;
      } else {
        skipped++;
        console.warn(`  skipped ${t.id}: ${result.reason ?? "no reason"}`);
      }
    } catch (e) {
      skipped++;
      console.warn(
        `  failed ${t.id}: ${e instanceof Error ? e.message : "unknown"}`,
      );
    }
  }

  console.log(
    `\nPurged ${deleted} tracks · ${b2Files} B2 files deleted · ` +
      `${b2Failures} B2 failures · ${skipped} skipped.`,
  );
}

void main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
