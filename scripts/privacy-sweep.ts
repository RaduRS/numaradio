// Retention sweep — deletes data past its disclosed retention window.
//
// Run on demand or on a cron (suggested: daily). Reads-then-writes,
// dry-run by default; pass --apply to commit. Prints a summary.
//
// Windows (must match what the privacy page promises):
//   * Shoutout rows that never aired (held / blocked / failed) → 90 days.
//     Aired shoutouts are part of the broadcast catalog — those keep
//     their audit row indefinitely (no PII beyond the optional
//     requesterName).
//   * SongRequest rows that never resulted in a played track →
//     90 days. Successful requests stay (the resulting Track holds
//     the long-lived link).
//   * MusicSubmission rows in 'rejected' state → 30 days. After that
//     the row + its B2 originals (already deleted at reject time)
//     are gone for good.
//
// Permanent + approved + withdrawn submissions are NOT swept here —
// those have their own lifecycle (operator action via dashboard).

import "../lib/load-env.ts";
import { prisma } from "../lib/db";

const apply = process.argv.includes("--apply");

const SHOUTOUT_UNAIRED_DAYS = 90;
const SONGREQUEST_DAYS = 90;
const REJECTED_SUBMISSION_DAYS = 30;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function main() {
  const shoutoutCutoff = daysAgo(SHOUTOUT_UNAIRED_DAYS);
  const songRequestCutoff = daysAgo(SONGREQUEST_DAYS);
  const submissionCutoff = daysAgo(REJECTED_SUBMISSION_DAYS);

  // Old unaired shoutouts: anything that didn't deliver to air, plus
  // anything still in non-allowed moderation state.
  const shoutoutWhere = {
    createdAt: { lt: shoutoutCutoff },
    OR: [
      { deliveryStatus: { not: "aired" } },
      { moderationStatus: { in: ["blocked" as const, "held" as const] } },
    ],
  };
  const shoutoutCount = await prisma.shoutout.count({ where: shoutoutWhere });

  // Old song requests that never aired (status != 'played' or whatever
  // terminal-success state your app uses; we treat anything that's
  // NOT 'played' AND has no linked trackId as not-aired).
  const songRequestWhere = {
    createdAt: { lt: songRequestCutoff },
    AND: [
      { trackId: null },
      { status: { notIn: ["played", "queued", "generating"] } },
    ],
  };
  const songRequestCount = await prisma.songRequest.count({ where: songRequestWhere });

  // Old rejected submissions
  const submissionWhere = {
    status: "rejected" as const,
    reviewedAt: { lt: submissionCutoff },
  };
  const submissionCount = await prisma.musicSubmission.count({ where: submissionWhere });

  console.log("═══ Privacy retention sweep ═══");
  console.log(`Shoutouts (unaired, > ${SHOUTOUT_UNAIRED_DAYS}d):     ${shoutoutCount}`);
  console.log(`SongRequests (no track, > ${SONGREQUEST_DAYS}d):      ${songRequestCount}`);
  console.log(`MusicSubmissions (rejected, > ${REJECTED_SUBMISSION_DAYS}d): ${submissionCount}`);
  console.log(apply ? "\n→ Applying deletes…" : "\n(dry run — pass --apply to commit)");

  if (!apply) {
    await prisma.$disconnect();
    return;
  }

  const r1 = await prisma.shoutout.deleteMany({ where: shoutoutWhere });
  const r2 = await prisma.songRequest.deleteMany({ where: songRequestWhere });
  const r3 = await prisma.musicSubmission.deleteMany({ where: submissionWhere });
  console.log(
    `\nDeleted: shoutouts=${r1.count}, songRequests=${r2.count}, musicSubmissions=${r3.count}`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
