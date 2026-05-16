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
  /** Phase 5: the queue action Producer emitted, after QueueDirector validation.
   *  null when not a queue_pick OR when QueueDirector rejected. */
  queueActionPersisted: { trackId: string; reason: string } | null;
}

export interface LenaSpeakArgs {
  trigger: AutoTrackBoundaryTrigger;
  memory: ShiftMemory;
  llm: (prompts: { system: string; user: string }) => Promise<string>;
  nowMs: number;
  /** Phase 5: when present, Producer can emit queue_pick and director will insert. */
  catalogCandidates?: { id: string; title: string; artist: string | null; genre: string | null; bpm: number | null }[];
  /** Phase 5: validates + commits a queue insert. Returns true if inserted. */
  queueDirector?: (action: { trackId: string; reason: string }) => Promise<boolean>;
}

/**
 * Phase 2 public API for auto_track_boundary trigger.
 * Returns null when Producer picks silence OR when Writer fails — caller
 * (auto-host.ts) should fall back to the legacy single-call path on null.
 */
export async function lenaSpeak(args: LenaSpeakArgs): Promise<LenaResult | null> {
  const view = args.memory.view(args.nowMs);
  const ctx = buildProducerContext({
    memoryView: view,
    trigger: args.trigger,
    nowMs: args.nowMs,
    catalogCandidates: args.catalogCandidates ?? [],
  });

  const decision = await runProducer(ctx, { llm: args.llm });
  if (decision.mode === "silence") return null;

  // Phase 5: if Producer emitted queue_pick, ask QueueDirector to insert.
  // If director rejects, downgrade the line so it doesn't lie ("pulling up X"
  // with no insert = bad).
  let queueActionPersisted: LenaResult["queueActionPersisted"] = null;
  if (decision.mode === "queue_pick" && decision.queueAction && args.queueDirector) {
    const ok = await args.queueDirector({
      trackId: decision.queueAction.trackId,
      reason: decision.queueAction.reason,
    });
    if (ok) {
      queueActionPersisted = {
        trackId: decision.queueAction.trackId,
        reason: decision.queueAction.reason,
      };
    } else {
      // Director rejected. Strip queue_action from decision so the Writer
      // produces a non-pick line, AND change mode to aside to avoid the
      // queue_pick writer trying to announce a phantom track.
      decision.queueAction = null;
      decision.mode = "aside";
      decision.targetFocus = "general moment";
    }
  }

  const recentAiredLines = view.recentLines.slice(0, 5).map((l) => l.text);
  try {
    const text = await runWriter(decision, ctx, recentAiredLines, { llm: args.llm });
    if (!text) return null;
    return { text, mode: decision.mode, targetFocus: decision.targetFocus, queueActionPersisted };
  } catch {
    return null;
  }
}
