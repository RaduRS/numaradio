import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

export async function GET(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const pool = getDbPool();
  const { rows } = await pool.query<{
    trackId: string;
    title: string;
    artist: string | null;
    artworkUrl: string | null;
    startedAt: string;
  }>(
    `SELECT np."trackId"      AS "trackId",
            t.title             AS title,
            t."artistDisplay"   AS artist,
            art."publicUrl"     AS "artworkUrl",
            np."startedAt"      AS "startedAt"
       FROM "NowPlaying" np
       JOIN "Station" s     ON s.id = np."stationId"
       JOIN "Track" t       ON t.id = np."trackId"
       LEFT JOIN LATERAL (
         SELECT "publicUrl" FROM "TrackAsset"
         WHERE "trackId" = t.id AND "assetType" = 'artwork_primary'
         ORDER BY "createdAt" DESC LIMIT 1
       ) art ON true
      WHERE s.slug = $1
      LIMIT 1`,
    [STATION_SLUG],
  );
  const np = rows[0];
  return NextResponse.json({
    ok: true,
    nowPlaying: np ?? null,
  });
}
