import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

interface StationRow {
  autoHostEnabled: boolean;
}

export async function GET(): Promise<NextResponse> {
  try {
    const pool = getDbPool();
    const r = await pool.query<StationRow>(
      `SELECT "autoHostEnabled" FROM "Station" WHERE slug = $1 LIMIT 1`,
      [STATION_SLUG],
    );
    const enabled = r.rows[0]?.autoHostEnabled ?? false;
    return NextResponse.json({ ok: true, enabled });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { enabled?: unknown };
  try {
    body = (await req.json()) as { enabled?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "enabled (boolean) required" },
      { status: 400 },
    );
  }

  try {
    const pool = getDbPool();
    const r = await pool.query<StationRow>(
      `UPDATE "Station" SET "autoHostEnabled" = $1, "updatedAt" = NOW()
        WHERE slug = $2 RETURNING "autoHostEnabled"`,
      [body.enabled, STATION_SLUG],
    );
    if (r.rowCount === 0) {
      return NextResponse.json(
        { ok: false, error: `station "${STATION_SLUG}" not found` },
        { status: 404 },
      );
    }
    const user = req.headers.get("cf-access-authenticated-user-email") ?? "unknown";
    console.info(
      `action=auto_host_toggle enabled=${body.enabled} user=${user}`,
    );
    return NextResponse.json({ ok: true, enabled: r.rows[0].autoHostEnabled });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}
