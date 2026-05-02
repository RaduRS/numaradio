import { NextResponse } from "next/server";
import { setManualRotation, clearManualRotation } from "@/lib/library";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: { trackIds?: unknown };
  try { body = (await req.json()) as { trackIds?: unknown }; }
  catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }

  if (!Array.isArray(body.trackIds) || body.trackIds.some((x) => typeof x !== "string")) {
    return NextResponse.json({ ok: false, error: "trackIds must be a string[]" }, { status: 400 });
  }
  if (body.trackIds.length === 0) {
    return NextResponse.json({ ok: false, error: "trackIds cannot be empty" }, { status: 400 });
  }

  const r = await setManualRotation(body.trackIds as string[]);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.result });
}

export async function DELETE(): Promise<NextResponse> {
  const r = await clearManualRotation();
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.result });
}
