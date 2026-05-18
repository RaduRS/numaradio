// One-shot cleanup for priority_request QueueItems stuck in `staged`
// status after their track has already aired. The reconciler's old
// 5-min recency window left these in place, so it kept re-pushing them
// to Liquidsoap (No Rush / EUTHANIZE loop incident on 2026-05-18).
//
// The fix in workers/queue-daemon/reconciler.ts now checks since
// createdAt, so going forward this can't happen. Run this once to
// catch up rows that accumulated before the fix shipped.
//
// Usage:
//   export $(grep '^DATABASE_URL=' .env.local | xargs)
//   npx tsx scripts/cleanup-stuck-staged.ts

import "../lib/load-env.ts";
import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const stuck = await prisma.queueItem.findMany({
      where: {
        queueStatus: "staged",
        priorityBand: "priority_request",
      },
      select: { id: true, trackId: true, createdAt: true },
    });
    console.log(`Found ${stuck.length} staged priority_request items`);

    let cleaned = 0;
    let kept = 0;
    for (const item of stuck) {
      if (!item.trackId) continue;
      const played = await prisma.playHistory.findFirst({
        where: {
          trackId: item.trackId,
          startedAt: { gte: item.createdAt },
          segmentType: "audio_track",
        },
        select: { id: true, startedAt: true },
      });
      if (played) {
        await prisma.queueItem.update({
          where: { id: item.id },
          data: { queueStatus: "completed" },
        });
        console.log(
          `cleaned ${item.id} trackId=${item.trackId} createdAt=${item.createdAt.toISOString()} aired=${played.startedAt.toISOString()}`,
        );
        cleaned++;
      } else {
        kept++;
      }
    }
    console.log(`cleaned=${cleaned} kept=${kept}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
