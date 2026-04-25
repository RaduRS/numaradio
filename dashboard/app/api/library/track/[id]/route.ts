import { NextRequest, NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_SHOWS = new Set([
  "night_shift", "morning_room", "daylight_channel", "prime_hours",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const show = (body as { show?: unknown }).show;
  if (typeof show !== "string" || !VALID_SHOWS.has(show)) {
    return NextResponse.json(
      { error: `show must be one of ${[...VALID_SHOWS].join(", ")}` },
      { status: 400 },
    );
  }
  const pool = getDbPool();
  const result = await pool.query(
    'UPDATE "Track" SET "show" = $1::"ShowBlock" WHERE id = $2 RETURNING id, "show"',
    [show, id],
  );
  if (result.rowCount === 0) {
    return NextResponse.json({ error: "track not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, track: result.rows[0] });
}
