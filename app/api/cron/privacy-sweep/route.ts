// GET /api/cron/privacy-sweep
//
// Daily Vercel Cron entry point — see vercel.json for schedule
// (currently 04:00 UTC). Vercel sends an Authorization header
// containing the CRON_SECRET we set in env vars; we verify it
// before running anything.
//
// Why GET? Vercel Cron only invokes via GET. The handler is
// idempotent: running it twice in the same window is harmless
// (the second run just deletes whatever the first missed).

import { NextRequest, NextResponse } from "next/server";
import { runSweep } from "@/lib/privacy-sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!expected || got !== `Bearer ${expected}`) {
    // Vercel always sends a Bearer with CRON_SECRET. If it's wrong
    // or missing this is either a misconfigured deployment or an
    // unauthorised hit — refuse either way.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const counts = await runSweep();
    console.log(
      `[privacy-sweep] cron ok · shoutouts=${counts.shoutoutsDeleted} songRequests=${counts.songRequestsDeleted} rejectedSubmissions=${counts.rejectedSubmissionsDeleted}`,
    );
    return NextResponse.json({ ok: true, counts });
  } catch (err) {
    console.error("[privacy-sweep] cron threw:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
