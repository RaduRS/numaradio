import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";
import { approveShoutout } from "@/lib/shoutouts-ops";
import { generateShoutout, ShoutoutError } from "@/lib/shoutout";

export const dynamic = "force-dynamic";

interface EncodedShoutoutError {
  kind: "ShoutoutError";
  status: number;
  code: string;
  message: string;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
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
