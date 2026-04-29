// POST /api/internal/shoutout
//
// Called by the public site (Vercel) after it has rate-limited + moderated a
// listener booth submission. Generates TTS, airs on stream, and updates the
// already-created "Shoutout" row with the delivery outcome.
//
// Auth: shared secret in `x-internal-secret` header (same INTERNAL_API_SECRET
// used by /api/internal/track-started). Must be added to the Cloudflare tunnel
// ingress so Vercel can reach it (api.numaradio.com/internal/* → :3001).

import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";
import { generateShoutout, ShoutoutError } from "@/lib/shoutout";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: {
    shoutoutRowId?: unknown;
    text?: unknown;
    requesterName?: unknown;
    requestId?: unknown;
    skipHumanize?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const shoutoutRowId =
    typeof body.shoutoutRowId === "string" ? body.shoutoutRowId : null;
  const text = typeof body.text === "string" ? body.text : "";
  const requesterName =
    typeof body.requesterName === "string" ? body.requesterName : undefined;
  const requestId =
    typeof body.requestId === "string" ? body.requestId : undefined;
  const skipHumanize = body.skipHumanize === true;

  if (!shoutoutRowId) {
    return NextResponse.json(
      { ok: false, error: "shoutoutRowId required" },
      { status: 400 },
    );
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });
  }

  const pool = getDbPool();

  // Ensure the Shoutout row exists and is in a generateable state.
  const lookup = await pool.query<{ id: string; deliveryStatus: string }>(
    'SELECT id, "deliveryStatus" FROM "Shoutout" WHERE id = $1 LIMIT 1',
    [shoutoutRowId],
  );
  const row = lookup.rows[0];
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "shoutout row not found" },
      { status: 404 },
    );
  }
  if (row.deliveryStatus === "aired") {
    return NextResponse.json(
      { ok: false, error: "shoutout already aired" },
      { status: 409 },
    );
  }

  let result;
  try {
    result = await generateShoutout({
      text,
      source: { kind: "booth", shoutoutRowId, requesterName },
      requestId,
      pool,
      skipHumanize,
    });
  } catch (e) {
    if (e instanceof ShoutoutError) {
      await pool.query(
        `UPDATE "Shoutout" SET "deliveryStatus" = 'failed', "updatedAt" = NOW()
         WHERE id = $1`,
        [shoutoutRowId],
      );
      return NextResponse.json(
        { ok: false, error: e.message, code: e.code },
        { status: e.status },
      );
    }
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[shoutout:internal]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  await pool.query(
    `UPDATE "Shoutout"
       SET "deliveryStatus" = 'aired',
           "linkedQueueItemId" = $2,
           "broadcastText" = $3,
           "updatedAt" = NOW()
     WHERE id = $1`,
    // Store what Lena ACTUALLY said on air (post-humanize + radio-host
    // transform), not the raw listener input. The on-air log surfaces
    // broadcastText, and it should reflect what listeners heard.
    [shoutoutRowId, result.queueItemId, result.spokenText.slice(0, 500)],
  );

  console.info(
    `action=shoutout source=booth row=${shoutoutRowId} track=${result.trackId} queue=${result.queueItemId}`,
  );

  return NextResponse.json({
    ok: true,
    trackId: result.trackId,
    sourceUrl: result.sourceUrl,
    queueItemId: result.queueItemId,
  });
}
