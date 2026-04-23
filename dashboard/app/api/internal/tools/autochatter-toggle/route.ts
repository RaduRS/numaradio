import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

interface Body {
  enabled?: unknown;
  operator?: unknown;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const pool = getDbPool();
  const r = await pool.query<{ autoHostEnabled: boolean }>(
    `SELECT "autoHostEnabled" FROM "Station" WHERE slug = $1 LIMIT 1`,
    [STATION_SLUG],
  );
  return NextResponse.json({
    ok: true,
    enabled: r.rows[0]?.autoHostEnabled ?? false,
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
  const pool = getDbPool();
  const r = await pool.query<{ autoHostEnabled: boolean }>(
    `UPDATE "Station" SET "autoHostEnabled" = $1, "updatedAt" = NOW()
      WHERE slug = $2 RETURNING "autoHostEnabled"`,
    [body.enabled, STATION_SLUG],
  );
  if (r.rowCount === 0) {
    return NextResponse.json(
      { ok: false, error: "station not found" },
      { status: 404 },
    );
  }
  console.info(
    `action=autochatter-toggle enabled=${body.enabled} operator=${operator}`,
  );
  return NextResponse.json({ ok: true, enabled: r.rows[0].autoHostEnabled });
}
