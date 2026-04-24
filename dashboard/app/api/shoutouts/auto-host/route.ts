import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const FORCE_WINDOW_MS = 20 * 60 * 1000;

type AutoHostMode = "auto" | "forced_on" | "forced_off";

interface StationRow {
  autoHostMode: AutoHostMode;
  autoHostForcedUntil: Date | null;
  autoHostForcedBy: string | null;
}

function isValidMode(v: unknown): v is AutoHostMode {
  return v === "auto" || v === "forced_on" || v === "forced_off";
}

export async function GET(): Promise<NextResponse> {
  try {
    const pool = getDbPool();
    const r = await pool.query<StationRow>(
      `SELECT "autoHostMode", "autoHostForcedUntil", "autoHostForcedBy"
         FROM "Station" WHERE slug = $1 LIMIT 1`,
      [STATION_SLUG],
    );
    const row = r.rows[0];
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `station "${STATION_SLUG}" not found` },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      mode: row.autoHostMode,
      forcedUntil: row.autoHostForcedUntil?.toISOString() ?? null,
      forcedBy: row.autoHostForcedBy,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { mode?: unknown };
  try {
    body = (await req.json()) as { mode?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!isValidMode(body.mode)) {
    return NextResponse.json(
      { ok: false, error: "mode must be one of: auto, forced_on, forced_off" },
      { status: 400 },
    );
  }

  const user = req.headers.get("cf-access-authenticated-user-email") ?? "unknown";
  const isForced = body.mode !== "auto";
  const forcedUntil = isForced ? new Date(Date.now() + FORCE_WINDOW_MS) : null;
  const forcedBy = isForced ? user : null;

  try {
    const pool = getDbPool();
    const r = await pool.query<StationRow>(
      `UPDATE "Station"
         SET "autoHostMode" = $1::"AutoHostMode",
             "autoHostForcedUntil" = $2,
             "autoHostForcedBy" = $3,
             "updatedAt" = NOW()
       WHERE slug = $4
       RETURNING "autoHostMode", "autoHostForcedUntil", "autoHostForcedBy"`,
      [body.mode, forcedUntil, forcedBy, STATION_SLUG],
    );
    if (r.rowCount === 0) {
      return NextResponse.json(
        { ok: false, error: `station "${STATION_SLUG}" not found` },
        { status: 404 },
      );
    }
    console.info(
      `action=auto_host_set mode=${body.mode} user=${user}` +
        (isForced ? ` expires_in=20m` : ""),
    );
    const row = r.rows[0]!;
    return NextResponse.json({
      ok: true,
      mode: row.autoHostMode,
      forcedUntil: row.autoHostForcedUntil?.toISOString() ?? null,
      forcedBy: row.autoHostForcedBy,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}
