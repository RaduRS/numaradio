// YouTube Data API quota tracking — used by the daemon's chat poller
// and the public-site banner. The dashboard has its own version
// (dashboard/lib/youtube-quota.ts) because the dashboard talks to
// Postgres via raw pg, not Prisma. They share the same table.
//
// Google resets the YouTube quota at midnight Pacific Time. The
// `date` column is the YYYY-MM-DD in PT, so all writers around the
// world hit the same row for "today" regardless of clock skew.

import { prisma } from "./db";

/** Cost in units for each YouTube Data API call we make. */
export const YT_QUOTA = {
  /** liveBroadcasts.list — used as the off-air check (1u). */
  broadcastsList: 1,
  /** liveChat/messages list (5u). */
  liveChatList: 5,
  /** Dashboard health: liveBroadcasts + liveStreams + videos = 3u. */
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

/** Add `units` to today's quota counter. Best-effort — DB errors are
 *  swallowed (logged) so a Postgres blip can't break the chat poller. */
export async function recordYoutubeQuota(units: number): Promise<void> {
  if (units <= 0) return;
  const date = new Date(`${pacificDateString()}T00:00:00Z`);
  try {
    await prisma.youtubeQuotaUsage.upsert({
      where: { date },
      create: { date, unitsUsed: units },
      update: { unitsUsed: { increment: units } },
    });
  } catch (e) {
    console.warn(
      "[yt-quota] record failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}
