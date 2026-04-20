import type { Pool } from "pg";

export interface ShoutoutRow {
  id: string;
  rawText: string;
  cleanText: string | null;
  broadcastText: string | null;
  requesterName: string | null;
  moderationStatus: string;
  moderationReason: string | null;
  deliveryStatus: string;
  linkedQueueItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

const SELECT_COLS = `
  s.id,
  s."rawText"          AS "rawText",
  s."cleanText"        AS "cleanText",
  s."broadcastText"    AS "broadcastText",
  s."requesterName"    AS "requesterName",
  s."moderationStatus" AS "moderationStatus",
  s."moderationReason" AS "moderationReason",
  s."deliveryStatus"   AS "deliveryStatus",
  s."linkedQueueItemId" AS "linkedQueueItemId",
  s."createdAt"        AS "createdAt",
  s."updatedAt"        AS "updatedAt"
`;

export async function listHeldShoutouts(pool: Pool): Promise<ShoutoutRow[]> {
  const { rows } = await pool.query<ShoutoutRow>(
    `SELECT ${SELECT_COLS}
       FROM "Shoutout" s
       JOIN "Station" st ON st.id = s."stationId"
      WHERE st.slug = $1
        AND s."moderationStatus" = 'held'
        AND s."deliveryStatus" IN ('pending', 'held')
      ORDER BY s."createdAt" ASC`,
    [STATION_SLUG],
  );
  return rows;
}

export async function listRecentShoutouts(
  pool: Pool,
  limit = 20,
): Promise<ShoutoutRow[]> {
  const { rows } = await pool.query<ShoutoutRow>(
    `SELECT ${SELECT_COLS}
       FROM "Shoutout" s
       JOIN "Station" st ON st.id = s."stationId"
      WHERE st.slug = $1
        AND s."deliveryStatus" IN ('aired', 'failed', 'blocked')
      ORDER BY s."updatedAt" DESC
      LIMIT $2`,
    [STATION_SLUG, limit],
  );
  return rows;
}

export async function getShoutout(
  pool: Pool,
  id: string,
): Promise<ShoutoutRow | null> {
  const { rows } = await pool.query<ShoutoutRow>(
    `SELECT ${SELECT_COLS} FROM "Shoutout" s WHERE s.id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function markShoutoutBlocked(
  pool: Pool,
  id: string,
  reason: string,
): Promise<void> {
  await pool.query(
    `UPDATE "Shoutout"
        SET "moderationStatus" = 'blocked',
            "moderationReason" = $2,
            "deliveryStatus"   = 'blocked',
            "updatedAt"        = NOW()
      WHERE id = $1`,
    [id, reason.slice(0, 200)],
  );
}
