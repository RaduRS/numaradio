import { NextResponse } from "next/server";
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

function decodeShoutoutError(msg: string): EncodedShoutoutError | null {
  if (!msg.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(msg);
    if (parsed && parsed.kind === "ShoutoutError") {
      return parsed as EncodedShoutoutError;
    }
  } catch {
    // fall through
  }
  return null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const pool = getDbPool();
  // CF Access is the auth boundary; we just record the email it
  // forwarded for the audit log. Fall back to "operator" if the
  // header is missing or doesn't even contain an @, so a misconfig
  // (or a request that bypasses CF Access) lands a meaningful audit
  // value rather than a literal "true" / random string.
  const rawEmail = req.headers.get("cf-access-authenticated-user-email") ?? "";
  const operator = /^[^@\s]+@[^@\s]+$/.test(rawEmail) ? rawEmail : "operator";

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
    if (result.code === "not_found") {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    if (result.code === "already_aired") {
      return NextResponse.json(
        { ok: false, error: "already aired" },
        { status: 409 },
      );
    }
    if (result.code === "not_held") {
      return NextResponse.json(
        { ok: false, error: "not held" },
        { status: 409 },
      );
    }
    const msg = result.error ?? "generate_failed";
    const decoded = decodeShoutoutError(msg);
    if (decoded) {
      return NextResponse.json(
        { ok: false, error: decoded.message, code: decoded.code },
        { status: decoded.status || 500 },
      );
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  console.info(
    `action=shoutout-approve route=web row=${id} operator=${operator} queue=${result.queueItemId}`,
  );
  return NextResponse.json({
    ok: true,
    trackId: result.trackId,
    queueItemId: result.queueItemId,
  });
}
