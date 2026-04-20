// POST /api/shoutouts/compose
//
// Operator-only shortcut: airs an arbitrary shoutout immediately, no
// moderation, no rate limit. The dashboard sits behind Cloudflare Access so
// only authenticated operators can reach this route.
//
// Logs the operator's CF Access email as `sender` in the Track provenance
// so every shoutout has a clear author.

import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { generateShoutout, ShoutoutError } from "@/lib/shoutout";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: { text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const rawText = typeof body.text === "string" ? body.text : "";
  if (!rawText) {
    return NextResponse.json(
      { ok: false, error: "text is required" },
      { status: 400 },
    );
  }

  const operator =
    req.headers.get("cf-access-authenticated-user-email") ?? "operator";

  try {
    const result = await generateShoutout({
      text: rawText,
      source: { kind: "agent", sender: `dashboard:${operator}` },
      pool: getDbPool(),
    });

    console.info(
      `action=shoutout source=dashboard operator=${operator} track=${result.trackId} queue=${result.queueItemId}`,
    );

    return NextResponse.json({
      ok: true,
      trackId: result.trackId,
      sourceUrl: result.sourceUrl,
      queueItemId: result.queueItemId,
      message: "Shoutout queued — Lena will read it next.",
    });
  } catch (e) {
    if (e instanceof ShoutoutError) {
      return NextResponse.json(
        { ok: false, error: e.message, code: e.code },
        { status: e.status },
      );
    }
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[shoutout:compose]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
