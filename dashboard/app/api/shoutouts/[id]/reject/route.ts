import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { getShoutout, markShoutoutBlocked } from "@/lib/shoutouts";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const pool = getDbPool();
  const existing = await getShoutout(pool, id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  if (existing.deliveryStatus === "aired") {
    return NextResponse.json(
      { ok: false, error: "already aired" },
      { status: 409 },
    );
  }

  const operator =
    req.headers.get("cf-access-authenticated-user-email") ?? "operator";

  await markShoutoutBlocked(pool, id, `rejected_by:${operator}`);

  console.info(`action=shoutout-reject row=${id} operator=${operator}`);

  return NextResponse.json({ ok: true });
}
