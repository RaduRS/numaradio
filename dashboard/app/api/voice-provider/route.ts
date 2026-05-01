import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

type VoiceProvider = "deepgram" | "vertex";

interface StationRow {
  voiceProvider: VoiceProvider;
}

function isValidProvider(v: unknown): v is VoiceProvider {
  return v === "deepgram" || v === "vertex";
}

export async function GET(): Promise<NextResponse> {
  try {
    const pool = getDbPool();
    const r = await pool.query<StationRow>(
      `SELECT "voiceProvider" FROM "Station" WHERE slug = $1 LIMIT 1`,
      [STATION_SLUG],
    );
    const row = r.rows[0];
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `station "${STATION_SLUG}" not found` },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, provider: row.voiceProvider });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { provider?: unknown };
  try {
    body = (await req.json()) as { provider?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!isValidProvider(body.provider)) {
    return NextResponse.json(
      { ok: false, error: "provider must be one of: deepgram, vertex" },
      { status: 400 },
    );
  }

  const user = req.headers.get("cf-access-authenticated-user-email") ?? "unknown";

  try {
    const pool = getDbPool();
    const r = await pool.query<StationRow>(
      `UPDATE "Station"
         SET "voiceProvider" = $1::"VoiceProvider",
             "updatedAt" = NOW()
       WHERE slug = $2
       RETURNING "voiceProvider"`,
      [body.provider, STATION_SLUG],
    );
    if (r.rowCount === 0) {
      return NextResponse.json(
        { ok: false, error: `station "${STATION_SLUG}" not found` },
        { status: 404 },
      );
    }
    console.info(`action=voice_provider_set provider=${body.provider} user=${user}`);
    return NextResponse.json({ ok: true, provider: r.rows[0]!.voiceProvider });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "db error" },
      { status: 500 },
    );
  }
}
