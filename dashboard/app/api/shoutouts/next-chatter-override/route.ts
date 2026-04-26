// Operator one-shot override for the next auto-chatter break.
//
// Dashboard's /shoutouts page lets the operator click any chip in the
// "Next up" preview to force the next chatter type. Daemon's state
// machine consumes the override on the next break, then the rotation
// resumes normally.
//
// This is just a thin proxy from the dashboard's CF-Access-protected
// surface to the daemon's loopback HTTP endpoint.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DAEMON_URL = process.env.NUMA_DAEMON_URL ?? "http://127.0.0.1:4000";

const VALID_TYPES = new Set([
  "back_announce",
  "shoutout_cta",
  "song_cta",
  "filler",
  "world_aside",
]);

export async function POST(req: Request): Promise<NextResponse> {
  let body: { type?: unknown };
  try {
    body = (await req.json()) as { type?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (typeof body.type !== "string" || !VALID_TYPES.has(body.type)) {
    return NextResponse.json(
      { ok: false, error: "type must be one of " + [...VALID_TYPES].join(", ") },
      { status: 400 },
    );
  }

  const user = req.headers.get("cf-access-authenticated-user-email") ?? "unknown";
  console.info(`action=chatter_override_set type=${body.type} user=${user}`);

  try {
    const r = await fetch(`${DAEMON_URL}/chatter-override`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: body.type }),
      signal: AbortSignal.timeout(2_000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `daemon ${r.status}: ${text}` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, type: body.type });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "daemon unreachable" },
      { status: 502 },
    );
  }
}
