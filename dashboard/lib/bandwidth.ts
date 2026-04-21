import type { Pool } from "pg";

export const DEFAULT_CAP_GB = 6;
export const DEFAULT_CAP_BYTES = DEFAULT_CAP_GB * 1024 ** 3;

export interface BandwidthToday {
  bytesToday: number;
  capBytes: number;
  fractionUsed: number;
  unaccountedRows: number;
  sampledRows: number;
}

function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function readCapBytes(): number {
  const raw = process.env.B2_DAILY_CAP_GB;
  if (!raw) return DEFAULT_CAP_BYTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CAP_BYTES;
  return Math.floor(n * 1024 ** 3);
}

export async function fetchBandwidthToday(pool: Pool): Promise<BandwidthToday> {
  const { rows } = await pool.query(
    `
    WITH today_plays AS (
      SELECT "id", "trackId"
        FROM "PlayHistory"
       WHERE "startedAt" >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
         AND "trackId" IS NOT NULL
    )
    SELECT
      COALESCE(SUM(ta."byteSize"), 0)::bigint AS bytes_today,
      COUNT(*)                              AS sampled_rows,
      COUNT(*) FILTER (WHERE ta.id IS NULL) AS unaccounted_rows
    FROM today_plays tp
    LEFT JOIN "TrackAsset" ta
           ON ta."trackId"   = tp."trackId"
          AND ta."assetType" = 'audio_stream'
    `,
  );

  const row = rows[0] ?? {};
  const bytesToday = toNumber(row.bytes_today);
  const sampledRows = toNumber(row.sampled_rows);
  const unaccountedRows = toNumber(row.unaccounted_rows);
  const capBytes = readCapBytes();
  const fractionUsed =
    capBytes > 0 ? Math.min(1, bytesToday / capBytes) : 0;

  return {
    bytesToday,
    capBytes,
    fractionUsed,
    sampledRows,
    unaccountedRows,
  };
}
