import type { ChatContext } from "./chat-context.ts";
import type { ChatDecision } from "./modes.ts";
import { buildChatProducerPrompt } from "./producer-prompt.ts";

const VALID_MODES = ["answer", "callback"] as const;

export interface ChatProducerDeps {
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

function safeDefault(): ChatDecision {
  return { mode: "answer", targetFocus: "respond directly", callbackTo: null, lengthHint: "short", tone: "warm" };
}

function parseDecision(raw: string, validIds: ReadonlySet<string>): ChatDecision | null {
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
  const cb = typeof o.callback_to === "string" && validIds.has(o.callback_to) ? o.callback_to : null;
  return {
    mode: o.mode as ChatDecision["mode"],
    targetFocus: o.target_focus,
    callbackTo: cb,
    lengthHint: o.length_hint as ChatDecision["lengthHint"],
    tone: o.tone as ChatDecision["tone"],
  };
}

export async function runChatProducer(ctx: ChatContext, deps: ChatProducerDeps): Promise<ChatDecision> {
  const validIds = new Set(ctx.recentShoutouts.map((s) => s.id));
  const baseline = buildChatProducerPrompt(ctx);

  try {
    const raw = await deps.llm(baseline);
    const p = parseDecision(raw, validIds);
    if (p) return p;
  } catch { /* fall through */ }

  const reinforced = { system: baseline.system, user: `${baseline.user}\n\nIMPORTANT: Output strict JSON only. mode MUST be "answer" or "callback".` };
  try {
    const raw = await deps.llm(reinforced);
    const p = parseDecision(raw, validIds);
    if (p) return p;
  } catch { /* fall through */ }

  return safeDefault();
}
