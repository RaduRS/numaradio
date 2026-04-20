import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { generateShoutout, ShoutoutError } from "@/lib/shoutout";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: { text?: unknown; sender?: unknown; requestId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const rawText = typeof body.text === "string" ? body.text : "";
  const sender = typeof body.sender === "string" ? body.sender : undefined;
  const requestId =
    typeof body.requestId === "string" ? body.requestId : undefined;

  if (!rawText) {
    return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });
  }

  try {
    const result = await generateShoutout({
      text: rawText,
      source: { kind: "agent", sender },
      requestId,
      pool: getDbPool(),
    });

    console.info(
      `action=shoutout source=agent track=${result.trackId} sender=${sender ?? "-"} queue=${result.queueItemId}`,
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
    console.error("[shoutout:agent]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
