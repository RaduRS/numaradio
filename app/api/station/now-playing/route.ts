// GET /api/station/now-playing
//
// Public read of the currently airing track + when it started. The frontend
// uses startedAt + durationSeconds to compute a local elapsed/progress
// display without polling per-second.

import { getNowPlayingSnapshot } from "@/lib/now-playing-snapshot";

export const dynamic = "force-dynamic";

const HEADERS = {
  // Bumped from s-maxage=2 (2026-05-03 free-tier audit). Client-side
  // useNowPlaying polls every 15s and computes elapsed locally from
  // startedAt + durationSeconds — 5s of edge cushion is invisible.
  "Cache-Control": "public, s-maxage=5, stale-while-revalidate=15",
  "Content-Type": "application/json",
};

export async function GET() {
  const payload = await getNowPlayingSnapshot();
  return new globalThis.Response(JSON.stringify(payload), {
    status: 200,
    headers: HEADERS,
  });
}
