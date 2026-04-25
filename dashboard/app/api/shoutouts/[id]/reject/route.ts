import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { rejectShoutout } from "@/lib/shoutouts-ops";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const pool = getDbPool();
  // See dashboard/app/api/shoutouts/[id]/approve/route.ts — same
  // header-shape sanity check.
  const rawEmail = req.headers.get("cf-access-authenticated-user-email") ?? "";
  const operator = /^[^@\s]+@[^@\s]+$/.test(rawEmail) ? rawEmail : "operator";

  const result = await rejectShoutout({ id, operator, pool });

  if (!result.ok) {
    if (result.code === "not_found") {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: result.code === "already_aired" ? "already aired" : "not held" },
      { status: 409 },
    );
  }

  console.info(`action=shoutout-reject route=web row=${id} operator=${operator}`);
  return NextResponse.json({ ok: true });
}
