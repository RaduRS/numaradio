import { PrismaClient } from "@prisma/client";

export interface ClaimedJob {
  id: string;
  prompt: string;
  artistName: string;
  isInstrumental: boolean;
}

export function buildClaimSql(): string {
  return `
    UPDATE "SongRequest"
       SET "status" = 'processing',
           "startedAt" = NOW()
     WHERE "id" = (
       SELECT "id"
         FROM "SongRequest"
        WHERE "status" = 'queued'
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING "id", "prompt", "artistName", "isInstrumental"
  `;
}

export async function claimNextJob(prisma: PrismaClient): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRawUnsafe<ClaimedJob[]>(buildClaimSql());
  return rows.length > 0 ? rows[0] : null;
}
