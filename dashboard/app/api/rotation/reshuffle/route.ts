import { NextResponse } from "next/server";
import { requestRotationRefresh } from "@/lib/library";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const r = await requestRotationRefresh();
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.result });
}
