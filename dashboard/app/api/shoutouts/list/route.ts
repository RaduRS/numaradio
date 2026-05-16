import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { listHeldShoutouts, listRecentShoutouts } from "@/lib/shoutouts";
import { listRecentChatter } from "@/lib/chatter";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const pool = getDbPool();
    const [held, recent, chatter] = await Promise.all([
      listHeldShoutouts(pool),
      listRecentShoutouts(pool, 20),
      listRecentChatter(pool, 60),
    ]);
    return NextResponse.json({ held, recent, chatter });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "list failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
