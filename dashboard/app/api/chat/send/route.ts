import { NextResponse } from "next/server";
import {
  DASHBOARD_GROUP_JID,
  NANOCLAW_CHAT_URL,
  nanoclawHeaders,
} from "@/lib/chat-proxy";

export const dynamic = "force-dynamic";

interface SendBody {
  text?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json(
      { ok: false, error: "text is required" },
      { status: 400 },
    );
  }
  const operator =
    req.headers.get("cf-access-authenticated-user-email") ?? "operator";

  let res: Response;
  try {
    res = await fetch(`${NANOCLAW_CHAT_URL}/chat/send`, {
      method: "POST",
      headers: {
        ...nanoclawHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        groupJid: DASHBOARD_GROUP_JID,
        senderName: `dashboard:${operator}`,
        sender: operator,
        text,
      }),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "nanoclaw unreachable";
    return NextResponse.json(
      { ok: false, error: `producer offline: ${msg}` },
      { status: 502 },
    );
  }

  const payload = await res.text();
  return new NextResponse(payload, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
