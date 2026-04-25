// One-shot: flip already-aired listener-generated songs (sourceType =
// 'minimax_request') from 'library' to 'request_only'. Under the old
// track-started behavior these were promoted into rotation after the first
// air; the new behavior keeps them out of rotation unless the operator
// manually pushes them from the dashboard library page. This backfill makes
// the previously-aired submissions match the new default.
//
// Idempotent — only flips rows currently in 'library'.

import "../lib/load-env";
import { prisma } from "../lib/db";

async function main(): Promise<void> {
  const result = await prisma.track.updateMany({
    where: {
      sourceType: "minimax_request",
      airingPolicy: "library",
    },
    data: { airingPolicy: "request_only" },
  });
  console.log(`Demoted ${result.count} listener-generated songs to request_only.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
