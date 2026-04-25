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

// Allowlist of "yellow-light" actions that the agent can ask the
// operator to confirm. Anything outside this map is rejected — see
// docs/superpowers/specs/2026-04-23-dashboard-nanoclaw-chat-design.md
// section "Yellow-light actions" for the design rationale.
const ACTION_ROUTES: Record<string, string> = {
  "service.restart": "/api/internal/tools/service-restart",
  "shoutout.reject": "/api/internal/tools/shoutout-reject",
};

// Per-action arg schemas. Validates that the agent (or anyone POSTing
// to /api/chat/confirm) supplies args of the expected shape before we
// forward to a tool route. Defense-in-depth — the tool endpoints
// re-validate too, but rejecting here means a malformed agent request
// doesn't reach the tool.
function validateArgs(
  action: string,
  args: Record<string, unknown>,
): string | null {
  if (action === "service.restart") {
    if (typeof args.service !== "string" || args.service.length === 0) {
      return "service.restart requires args.service (string)";
    }
    return null;
  }
  if (action === "shoutout.reject") {
    if (typeof args.id !== "string" || args.id.length === 0) {
      return "shoutout.reject requires args.id (string)";
    }
    return null;
  }
  return `unknown action: ${action}`;
}

// Sanitize action / confirmId values that go into the inline system
// message we inject back into NanoClaw. Strip anything that isn't
// alnum / dot / dash / underscore — those are the only characters
// the legitimate values use, and stripping the rest closes any
// hypothetical "smuggle a newline / bracket" injection if a future
// agent generates a hostile id.
function safeTag(s: string, max = 64): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "").slice(0, max);
}

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

  const safeId = safeTag(confirmId);
  const safeAction = safeTag(action);

  if (decision === "cancel") {
    await injectIntoGroup(`[cancelled confirm ${safeId} action=${safeAction}]`);
    return NextResponse.json({ ok: true, decision });
  }

  const route = ACTION_ROUTES[action];
  if (!route) {
    return NextResponse.json(
      { ok: false, error: `action '${action}' is not confirmable from chat` },
      { status: 400 },
    );
  }
  const argsErr = validateArgs(action, args);
  if (argsErr) {
    return NextResponse.json({ ok: false, error: argsErr }, { status: 400 });
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
      `[confirmed ${safeId} action=${safeAction} result=failed error=${msg.slice(0, 200)}]`,
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
    `[confirmed ${safeId} action=${safeAction} result=${summary}]`,
  );

  return NextResponse.json(
    { ok: toolRes.ok, decision, action, tool: toolJson },
    { status: toolRes.ok ? 200 : toolRes.status },
  );
}
