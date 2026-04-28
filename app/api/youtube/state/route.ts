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
      // CDN-cache for a short window so Vercel's edge handles
      // multiple visitors with one origin call.
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
