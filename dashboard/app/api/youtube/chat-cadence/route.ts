import { NextRequest, NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATION_SLUG = process.env.STATION_SLUG ?? "numaradio";

// Hard floor matches the daemon's MIN_POLL_MS — anything tighter is
// a quota footgun. Hard ceiling is 10 min; longer than that the
// shoutout latency would feel broken.
const MIN_MS = 15_000;
const MAX_MS = 600_000;

export async function POST(req: NextRequest) {
  let body: { youtubeChatPollMs?: number };
  try {
    body = (await req.json()) as { youtubeChatPollMs?: number };
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const ms = Number(body.youtubeChatPollMs);
  if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS) {
    return NextResponse.json(
      { error: `youtubeChatPollMs must be between ${MIN_MS} and ${MAX_MS}` },
      { status: 400 },
    );
  }
  const intMs = Math.round(ms);
  await getDbPool().query(
    `UPDATE "Station" SET "youtubeChatPollMs" = $1, "updatedAt" = NOW() WHERE slug = $2`,
    [intMs, STATION_SLUG],
  );
  return NextResponse.json({ ok: true, youtubeChatPollMs: intMs });
}
