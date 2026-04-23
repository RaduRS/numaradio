import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";
import { listRecentShoutouts } from "@/lib/shoutouts";

export const dynamic = "force-dynamic";

/**
 * Recent shoutouts — aired, failed, blocked, held — in one list.
 * Mirrors the `recent` half of the dashboard's `/api/shoutouts/list`
 * used by the /shoutouts page. The agent asks this when the operator
 * wants to know "what's the shoutout history" or "which shoutouts went
 * out today".
 */
export async function GET(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.max(
    1,
    Math.min(100, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
  );
  const pool = getDbPool();
  const recent = await listRecentShoutouts(pool, limit);
  return NextResponse.json({ ok: true, recent });
}
