// GET /api/submissions/find?email=<email>
//
// Find any MusicSubmission rows tied to an email — used by the
// operator panel's "Find by email" search so you can withdraw /
// full-delete a track that's older than the recent-20 list.

import { NextRequest, NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  artistName: string;
  email: string;
  airingPreference: "one_off" | "permanent";
  status: "pending" | "approved" | "rejected" | "withdrawn";
  rejectReason: string | null;
  withdrawnAt: Date | null;
  withdrawnReason: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  createdAt: Date;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const email = url.searchParams.get("email")?.trim().toLowerCase();
  if (!email || email.length < 3) {
    return NextResponse.json({ rows: [] });
  }
  try {
    const pool = getDbPool();
    const r = await pool.query<Row>(
      `SELECT id, "artistName", email, "airingPreference", status,
              "rejectReason", "withdrawnAt", "withdrawnReason",
              "reviewedAt", "reviewedBy", "createdAt"
         FROM "MusicSubmission"
        WHERE LOWER(email) = $1
        ORDER BY "createdAt" DESC
        LIMIT 50`,
      [email],
    );
    return NextResponse.json({
      rows: r.rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}
