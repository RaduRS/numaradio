import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";
import { approveShoutout } from "@/lib/shoutouts-ops";
import { generateShoutout, ShoutoutError } from "@/lib/shoutout";

export const dynamic = "force-dynamic";

interface ApproveBody {
  id?: unknown;
  operator?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: ApproveBody;
  try {
    body = (await req.json()) as ApproveBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const operator =
    typeof body.operator === "string" ? body.operator : "chat:unknown";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "id required" },
      { status: 400 },
    );
  }
  const pool = getDbPool();
  const result = await approveShoutout({
    id,
    operator,
    pool,
    generate: async ({ text, shoutoutRowId, requesterName, pool: p }) => {
      try {
        return await generateShoutout({
          text,
          source: { kind: "booth", shoutoutRowId, requesterName },
          pool: p,
        });
      } catch (e) {
        if (e instanceof ShoutoutError) throw new Error(e.message);
        throw e;
      }
    },
  });
  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 :
      result.code === "already_aired" || result.code === "not_held" ? 409 :
      500;
    return NextResponse.json(
      { ok: false, error: result.code, detail: result.error },
      { status },
    );
  }
  console.info(
    `action=shoutout-approve route=tools row=${id} operator=${operator} queue=${result.queueItemId}`,
  );
  return NextResponse.json({
    ok: true,
    trackId: result.trackId,
    queueItemId: result.queueItemId,
  });
}
