import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { listHeldShoutouts, listRecentShoutouts } from "@/lib/shoutouts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const pool = getDbPool();
    const [held, recent] = await Promise.all([
      listHeldShoutouts(pool),
      listRecentShoutouts(pool, 20),
    ]);
    return NextResponse.json({ held, recent });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "list failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
