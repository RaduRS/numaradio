// One-shot: hard-delete the most recent rejected submission and verify
// any B2 objects associated with it are gone. Used to clean up test
// data without waiting for the 30-day privacy sweep.
//
// Usage:
//   npx tsx scripts/cleanup-test-submission.ts <submissionId>
//   npx tsx scripts/cleanup-test-submission.ts          # picks the most recent rejected

import "../lib/load-env.ts";
import { prisma } from "../lib/db/index.ts";
import { objectExists, deleteObject } from "../lib/storage/index.ts";

async function main() {
  const arg = process.argv[2];
  let target: { id: string; artistName: string; email: string; audioStorageKey: string | null; artworkStorageKey: string | null; status: string };

  if (arg) {
    const found = await prisma.musicSubmission.findUnique({
      where: { id: arg },
      select: { id: true, artistName: true, email: true, audioStorageKey: true, artworkStorageKey: true, status: true },
    });
    if (!found) throw new Error(`No submission with id ${arg}`);
    target = found;
  } else {
    const found = await prisma.musicSubmission.findFirst({
      where: { status: "rejected" },
      orderBy: { reviewedAt: "desc" },
      select: { id: true, artistName: true, email: true, audioStorageKey: true, artworkStorageKey: true, status: true },
    });
    if (!found) throw new Error("No rejected submissions found.");
    target = found;
  }

  console.log(`Target: ${target.id} (${target.status}) — ${target.artistName} <${target.email}>`);

  for (const key of [target.audioStorageKey, target.artworkStorageKey]) {
    if (!key) continue;
    const exists = await objectExists(key).catch(() => false);
    if (exists) {
      await deleteObject(key);
      console.log(`  · deleted B2 object ${key}`);
    } else {
      console.log(`  · B2 object already gone: ${key}`);
    }
  }

  // Also cover the case where the keys were null but objects still exist
  // (e.g. if upload finished but finalize never updated the row)
  const guesses = [
    `submissions/${target.id}.mp3`,
    `submissions/${target.id}.png`,
    `submissions/${target.id}.jpg`,
  ];
  for (const key of guesses) {
    if (key === target.audioStorageKey || key === target.artworkStorageKey) continue;
    const exists = await objectExists(key).catch(() => false);
    if (exists) {
      await deleteObject(key);
      console.log(`  · deleted orphan B2 object ${key}`);
    }
  }

  await prisma.musicSubmission.delete({ where: { id: target.id } });
  console.log(`  · deleted DB row ${target.id}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
