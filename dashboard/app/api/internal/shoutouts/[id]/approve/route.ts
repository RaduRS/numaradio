import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDbPool } from "@/lib/db";
import { approveShoutout } from "@/lib/shoutouts-ops";
import { generateShoutout, ShoutoutError } from "@/lib/shoutout";

export const dynamic = "force-dynamic";

interface EncodedShoutoutError {
  kind: "ShoutoutError";
  status: number;
  code: string;
  message: string;
}

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
  const pool = getDbPool();

  const result = await approveShoutout({
    id,
    operator: "telegram:nanoclaw",
    pool,
    generate: async ({ text, shoutoutRowId, requesterName, pool: p }) => {
      try {
        return await generateShoutout({
          text,
          source: { kind: "booth", shoutoutRowId, requesterName },
          pool: p,
        });
      } catch (e) {
        if (e instanceof ShoutoutError) {
          const encoded: EncodedShoutoutError = {
            kind: "ShoutoutError",
            status: e.status,
            code: e.code,
            message: e.message,
          };
          throw new Error(JSON.stringify(encoded));
        }
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
    `action=shoutout-approve route=internal row=${id} operator=telegram:nanoclaw queue=${result.queueItemId}`,
  );
  return NextResponse.json({
    ok: true,
    trackId: result.trackId,
    queueItemId: result.queueItemId,
  });
}
