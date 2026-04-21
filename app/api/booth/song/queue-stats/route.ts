import { NextResponse } from "next/server";
import { fetchQueueStats } from "@/lib/song-request";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const stats = await fetchQueueStats();
  return NextResponse.json(
    { ok: true, ...stats },
    {
      headers: {
        "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10",
      },
    },
  );
}
