import { NextResponse } from "next/server";
import {
  DASHBOARD_GROUP_JID,
  NANOCLAW_CHAT_URL,
  nanoclawHeaders,
} from "@/lib/chat-proxy";

export const dynamic = "force-dynamic";

/**
 * Resolve a yellow-light confirmation card.
 *
 * The agent emitted a `<confirm action="foo.bar" args=… id=…>Prompt</confirm>`
 * tag. The UI rendered a Confirm/Cancel card. The operator clicked a button;
 * the browser POSTs here. We:
 *
 *   1. If `approve`, actually invoke the matching internal tool route (so
 *      the audit trail and effects happen here, not in the agent's container).
 *   2. Inject a synthetic operator message back into the NanoClaw group so
 *      the agent's next turn sees the resolution.
 *   3. Return the tool's response to the UI for immediate feedback.
 *
 * Mapping `action → route` lives here as an allowlist: only these actions
 * can be confirmed. Anything else returns 400.
 */

interface ConfirmBody {
  decision?: unknown;
  args?: unknown;
  action?: unknown;
}

const ACTION_ROUTES: Record<string, string> = {
  "service.restart": "/api/internal/tools/service-restart",
  "shoutout.reject": "/api/internal/tools/shoutout-reject",
};

function internalUrl(req: Request, path: string): string {
  const origin = new URL(req.url).origin;
  return `${origin}${path}`;
}

async function injectIntoGroup(text: string): Promise<void> {
  try {
    await fetch(`${NANOCLAW_CHAT_URL}/chat/inject`, {
      method: "POST",
      headers: {
        ...nanoclawHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        groupJid: DASHBOARD_GROUP_JID,
        senderName: "system",
        text,
      }),
      cache: "no-store",
    });
  } catch {
    // Best-effort — if NanoClaw is down, the operator will still see the
    // resolution in the UI and can retry.
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ confirmId: string }> },
): Promise<NextResponse> {
  const { confirmId } = await ctx.params;
  let body: ConfirmBody;
  try {
    body = (await req.json()) as ConfirmBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const decision = body.decision;
  const action = typeof body.action === "string" ? body.action : "";
  const args =
    body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};
  const operator =
    req.headers.get("cf-access-authenticated-user-email") ?? "operator";

  if (decision !== "approve" && decision !== "cancel") {
    return NextResponse.json(
      { ok: false, error: "decision must be 'approve' or 'cancel'" },
      { status: 400 },
    );
  }

  if (decision === "cancel") {
    await injectIntoGroup(`[cancelled confirm ${confirmId} action=${action}]`);
    return NextResponse.json({ ok: true, decision });
  }

  const route = ACTION_ROUTES[action];
  if (!route) {
    return NextResponse.json(
      { ok: false, error: `action '${action}' is not confirmable from chat` },
      { status: 400 },
    );
  }

  let toolRes: Response;
  try {
    toolRes = await fetch(internalUrl(req, route), {
      method: "POST",
      headers: {
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...args,
        operator: `dashboard:${operator}`,
      }),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "tool unreachable";
    await injectIntoGroup(
      `[confirmed ${confirmId} action=${action} result=failed error=${msg.slice(0, 200)}]`,
    );
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 502 },
    );
  }

  const toolJson = await toolRes.json().catch(() => ({ ok: false, error: "non-json" }));
  const summary = toolRes.ok
    ? `ok ${JSON.stringify(toolJson).slice(0, 200)}`
    : `failed ${JSON.stringify(toolJson).slice(0, 200)}`;
  await injectIntoGroup(
    `[confirmed ${confirmId} action=${action} result=${summary}]`,
  );

  return NextResponse.json(
    { ok: toolRes.ok, decision, action, tool: toolJson },
    { status: toolRes.ok ? 200 : toolRes.status },
  );
}
