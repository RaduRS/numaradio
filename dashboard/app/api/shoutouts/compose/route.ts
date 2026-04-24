// POST /api/shoutouts/compose
//
// Operator-only shortcut: airs an arbitrary shoutout immediately, no
// moderation, no rate limit. The dashboard sits behind Cloudflare Access so
// only authenticated operators can reach this route.
//
// The pipeline (radio-host rewrite → Deepgram TTS → B2 upload → queue push)
// takes ~10s. We respond in <1s with an optimistic success and run the
// pipeline in after() — mirrors the public booth submit. If the pipeline
// fails asynchronously it surfaces in the daemon's lastFailures log, which
// the /shoutouts page already renders in its On-Air Log.
//
// Logs the operator's CF Access email as `sender` in the Track provenance
// so every shoutout has a clear author.

import { after, NextResponse } from "next/server";
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

  after(async () => {
    try {
      const result = await generateShoutout({
        text: rawText,
        source: { kind: "agent", sender: `dashboard:${operator}` },
        pool: getDbPool(),
      });
      console.info(
        `action=shoutout source=dashboard operator=${operator} track=${result.trackId} queue=${result.queueItemId}`,
      );
    } catch (e) {
      if (e instanceof ShoutoutError) {
        console.warn(
          `[shoutout:compose] ${e.code} (${e.status}) operator=${operator}: ${e.message}`,
        );
        return;
      }
      const msg = e instanceof Error ? e.message : "unknown error";
      console.error(`[shoutout:compose] operator=${operator}:`, msg);
    }
  });

  return NextResponse.json({
    ok: true,
    message: "Queued — Lena will read it next.",
  });
}
