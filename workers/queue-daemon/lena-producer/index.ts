// workers/queue-daemon/lena-producer/index.ts

import type { ProducerMode } from "./shift-event.ts";
import type { AutoTrackBoundaryTrigger } from "./producer-context.ts";
import { buildProducerContext } from "./producer-context.ts";
import { runProducer } from "./producer.ts";
import { runWriter } from "./writer.ts";
import { ShiftMemory } from "./shift-memory.ts";

export interface LenaResult {
  text: string;
  mode: ProducerMode;
  /** What the Producer was focused on — useful for logs / debugging. */
  targetFocus: string;
}

export interface LenaSpeakArgs {
  trigger: AutoTrackBoundaryTrigger;
  memory: ShiftMemory;
  llm: (prompts: { system: string; user: string }) => Promise<string>;
  nowMs: number;
}

/**
 * Phase 2 public API for auto_track_boundary trigger.
 * Returns null when Producer picks silence OR when Writer fails — caller
 * (auto-host.ts) should fall back to the legacy single-call path on null.
 */
export async function lenaSpeak(args: LenaSpeakArgs): Promise<LenaResult | null> {
  const view = args.memory.view(args.nowMs);
  const ctx = buildProducerContext({ memoryView: view, trigger: args.trigger, nowMs: args.nowMs });

  const decision = await runProducer(ctx, { llm: args.llm });
  if (decision.mode === "silence") return null;

  const recentAiredLines = view.recentLines.slice(0, 5).map((l) => l.text);
  try {
    const text = await runWriter(decision, ctx, recentAiredLines, { llm: args.llm });
    if (!text) return null;
    return { text, mode: decision.mode, targetFocus: decision.targetFocus };
  } catch {
    return null;
  }
}
