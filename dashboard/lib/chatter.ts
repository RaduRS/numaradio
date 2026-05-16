import type { Pool } from "pg";

export interface ChatterRow {
  id: string;
  airedAt: string;
  chatterType: string;
  slot: number;
  script: string;
  audioUrl: string | null;
  producerVersion: number | null;
}

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

export async function listRecentChatter(
  pool: Pool,
  limit = 60,
): Promise<ChatterRow[]> {
  const { rows } = await pool.query<ChatterRow>(
    `SELECT c.id,
            c."airedAt"        AT TIME ZONE 'UTC' AS "airedAt",
            c."chatterType",
            c.slot,
            c.script,
            c."audioUrl",
            c."producerVersion"
       FROM "Chatter" c
       JOIN "Station" st ON st.id = c."stationId"
      WHERE st.slug = $1
        AND c."audioUrl" IS NOT NULL
      ORDER BY c."airedAt" DESC
      LIMIT $2`,
    [STATION_SLUG, limit],
  );
  return rows;
}
