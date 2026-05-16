import type { ShoutoutContext } from "./shoutout-context";
import type { ShoutoutDecision } from "./modes";
import { buildShoutoutProducerPrompt } from "./producer-prompt";

const VALID_MODES = ["shoutout_classic", "shoutout_inline", "shoutout_quote", "shoutout_callback"] as const;

export interface ShoutoutProducerDeps {
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

function safeDefault(): ShoutoutDecision {
  return { mode: "shoutout_classic", targetFocus: "read the shoutout", callbackTo: null, lengthHint: "short", tone: "warm" };
}

function parseDecision(raw: string, validIds: ReadonlySet<string>): ShoutoutDecision | null {
  let json: unknown;
  try { json = JSON.parse(raw.trim()); } catch { return null; }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.mode !== "string" || !VALID_MODES.includes(o.mode as never)) return null;
  if (typeof o.target_focus !== "string") return null;
  if (typeof o.length_hint !== "string" || !["short", "medium"].includes(o.length_hint)) return null;
  if (typeof o.tone !== "string" || !["dry", "warm", "playful", "low-key"].includes(o.tone)) return null;
  const cb = typeof o.callback_to === "string" && validIds.has(o.callback_to) ? o.callback_to : null;
  return {
    mode: o.mode as ShoutoutDecision["mode"],
    targetFocus: o.target_focus,
    callbackTo: cb,
    lengthHint: o.length_hint as ShoutoutDecision["lengthHint"],
    tone: o.tone as ShoutoutDecision["tone"],
  };
}

export async function runShoutoutProducer(ctx: ShoutoutContext, deps: ShoutoutProducerDeps): Promise<ShoutoutDecision> {
  const validIds = new Set([...ctx.recentShoutouts.map((s) => s.id), ...ctx.recentLenaLines.map((_, i) => `line_${i}`)]);
  const baseline = buildShoutoutProducerPrompt(ctx);

  try {
    const raw = await deps.llm(baseline);
    const p = parseDecision(raw, validIds);
    if (p) return p;
  } catch { /* fall through */ }

  const reinforced = { system: baseline.system, user: `${baseline.user}\n\nIMPORTANT: Output strict JSON only. mode MUST be one of the four shoutout shapes.` };
  try {
    const raw = await deps.llm(reinforced);
    const p = parseDecision(raw, validIds);
    if (p) return p;
  } catch { /* fall through */ }

  return safeDefault();
}
