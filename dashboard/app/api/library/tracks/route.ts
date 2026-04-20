import { NextResponse } from "next/server";
import { fetchLibraryTracks } from "@/lib/library";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const tracks = await fetchLibraryTracks(getDbPool());
    return NextResponse.json({ tracks }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "library query failed";
    return NextResponse.json({ tracks: [], error: msg }, { status: 503 });
  }
}
