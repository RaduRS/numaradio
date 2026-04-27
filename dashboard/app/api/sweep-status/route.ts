// GET /api/sweep-status
//
// Read the latest privacy_sweep audit row so the dashboard can
// render a "Last sweep · 2h ago · cleaned 3 · next 04:00 UTC"
// chip. Light read; called once per panel poll cycle.

import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Row {
  createdAt: Date;
  payloadJson: {
    shoutoutsDeleted?: number;
    songRequestsDeleted?: number;
    rejectedSubmissionsDeleted?: number;
  } | null;
}

export async function GET(): Promise<NextResponse> {
  try {
    const pool = getDbPool();
    const r = await pool.query<Row>(
      `SELECT "createdAt", "payloadJson"
         FROM "SystemEvent"
        WHERE "eventType" = 'privacy_sweep'
        ORDER BY "createdAt" DESC
        LIMIT 1`,
    );
    const row = r.rows[0];
    if (!row) {
      return NextResponse.json({ lastRun: null, counts: null });
    }
    return NextResponse.json({
      lastRun: row.createdAt.toISOString(),
      counts: {
        shoutoutsDeleted: row.payloadJson?.shoutoutsDeleted ?? 0,
        songRequestsDeleted: row.payloadJson?.songRequestsDeleted ?? 0,
        rejectedSubmissionsDeleted: row.payloadJson?.rejectedSubmissionsDeleted ?? 0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}
