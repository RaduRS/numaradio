// workers/queue-daemon/lena-producer/modes.ts

import type { ProducerMode } from "./shift-event.ts";

/**
 * The Producer's structured decision about how Lena responds right now.
 * For Phase 2 (auto_track_boundary only) the queue_action field is always
 * null — Phase 5's QueueDirector populates it.
 */
export interface ProducerDecision {
  mode: ProducerMode;
  /** One short phrase the Writer should focus on. */
  targetFocus: string;
  /** Optional ref to a callbackPool event id when mode='callback'. */
  callbackTo: string | null;
  lengthHint: "short" | "medium" | "long";
  tone: "dry" | "warm" | "playful" | "low-key";
  /** Optional listener handle for direct-address modes. null for auto_track_boundary. */
  addressListener: string | null;
}

/** Word-count window per length hint. Used by the Writer prompt + sanity checks. */
export const LENGTH_WORDS: Record<ProducerDecision["lengthHint"], { min: number; max: number }> = {
  short: { min: 4, max: 25 },
  medium: { min: 25, max: 45 },
  long: { min: 50, max: 80 },
};

/**
 * Phase 2 supports these modes only — silence is conditional, the rest
 * are content modes. Other modes (answer, shoutout_read, queue_*, etc.)
 * are spec-defined but land in Phases 3-5.
 */
export const PHASE_2_MODES: ReadonlyArray<ProducerMode> = [
  "opinion",
  "callback",
  "aside",
  "silence",
];
