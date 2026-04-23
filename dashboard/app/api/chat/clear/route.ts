import { NextResponse } from "next/server";
import {
  DASHBOARD_GROUP_JID,
  NANOCLAW_CHAT_URL,
  nanoclawHeaders,
} from "@/lib/chat-proxy";

export const dynamic = "force-dynamic";

/**
 * Clears the transcript from the operator's view by writing a cutoff
 * timestamp into NanoClaw's router_state. Memory (global + group) is
 * untouched — Lena's producer still remembers everything. Stored
 * messages aren't deleted either; they just drop out of /chat/history
 * responses after this cutoff.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const operator =
    req.headers.get("cf-access-authenticated-user-email") ?? "operator";

  try {
    const res = await fetch(`${NANOCLAW_CHAT_URL}/chat/clear`, {
      method: "POST",
      headers: {
        ...nanoclawHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ groupJid: DASHBOARD_GROUP_JID }),
      cache: "no-store",
    });
    const payload = await res.text();
    console.info(
      `action=chat-clear operator=${operator} status=${res.status}`,
    );
    return new NextResponse(payload, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "nanoclaw unreachable";
    return NextResponse.json(
      { ok: false, error: `producer offline: ${msg}` },
      { status: 502 },
    );
  }
}
