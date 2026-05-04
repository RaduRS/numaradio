import { NextResponse } from "next/server";
import { fetchPublicYoutubeState } from "@/lib/youtube-public";

export const dynamic = "force-dynamic";

// Public homepage probe — "is YouTube live right now?" Used by the
// LiveOnYouTubeBanner. Cached 60s in-process so heavy homepage
// traffic doesn't burn quota.
export async function GET() {
  const state = await fetchPublicYoutubeState();
  return NextResponse.json(state, {
    headers: {
      // CDN-cache for 6 min so Vercel's edge serves homepage visitors
      // without re-hitting YouTube. Banner state changes ~once a day
      // (broadcast on/off) — sub-minute freshness is overkill.
      "Cache-Control": "public, s-maxage=360, stale-while-revalidate=720",
    },
  });
}
