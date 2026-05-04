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
import { signSubmissionAudioQuery } from "@/lib/sign-audio-url";

export const dynamic = "force-dynamic";

// Public host (where the audio route lives — Vercel, not the dashboard).
// Override via env in non-prod.
const PUBLIC_SITE =
  process.env.PUBLIC_SITE_URL ?? "https://numaradio.com";

interface PendingRow {
  id: string;
  artistName: string;
  trackTitle: string | null;
  trackGenre: string | null;
  email: string;
  airingPreference: "one_off" | "permanent";
  durationSeconds: number | null;
  artworkStorageKey: string | null;
  createdAt: Date;
}

interface ReviewedRow {
  id: string;
  artistName: string;
  trackTitle: string | null;
  trackGenre: string | null;
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
        `SELECT id, "artistName", "trackTitle", "trackGenre", email,
                "airingPreference", "durationSeconds", "artworkStorageKey",
                "createdAt"
           FROM "MusicSubmission"
          WHERE status = 'pending'
          ORDER BY "createdAt" DESC`,
      ),
      pool.query<ReviewedRow>(
        `SELECT id, "artistName", "trackTitle", "trackGenre", email,
                "airingPreference", status, "rejectReason", "withdrawnAt",
                "withdrawnReason", "reviewedAt", "reviewedBy"
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
        trackTitle: r.trackTitle,
        trackGenre: r.trackGenre,
        email: r.email,
        airingPreference: r.airingPreference,
        durationSeconds: r.durationSeconds,
        artworkStorageKey: r.artworkStorageKey,
        createdAt: r.createdAt.toISOString(),
        // Pre-signed audio URL — short-lived HMAC verified by the
        // public-site route. Operator browser fetches this directly
        // (the URL bypasses CF Access since it points to numaradio.com),
        // so the sig is the only thing standing between random visitors
        // and pending unmoderated audio.
        audioUrl: `${PUBLIC_SITE}/api/submissions/${r.id}/audio${signSubmissionAudioQuery(r.id)}`,
      })),
      reviewed: reviewedRes.rows.map((r) => ({
        id: r.id,
        artistName: r.artistName,
        trackTitle: r.trackTitle,
        trackGenre: r.trackGenre,
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
