import { NextResponse } from "next/server";
import { resolvePushTarget, pushToDaemon } from "@/lib/library";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: { trackId?: unknown };
  try {
    body = (await req.json()) as { trackId?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const trackId = typeof body.trackId === "string" ? body.trackId : null;
  if (!trackId) {
    return NextResponse.json({ ok: false, error: "trackId required" }, { status: 400 });
  }

  let target;
  try {
    target = await resolvePushTarget(trackId, getDbPool());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "db query failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }

  if (!target) {
    return NextResponse.json({ ok: false, error: "track not found" }, { status: 404 });
  }
  // 'library' = currently in rotation; 'request_only' = aired once, awaiting
  // manual re-push (typically a listener-generated song). Both are valid push
  // targets. 'hold' and 'priority_request' are rejected — the former is
  // deliberately hidden, the latter is mid-pipeline and would double-queue.
  if (
    target.airingPolicy !== "library" &&
    target.airingPolicy !== "request_only"
  ) {
    return NextResponse.json(
      { ok: false, error: `track airingPolicy is '${target.airingPolicy}', cannot push` },
      { status: 409 },
    );
  }
  if (!target.audioStreamUrl) {
    return NextResponse.json(
      { ok: false, error: "track has no audio_stream asset" },
      { status: 409 },
    );
  }

  const user = req.headers.get("cf-access-authenticated-user-email") ?? "unknown";
  const result = await pushToDaemon({
    trackId: target.id,
    sourceUrl: target.audioStreamUrl,
    reason: `dashboard:${user}`,
  });

  console.info(
    `action=push track=${target.id} title=${JSON.stringify(target.title)} user=${user} ok=${result.ok}`,
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, title: target.title },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, queueItemId: result.queueItemId, title: target.title });
}
