import { Prisma, type PrismaClient } from "@prisma/client";

export interface ClaimedJob {
  id: string;
  prompt: string;
  artistName: string;
  isInstrumental: boolean;
}

// SQL kept as a tagged template returning a Prisma.Sql so the call
// site uses $queryRaw — the Unsafe variant signals "I'm bypassing
// parameterisation" even though this query has no params today, and
// the tagged form makes a future edit that introduces a runtime
// parameter type-safe by construction.
function claimSql(): Prisma.Sql {
  return Prisma.sql`
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

// Kept as a string for the existing test helper (workers/song-worker/
// claim.test.ts asserts the SQL shape).
export function buildClaimSql(): string {
  return claimSql().sql;
}

export async function claimNextJob(prisma: PrismaClient): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<ClaimedJob[]>(claimSql());
  return rows.length > 0 ? rows[0] : null;
}
