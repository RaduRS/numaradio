import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

interface SearchBody {
  query?: unknown;
  limit?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const limit = Math.max(
    1,
    Math.min(25, typeof body.limit === "number" ? body.limit : 10),
  );
  if (!query) {
    return NextResponse.json(
      { ok: false, error: "query is required" },
      { status: 400 },
    );
  }

  const pool = getDbPool();
  const { rows } = await pool.query<{
    id: string;
    title: string;
    artist: string | null;
    durationSeconds: number | null;
    airingPolicy: string;
    trackStatus: string;
  }>(
    `SELECT t.id,
            t.title,
            t."artistDisplay"   AS artist,
            t."durationSeconds" AS "durationSeconds",
            t."airingPolicy"    AS "airingPolicy",
            t."trackStatus"     AS "trackStatus"
       FROM "Track" t
       JOIN "Station" s ON s.id = t."stationId"
      WHERE s.slug = $1
        AND t."sourceType" != 'external_import'
        AND (t.title ILIKE $2 OR t."artistDisplay" ILIKE $2)
      ORDER BY t."createdAt" DESC
      LIMIT $3`,
    [STATION_SLUG, `%${query}%`, limit],
  );
  return NextResponse.json({ ok: true, tracks: rows });
}
