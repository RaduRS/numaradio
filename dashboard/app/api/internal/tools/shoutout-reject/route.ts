import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";
import { rejectShoutout } from "@/lib/shoutouts-ops";

export const dynamic = "force-dynamic";

interface RejectBody {
  id?: unknown;
  operator?: unknown;
  reason?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: RejectBody;
  try {
    body = (await req.json()) as RejectBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const operator =
    typeof body.operator === "string" ? body.operator : "chat:unknown";
  const reasonHint = typeof body.reason === "string" ? body.reason : undefined;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "id required" },
      { status: 400 },
    );
  }
  const pool = getDbPool();
  const result = await rejectShoutout({ id, operator, pool, reasonHint });
  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 :
      result.code === "already_aired" || result.code === "not_held" ? 409 :
      500;
    return NextResponse.json({ ok: false, error: result.code }, { status });
  }
  console.info(
    `action=shoutout-reject route=tools row=${id} operator=${operator}`,
  );
  return NextResponse.json({ ok: true });
}
