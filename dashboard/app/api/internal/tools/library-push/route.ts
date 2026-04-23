import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";
import { resolvePushTarget, pushToDaemon } from "@/lib/library";

export const dynamic = "force-dynamic";

interface PushBody {
  trackId?: unknown;
  reason?: unknown;
  operator?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: PushBody;
  try {
    body = (await req.json()) as PushBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const trackId = typeof body.trackId === "string" ? body.trackId : "";
  const operator =
    typeof body.operator === "string" ? body.operator : "chat:unknown";
  const reasonText =
    typeof body.reason === "string" ? body.reason : "operator chat";
  if (!trackId) {
    return NextResponse.json(
      { ok: false, error: "trackId required" },
      { status: 400 },
    );
  }

  const target = await resolvePushTarget(trackId, getDbPool());
  if (!target) {
    return NextResponse.json(
      { ok: false, error: "track not found" },
      { status: 404 },
    );
  }
  if (
    target.airingPolicy !== "library" &&
    target.airingPolicy !== "request_only"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `track airingPolicy '${target.airingPolicy}' cannot be pushed`,
      },
      { status: 409 },
    );
  }
  if (!target.audioStreamUrl) {
    return NextResponse.json(
      { ok: false, error: "track has no audio_stream asset" },
      { status: 409 },
    );
  }

  const result = await pushToDaemon({
    trackId,
    sourceUrl: target.audioStreamUrl,
    reason: `${operator}: ${reasonText}`,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }
  console.info(
    `action=library-push source=chat operator=${operator} track=${trackId} queue=${result.queueItemId}`,
  );
  return NextResponse.json({
    ok: true,
    trackId,
    queueItemId: result.queueItemId,
    title: target.title ?? null,
  });
}
