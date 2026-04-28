import { NextResponse } from "next/server";
import { fetchYoutubeSnapshot } from "@/lib/youtube";

export const dynamic = "force-dynamic";

// Snapshot of the YouTube broadcast for the dashboard tile. The lib
// caches in-process for 30s so we can hit this every 30s from the
// frontend without amplifying API quota.
export async function GET() {
  const snap = await fetchYoutubeSnapshot();
  return NextResponse.json(snap, {
    headers: { "Cache-Control": "no-store" },
  });
}
