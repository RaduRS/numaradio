import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";
const FORCE_WINDOW_MS = 20 * 60 * 1000;

type AutoHostMode = "auto" | "forced_on" | "forced_off";

interface Body {
  enabled?: unknown;
  operator?: unknown;
}

// Legacy tool shape for the NanoClaw agent. Translates `enabled` booleans
// into the tri-state model: true → forced_on for 20 min, false → forced_off
// for 20 min. GET derives enabled from the current mode.

export async function GET(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const pool = getDbPool();
  const r = await pool.query<{ autoHostMode: AutoHostMode }>(
    `SELECT "autoHostMode" FROM "Station" WHERE slug = $1 LIMIT 1`,
    [STATION_SLUG],
  );
  const mode = r.rows[0]?.autoHostMode ?? "auto";
  return NextResponse.json({
    ok: true,
    enabled: mode !== "forced_off",
    mode,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "enabled (boolean) required" },
      { status: 400 },
    );
  }
  const operator =
    typeof body.operator === "string" ? body.operator : "chat:unknown";
  const nextMode: AutoHostMode = body.enabled ? "forced_on" : "forced_off";
  const forcedUntil = new Date(Date.now() + FORCE_WINDOW_MS);
  const pool = getDbPool();
  const r = await pool.query<{ autoHostMode: AutoHostMode }>(
    `UPDATE "Station"
       SET "autoHostMode" = $1::"AutoHostMode",
           "autoHostForcedUntil" = $2,
           "autoHostForcedBy" = $3,
           "updatedAt" = NOW()
     WHERE slug = $4
     RETURNING "autoHostMode"`,
    [nextMode, forcedUntil, operator, STATION_SLUG],
  );
  if (r.rowCount === 0) {
    return NextResponse.json(
      { ok: false, error: "station not found" },
      { status: 404 },
    );
  }
  console.info(
    `action=autochatter-toggle mode=${nextMode} operator=${operator} expires_in=20m`,
  );
  return NextResponse.json({
    ok: true,
    enabled: body.enabled,
    mode: r.rows[0].autoHostMode,
  });
}
