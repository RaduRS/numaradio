// POST /api/internal/lena-queue
//
// Internal mirror of /api/library/push that the public site (Vercel)
// can reach via cloudflared (api.numaradio.com/api/internal/lena-queue).
// Auth: shared INTERNAL_API_SECRET via x-internal-secret header.
//
// Critical: this is the ONLY safe path for Phase 5b listener requests.
// Calling pushToDaemon goes through the daemon's pushHandler, which
// writes the QueueItem AND telnets to Liquidsoap AND tracks status.
// Writing QueueItem rows directly (the old createQueueItemAtomically
// path) bypasses the telnet push, so the reconciler treats the row
// as "still needs push" and re-fires it every cycle.

import { NextResponse } from "next/server";
import { resolvePushTarget, pushToDaemon } from "@/lib/library";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { trackId?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const trackId = typeof body.trackId === "string" ? body.trackId : null;
  const reason = typeof body.reason === "string" ? body.reason : "lena_request";
  if (!trackId) {
    return NextResponse.json({ ok: false, error: "trackId required" }, { status: 400 });
  }

  let target;
  try {
    target = await resolvePushTarget(trackId, getDbPool());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "db query failed" },
      { status: 503 },
    );
  }
  if (!target) {
    return NextResponse.json({ ok: false, error: "track not found" }, { status: 404 });
  }
  if (target.airingPolicy !== "library" && target.airingPolicy !== "request_only") {
    return NextResponse.json(
      { ok: false, error: `airingPolicy=${target.airingPolicy}` },
      { status: 409 },
    );
  }
  if (!target.audioStreamUrl) {
    return NextResponse.json(
      { ok: false, error: "no audio_stream asset" },
      { status: 409 },
    );
  }

  const result = await pushToDaemon({
    trackId: target.id,
    sourceUrl: target.audioStreamUrl,
    reason,
  });

  console.info(
    `action=lena-queue track=${target.id} title=${JSON.stringify(target.title)} reason=${reason} ok=${result.ok}`,
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, queueItemId: result.queueItemId });
}
