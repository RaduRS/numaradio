// lib/queue-insert.ts

import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Atomically allocate the next priority_request positionIndex AND
 * create the QueueItem inside one Postgres transaction, serialised by
 * a station-scoped advisory xact lock.
 *
 * SAFE FOR CROSS-PROCESS USE: the lock is held in Postgres, so the
 * daemon and Vercel-side writers (Phase 5b listener requests) can call
 * this without racing on positionIndex.
 *
 * Lock releases when the transaction commits.
 */
export async function createQueueItemAtomically(
  prisma: Pick<PrismaClient, "$transaction">,
  sid: string,
  data: Omit<Prisma.QueueItemUncheckedCreateInput, "positionIndex">,
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${sid + ":priority_request"})::bigint)
    `;
    const top = await tx.queueItem.findFirst({
      where: { stationId: sid, priorityBand: "priority_request" },
      orderBy: { positionIndex: "desc" },
      select: { positionIndex: true },
    });
    const position = (top?.positionIndex ?? 0) + 1;
    return tx.queueItem.create({
      data: { ...data, positionIndex: position },
      select: { id: true },
    });
  });
}
