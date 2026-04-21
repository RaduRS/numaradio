import { PrismaClient } from "@prisma/client";

export const STALE_MINUTES = 10;

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
