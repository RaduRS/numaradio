import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { getShoutout } from "@/lib/shoutouts";
import { generateShoutout, ShoutoutError } from "@/lib/shoutout";

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
  if (existing.moderationStatus !== "held") {
    return NextResponse.json(
      { ok: false, error: `not held (status=${existing.moderationStatus})` },
      { status: 409 },
    );
  }

  const operator =
    req.headers.get("cf-access-authenticated-user-email") ?? "operator";

  // Flip moderation to allowed before we try to generate, so a crash mid-flight
  // leaves a trail. deliveryStatus flips on the final update below.
  await pool.query(
    `UPDATE "Shoutout"
        SET "moderationStatus" = 'allowed',
            "moderationReason" = $2,
            "deliveryStatus"   = 'pending',
            "updatedAt"        = NOW()
      WHERE id = $1`,
    [id, `approved_by:${operator}`],
  );

  const text = (existing.cleanText ?? existing.rawText).trim();

  let result;
  try {
    result = await generateShoutout({
      text,
      source: {
        kind: "booth",
        shoutoutRowId: id,
        requesterName: existing.requesterName ?? undefined,
      },
      pool,
    });
  } catch (e) {
    await pool.query(
      `UPDATE "Shoutout"
          SET "deliveryStatus"   = 'failed',
              "moderationReason" = $2,
              "updatedAt"        = NOW()
        WHERE id = $1`,
      [id, e instanceof Error ? e.message.slice(0, 200) : "generate_failed"],
    );
    if (e instanceof ShoutoutError) {
      return NextResponse.json(
        { ok: false, error: e.message, code: e.code },
        { status: e.status },
      );
    }
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  await pool.query(
    `UPDATE "Shoutout"
        SET "deliveryStatus"    = 'aired',
            "linkedQueueItemId" = $2,
            "broadcastText"     = $3,
            "updatedAt"         = NOW()
      WHERE id = $1`,
    [id, result.queueItemId, text.slice(0, 500)],
  );

  console.info(
    `action=shoutout-approve row=${id} operator=${operator} queue=${result.queueItemId}`,
  );

  return NextResponse.json({
    ok: true,
    trackId: result.trackId,
    queueItemId: result.queueItemId,
  });
}
