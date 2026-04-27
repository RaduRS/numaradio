// CLI entry point for the privacy retention sweep.
//
// Logic lives in lib/privacy-sweep.ts. This script just wraps it
// for manual operator use:
//
//   npx tsx scripts/privacy-sweep.ts          # dry run
//   npx tsx scripts/privacy-sweep.ts --apply  # commit deletes
//
// The same logic also runs daily via Vercel Cron at
// app/api/cron/privacy-sweep — operators rarely need this script.

import "../lib/load-env.ts";
import { prisma } from "../lib/db";
import {
  previewSweep,
  runSweep,
  REJECTED_SUBMISSION_DAYS,
  SHOUTOUT_UNAIRED_DAYS,
  SONGREQUEST_DAYS,
} from "../lib/privacy-sweep.ts";

const apply = process.argv.includes("--apply");

async function main() {
  const preview = await previewSweep();
  console.log("═══ Privacy retention sweep ═══");
  console.log(`Shoutouts (unaired, > ${SHOUTOUT_UNAIRED_DAYS}d):     ${preview.shoutoutsToDelete}`);
  console.log(`SongRequests (no track, > ${SONGREQUEST_DAYS}d):      ${preview.songRequestsToDelete}`);
  console.log(`MusicSubmissions (rejected, > ${REJECTED_SUBMISSION_DAYS}d): ${preview.rejectedSubmissionsToDelete}`);
  console.log(apply ? "\n→ Applying deletes…" : "\n(dry run — pass --apply to commit)");

  if (!apply) {
    await prisma.$disconnect();
    return;
  }

  const counts = await runSweep();
  console.log(
    `\nDeleted: shoutouts=${counts.shoutoutsDeleted}, songRequests=${counts.songRequestsDeleted}, musicSubmissions=${counts.rejectedSubmissionsDeleted}`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
