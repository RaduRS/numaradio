import type { ChatContext } from "./chat-context.ts";
import type { ChatDecision } from "./modes.ts";
import { buildChatProducerPrompt } from "./producer-prompt.ts";

const VALID_MODES = [
  "answer",
  "callback",
  "accept_request",
  "accept_request_deferred",
  "decline_request",
] as const;

const VALID_DECLINE_REASONS = [
  "recently_aired",
  "not_in_catalog",
  "wrong_show_block",
  "same_artist_too_soon",
  "queue_full",
] as const;

export interface ChatProducerDeps {
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

function safeDefault(ctx: ChatContext): ChatDecision {
  const isRequest = ctx.trigger.intent === "request" || ctx.trigger.intent === "shoutout_with_request";
  if (isRequest) {
    return {
      mode: "decline_request",
      targetFocus: "couldn't find that one",
      callbackTo: null,
      lengthHint: "short",
      tone: "warm",
      pickedTrackId: null,
      declineReason: "not_in_catalog",
    };
  }
  return {
    mode: "answer",
    targetFocus: "respond directly",
    callbackTo: null,
    lengthHint: "short",
    tone: "warm",
    pickedTrackId: null,
    declineReason: null,
  };
}

function parseDecision(
  raw: string,
  validCallbackIds: ReadonlySet<string>,
  validCatalogIds: ReadonlySet<string>,
): ChatDecision | null {
  let json: unknown;
  try {
    json = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.mode !== "string") return null;
  if (!VALID_MODES.includes(o.mode as never)) return null;
  if (typeof o.target_focus !== "string") return null;
  if (typeof o.length_hint !== "string" || !["short", "medium"].includes(o.length_hint)) return null;
  if (typeof o.tone !== "string" || !["dry", "warm", "playful", "low-key"].includes(o.tone)) return null;

  const mode = o.mode as ChatDecision["mode"];
  const cb = typeof o.callback_to === "string" && validCallbackIds.has(o.callback_to) ? o.callback_to : null;

  const pickedTrackIdRaw = o.picked_track_id;
  const pickedTrackId =
    typeof pickedTrackIdRaw === "string" && validCatalogIds.has(pickedTrackIdRaw)
      ? pickedTrackIdRaw
      : null;

  const declineReasonRaw = o.decline_reason;
  const declineReason =
    typeof declineReasonRaw === "string" && VALID_DECLINE_REASONS.includes(declineReasonRaw as never)
      ? (declineReasonRaw as ChatDecision["declineReason"])
      : null;

  // Mode-consistency checks
  if ((mode === "accept_request" || mode === "accept_request_deferred") && !pickedTrackId) return null;
  if (mode === "decline_request" && !declineReason) return null;

  return {
    mode,
    targetFocus: o.target_focus,
    callbackTo: cb,
    lengthHint: o.length_hint as ChatDecision["lengthHint"],
    tone: o.tone as ChatDecision["tone"],
    pickedTrackId,
    declineReason,
  };
}

export async function runChatProducer(ctx: ChatContext, deps: ChatProducerDeps): Promise<ChatDecision> {
  const validCallbackIds = new Set(ctx.recentShoutouts.map((s) => s.id));
  const validCatalogIds = new Set(ctx.catalogCandidates.map((c) => c.id));
  const baseline = buildChatProducerPrompt(ctx);

  try {
    const raw = await deps.llm(baseline);
    const p = parseDecision(raw, validCallbackIds, validCatalogIds);
    if (p) return p;
  } catch { /* fall through */ }

  const reinforced = {
    system: baseline.system,
    user: `${baseline.user}\n\nIMPORTANT: Output strict JSON only. Follow the schema in the system prompt exactly.`,
  };
  try {
    const raw = await deps.llm(reinforced);
    const p = parseDecision(raw, validCallbackIds, validCatalogIds);
    if (p) return p;
  } catch { /* fall through */ }

  return safeDefault(ctx);
}
