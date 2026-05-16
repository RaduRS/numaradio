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
  /** Phase 5: when mode='queue_pick', the track Producer wants to insert. */
  queueAction: { kind: "pick"; trackId: string; reason: string } | null;
}

/** Word-count window per length hint. Used by the Writer prompt + sanity checks. */
export const LENGTH_WORDS: Record<ProducerDecision["lengthHint"], { min: number; max: number }> = {
  short: { min: 4, max: 25 },
  medium: { min: 25, max: 45 },
  long: { min: 50, max: 80 },
};

/**
 * Modes the Producer may emit. Phase 2 originally shipped opinion / callback
 * / aside / silence; Phase 5 adds queue_pick (daemon-side queue autonomy).
 * Other modes (answer, shoutout_read, accept_request, etc.) are spec-defined
 * but land in later phases.
 */
export const PRODUCER_MODES_AVAILABLE: ReadonlyArray<ProducerMode> = [
  "opinion",
  "callback",
  "aside",
  "queue_pick", // NEW Phase 5 mode
  "silence",
];

// Backwards compat — keep the old name as an alias so producer.ts doesn't break
export const PHASE_2_MODES = PRODUCER_MODES_AVAILABLE;
