import { getDbPool } from "./db";

// Counts SiteVisitor rows whose lastSeenAt is within the active window.
// Matches the threshold the public /api/presence/current endpoint uses,
// so the dashboard and the public API agree on "how many people are
// here right now".
const ACTIVE_WINDOW_SECONDS = 60;

export async function fetchSiteVisitors(): Promise<number | null> {
  try {
    const pool = getDbPool();
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM "SiteVisitor"
       WHERE "lastSeenAt" >= NOW() - INTERVAL '${ACTIVE_WINDOW_SECONDS} seconds'`,
    );
    const n = rows[0]?.count ? parseInt(rows[0].count, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return null;
  }
}
