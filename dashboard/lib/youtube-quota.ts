// YouTube Data API quota tracking — dashboard side.
//
// Mirrors lib/youtube-quota.ts (used by the daemon + public site) but
// talks to Postgres via the raw pg pool rather than Prisma, since the
// dashboard doesn't share the Prisma client.
//
// Both sides write to the same `YoutubeQuotaUsage` table, keyed by
// the YYYY-MM-DD date in Pacific Time (Google resets quota at
// midnight PT).

import { getDbPool } from "./db";

/** Cost in units for each YouTube Data API call we make. */
export const YT_QUOTA = {
  broadcastsList: 1,
  liveChatList: 5,
  healthSnapshot: 3,
} as const;

/** YYYY-MM-DD in America/Los_Angeles for the given moment. */
export function pacificDateString(d = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/** Add `units` to today's quota counter. Best-effort. */
export async function recordYoutubeQuota(units: number): Promise<void> {
  if (units <= 0) return;
  const date = pacificDateString();
  try {
    await getDbPool().query(
      `INSERT INTO "YoutubeQuotaUsage" ("date", "unitsUsed", "updatedAt")
       VALUES ($1::date, $2, NOW())
       ON CONFLICT ("date") DO UPDATE SET
         "unitsUsed" = "YoutubeQuotaUsage"."unitsUsed" + EXCLUDED."unitsUsed",
         "updatedAt" = NOW()`,
      [date, units],
    );
  } catch (e) {
    console.warn(
      "[yt-quota] record failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

export interface YoutubeQuotaSnapshot {
  date: string;
  unitsUsed: number;
  /** Convention: Google's default daily limit per project is 10000. */
  limit: number;
  /** Seconds until midnight Pacific (when the counter resets). */
  resetsInSeconds: number;
}

const DAILY_LIMIT = 10_000;

export async function fetchYoutubeQuotaSnapshot(): Promise<YoutubeQuotaSnapshot> {
  const date = pacificDateString();
  const { rows } = await getDbPool().query<{ unitsUsed: number }>(
    `SELECT "unitsUsed" FROM "YoutubeQuotaUsage" WHERE "date" = $1::date`,
    [date],
  );
  const unitsUsed = rows[0]?.unitsUsed ?? 0;

  // Seconds until next midnight in PT. Compute via Intl to dodge DST.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const ptHour = Number(parts.hour ?? 0);
  const ptMin = Number(parts.minute ?? 0);
  const ptSec = Number(parts.second ?? 0);
  const elapsedTodaySec = ptHour * 3600 + ptMin * 60 + ptSec;
  const resetsInSeconds = 86400 - elapsedTodaySec;

  return { date, unitsUsed, limit: DAILY_LIMIT, resetsInSeconds };
}
