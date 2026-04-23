import { NextResponse } from "next/server";
import {
  DASHBOARD_GROUP_JID,
  NANOCLAW_CHAT_URL,
  nanoclawHeaders,
} from "@/lib/chat-proxy";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const limit = Math.max(
    1,
    Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50),
  );
  const upstream = new URL(`${NANOCLAW_CHAT_URL}/chat/history`);
  upstream.searchParams.set("groupJid", DASHBOARD_GROUP_JID);
  upstream.searchParams.set("limit", String(limit));

  try {
    const res = await fetch(upstream.toString(), {
      headers: nanoclawHeaders(),
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "nanoclaw unreachable";
    return NextResponse.json(
      { ok: false, error: `producer offline: ${msg}`, turns: [] },
      { status: 502 },
    );
  }
}
