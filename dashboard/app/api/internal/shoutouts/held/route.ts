import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const pool = getDbPool();
  const { rows } = await pool.query(
    `SELECT id,
            "rawText"           AS "rawText",
            "requesterName"     AS "requesterName",
            "moderationReason"  AS "moderationReason",
            "createdAt"         AS "createdAt"
       FROM "Shoutout"
      WHERE "moderationStatus" = 'held'
      ORDER BY "createdAt" DESC
      LIMIT 10`,
  );
  return NextResponse.json({ ok: true, held: rows });
}
