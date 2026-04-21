import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDbPool } from "@/lib/db";
import { rejectShoutout } from "@/lib/shoutouts-ops";

export const dynamic = "force-dynamic";

function authOk(req: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;
  const got = req.headers.get("x-internal-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!authOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  let body: { reasonHint?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // empty body is fine
  }
  const reasonHint =
    typeof body.reasonHint === "string" && body.reasonHint.trim().length > 0
      ? body.reasonHint.trim()
      : undefined;

  const result = await rejectShoutout({
    id,
    operator: "telegram:nanoclaw",
    pool: getDbPool(),
    reasonHint,
  });

  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 :
      409;
    return NextResponse.json({ ok: false, error: result.code }, { status });
  }

  console.info(
    `action=shoutout-reject route=internal row=${id} operator=telegram:nanoclaw hint=${reasonHint ?? ""}`,
  );
  return NextResponse.json({ ok: true });
}
