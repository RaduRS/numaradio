import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { internalAuthOk } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

// Mirrors workers/queue-daemon/lena-producer/shift-event.ts.
// HTTP fallback for emitters that can't easily call pg_notify
// (third-party webhooks, future cross-process work). Posts an event,
// the route emits the NOTIFY on the lena_event channel.
const VALID_TYPES = new Set([
  "track_aired",
  "lena_line_aired",
  "shoutout_aired",
  "youtube_mention",
  "operator_force",
]);

export async function POST(req: Request): Promise<Response> {
  if (!internalAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { type?: unknown }).type !== "string"
  ) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }
  if (!VALID_TYPES.has((body as { type: string }).type)) {
    return NextResponse.json({ error: "unknown_type" }, { status: 400 });
  }
  try {
    await prisma.$executeRawUnsafe(
      `SELECT pg_notify('lena_event', $1)`,
      JSON.stringify(body),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("[lena-event] NOTIFY failed:", err);
    return NextResponse.json({ error: "notify_failed" }, { status: 500 });
  }
}
