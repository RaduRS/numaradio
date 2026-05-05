import { PrismaClient } from "@prisma/client";

// 20 min gives real headroom over the pipeline's 6-min MiniMax poll
// timeout + audio download + B2 uploads + DB writes. The previous 10-
// min threshold could re-claim an in-flight job during slow MiniMax
// runs, causing a double-upload and a UUID-collision crash on
// Track.create.
export const STALE_MINUTES = 20;

export function buildSweepSql(): string {
  return `
    UPDATE "SongRequest"
       SET "status" = 'queued',
           "startedAt" = NULL
     WHERE "status" = 'processing'
       AND "startedAt" < NOW() - INTERVAL '${STALE_MINUTES} minutes'
  `;
}

export async function sweepStaleJobs(prisma: PrismaClient): Promise<number> {
  const result = (await prisma.$executeRawUnsafe(buildSweepSql())) as unknown;
  return typeof result === "number" ? result : 0;
}
