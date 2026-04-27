// GET /api/submissions/list
//
// Returns pending submissions (newest first) plus the last 10 reviewed,
// for the operator panel on /shoutouts. The dashboard sits behind CF
// Access so no extra app-level auth is needed.
//
// Dashboard reads use raw SQL via the existing pg pool — Prisma is not
// available in this app.

import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

interface PendingRow {
  id: string;
  artistName: string;
  email: string;
  airingPreference: "one_off" | "permanent";
  durationSeconds: number | null;
  artworkStorageKey: string | null;
  createdAt: Date;
}

interface ReviewedRow {
  id: string;
  artistName: string;
  email: string;
  airingPreference: "one_off" | "permanent";
  status: "approved" | "rejected" | "withdrawn";
  rejectReason: string | null;
  withdrawnAt: Date | null;
  withdrawnReason: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
}

export async function GET(): Promise<NextResponse> {
  try {
    const pool = getDbPool();
    const [pendingRes, reviewedRes] = await Promise.all([
      pool.query<PendingRow>(
        `SELECT id, "artistName", email, "airingPreference",
                "durationSeconds", "artworkStorageKey", "createdAt"
           FROM "MusicSubmission"
          WHERE status = 'pending'
          ORDER BY "createdAt" DESC`,
      ),
      pool.query<ReviewedRow>(
        `SELECT id, "artistName", email, "airingPreference", status,
                "rejectReason", "withdrawnAt", "withdrawnReason",
                "reviewedAt", "reviewedBy"
           FROM "MusicSubmission"
          WHERE status IN ('approved', 'rejected', 'withdrawn')
          ORDER BY GREATEST(
            COALESCE("reviewedAt", '1970-01-01'::timestamp),
            COALESCE("withdrawnAt", '1970-01-01'::timestamp)
          ) DESC
          LIMIT 20`,
      ),
    ]);

    return NextResponse.json({
      pending: pendingRes.rows.map((r) => ({
        id: r.id,
        artistName: r.artistName,
        email: r.email,
        airingPreference: r.airingPreference,
        durationSeconds: r.durationSeconds,
        artworkStorageKey: r.artworkStorageKey,
        createdAt: r.createdAt.toISOString(),
      })),
      reviewed: reviewedRes.rows.map((r) => ({
        id: r.id,
        artistName: r.artistName,
        email: r.email,
        airingPreference: r.airingPreference,
        status: r.status,
        rejectReason: r.rejectReason,
        withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
        withdrawnReason: r.withdrawnReason,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        reviewedBy: r.reviewedBy,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}
