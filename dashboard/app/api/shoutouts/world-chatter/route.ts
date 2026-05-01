// World-chatter (toggle B) — same 3-state pattern as auto-host (toggle A).
// Tier 2.5 of the Lena chatter system. When toggle B is forced_off, the
// 3 world_aside slots in the auto-chatter rotation revert to filler. The
// auto-chatter master toggle (A) gates the entire pipeline above this.
//
// Spec: docs/superpowers/specs/2026-04-26-lena-world-aside-design.md.

import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const FORCE_WINDOW_MS = 30 * 60 * 1000;

type AutoHostMode = "auto" | "forced_on" | "forced_off";

interface StationRow {
  worldAsideMode: AutoHostMode;
  worldAsideForcedUntil: Date | null;
  worldAsideForcedBy: string | null;
}

function isValidMode(v: unknown): v is AutoHostMode {
  return v === "auto" || v === "forced_on" || v === "forced_off";
}

export async function GET(): Promise<NextResponse> {
  try {
    const pool = getDbPool();
    // Eager revert if the forced window has elapsed — same pattern as
    // the auto-host route. See note there for the why.
    const reverted = await pool.query<StationRow>(
      `UPDATE "Station"
         SET "worldAsideMode" = 'auto',
             "worldAsideForcedUntil" = NULL,
             "worldAsideForcedBy" = NULL,
             "updatedAt" = NOW()
       WHERE slug = $1
         AND "worldAsideMode" != 'auto'
         AND "worldAsideForcedUntil" IS NOT NULL
         AND "worldAsideForcedUntil" <= NOW()
       RETURNING "worldAsideMode", "worldAsideForcedUntil", "worldAsideForcedBy"`,
      [STATION_SLUG],
    );
    let row: StationRow | undefined;
    if (reverted.rowCount === 1) {
      row = reverted.rows[0];
    } else {
      const r = await pool.query<StationRow>(
        `SELECT "worldAsideMode", "worldAsideForcedUntil", "worldAsideForcedBy"
           FROM "Station" WHERE slug = $1 LIMIT 1`,
        [STATION_SLUG],
      );
      row = r.rows[0];
    }
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `station "${STATION_SLUG}" not found` },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      mode: row.worldAsideMode,
      forcedUntil: row.worldAsideForcedUntil?.toISOString() ?? null,
      forcedBy: row.worldAsideForcedBy,
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
         SET "worldAsideMode" = $1::"AutoHostMode",
             "worldAsideForcedUntil" = $2,
             "worldAsideForcedBy" = $3,
             "updatedAt" = NOW()
       WHERE slug = $4
       RETURNING "worldAsideMode", "worldAsideForcedUntil", "worldAsideForcedBy"`,
      [body.mode, forcedUntil, forcedBy, STATION_SLUG],
    );
    if (r.rowCount === 0) {
      return NextResponse.json(
        { ok: false, error: `station "${STATION_SLUG}" not found` },
        { status: 404 },
      );
    }
    console.info(
      `action=world_aside_set mode=${body.mode} user=${user}` +
        (isForced ? ` expires_in=30m` : ""),
    );
    const row = r.rows[0]!;
    return NextResponse.json({
      ok: true,
      mode: row.worldAsideMode,
      forcedUntil: row.worldAsideForcedUntil?.toISOString() ?? null,
      forcedBy: row.worldAsideForcedBy,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}
