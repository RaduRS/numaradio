import { NextResponse } from "next/server";
import { internalAuthOk } from "@/lib/internal-auth";
import { fetchDaemonStatus } from "@/lib/library";

export const dynamic = "force-dynamic";

/**
 * Queue-daemon ring buffers — lastPushes and lastFailures. This is
 * the source of truth for auto-chatter events, music announces, and
 * track-push history (the stuff that doesn't live in the Shoutout
 * table). Same data the /shoutouts page's On-Air Log merges with the
 * shoutout rows to build its unified timeline.
 */
export async function GET(req: Request): Promise<NextResponse> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const status = await fetchDaemonStatus();
  return NextResponse.json({
    ok: true,
    lastPushes: status.lastPushes ?? [],
    lastFailures: status.lastFailures ?? [],
  });
}
