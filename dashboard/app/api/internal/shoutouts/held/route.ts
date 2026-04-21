import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

function authOk(req: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;
  const got = req.headers.get("x-internal-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!authOk(req)) {
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
