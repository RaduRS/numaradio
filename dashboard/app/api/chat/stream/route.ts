import {
  DASHBOARD_GROUP_JID,
  NANOCLAW_CHAT_URL,
  nanoclawHeaders,
} from "@/lib/chat-proxy";

export const dynamic = "force-dynamic";

/**
 * SSE pass-through to the NanoClaw HttpChannel. The browser opens an
 * EventSource here; we open a matching request upstream and pipe the
 * byte stream back unchanged. Node's fetch returns a ReadableStream for
 * the body which plugs directly into a Response.
 *
 * We do NOT read the upstream as text — that would block until the
 * upstream closes, defeating streaming.
 */
export async function GET(req: Request): Promise<Response> {
  const upstream = new URL(`${NANOCLAW_CHAT_URL}/chat/stream`);
  upstream.searchParams.set("groupJid", DASHBOARD_GROUP_JID);

  const controller = new AbortController();
  // Propagate client disconnect to the upstream request so NanoClaw can
  // unsubscribe cleanly instead of leaking a dead SSE subscriber.
  req.signal.addEventListener("abort", () => controller.abort(), {
    once: true,
  });

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      headers: nanoclawHeaders(),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "nanoclaw unreachable";
    // Render an inline SSE error frame so the EventSource sees a parseable
    // event — the UI listens for `event: error`.
    const frame = `event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`;
    return new Response(frame, {
      status: 502,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
      },
    });
  }

  if (!res.ok || !res.body) {
    const text = res.body ? await res.text() : "upstream returned no body";
    const frame = `event: error\ndata: ${JSON.stringify({
      message: `upstream ${res.status}: ${text.slice(0, 200)}`,
    })}\n\n`;
    return new Response(frame, {
      status: res.status,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
      },
    });
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
