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

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runSweep } from "@/lib/privacy-sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cronAuthOk(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${expected}`;
  if (got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthOk(req)) {
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
    // Log full error server-side; opaque error to caller so Prisma /
    // Postgres internals don't leak schema or constraint names.
    console.error("[privacy-sweep] cron threw:", err);
    return NextResponse.json(
      { ok: false, error: "sweep_failed" },
      { status: 500 },
    );
  }
}
