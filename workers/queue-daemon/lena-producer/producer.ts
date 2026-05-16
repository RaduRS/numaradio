// workers/queue-daemon/lena-producer/producer.ts

import type { ProducerContext } from "./producer-context.ts";
import { PHASE_2_MODES, type ProducerDecision } from "./modes.ts";
import { buildProducerPrompt } from "./producer-prompt.ts";
import { safeDefaultDecision } from "./fallbacks.ts";

export interface ProducerDeps {
  /** Single-call LLM that returns the model's text. The producer wraps it with JSON parse + validate + retry. */
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

function parseDecision(
  raw: string,
  validCallbackIds: ReadonlySet<string>,
): ProducerDecision | null {
  let json: unknown;
  try {
    json = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.mode !== "string") return null;
  if (!PHASE_2_MODES.includes(o.mode as never)) return null;
  if (typeof o.target_focus !== "string") return null;
  if (typeof o.length_hint !== "string" || !["short", "medium", "long"].includes(o.length_hint)) return null;
  if (typeof o.tone !== "string" || !["dry", "warm", "playful", "low-key"].includes(o.tone)) return null;
  const callbackToRaw = o.callback_to;
  const callbackTo =
    typeof callbackToRaw === "string" && validCallbackIds.has(callbackToRaw)
      ? callbackToRaw
      : null;
  return {
    mode: o.mode as ProducerDecision["mode"],
    targetFocus: o.target_focus,
    callbackTo,
    lengthHint: o.length_hint as ProducerDecision["lengthHint"],
    tone: o.tone as ProducerDecision["tone"],
    addressListener: null, // auto_track_boundary
    queueAction: null, // Phase 5 (T4) will populate this for mode='queue_pick'
  };
}

export async function runProducer(
  ctx: ProducerContext,
  deps: ProducerDeps,
): Promise<ProducerDecision> {
  const validIds = new Set(ctx.callbackPool.map((c) => c.id));
  const baseline = buildProducerPrompt(ctx);

  // Attempt 1
  try {
    const raw = await deps.llm(baseline);
    const parsed = parseDecision(raw, validIds);
    if (parsed) return parsed;
  } catch {
    // fall through to retry
  }

  // Attempt 2 — reinforce JSON output
  const reinforced = {
    system: baseline.system,
    user: `${baseline.user}\n\nIMPORTANT: Output strict JSON only. No prose. No markdown.`,
  };
  try {
    const raw = await deps.llm(reinforced);
    const parsed = parseDecision(raw, validIds);
    if (parsed) return parsed;
  } catch {
    // fall through to safe default
  }

  return safeDefaultDecision({ source: ctx.trigger.source });
}
