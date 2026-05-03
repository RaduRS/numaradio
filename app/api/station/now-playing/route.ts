// GET /api/station/now-playing
//
// Public read of the currently airing track + when it started. The frontend
// uses startedAt + durationSeconds to compute a local elapsed/progress
// display without polling per-second.

import { getNowPlayingSnapshot } from "@/lib/now-playing-snapshot";

export const dynamic = "force-dynamic";

const HEADERS = {
  // Match the client poll interval (15s) so each poll hits the edge
  // cache and one function fire serves every visitor — including the
  // always-on encoder Chromium tab on Orion which polls 24/7. Bumped
  // 2→5 then 5→15 across the 2026-05-03 free-tier audit.
  "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
  "Content-Type": "application/json",
};

export async function GET() {
  const payload = await getNowPlayingSnapshot();
  return new globalThis.Response(JSON.stringify(payload), {
    status: 200,
    headers: HEADERS,
  });
}
