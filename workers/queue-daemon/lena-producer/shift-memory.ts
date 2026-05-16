import type { ProducerMode, ShiftEvent } from "./shift-event.ts";
import { deriveCounters, type Counters } from "./derived-counters.ts";
import { deriveMood, type Mood } from "./derived-mood.ts";
import { deriveCallbacks, type CallbackCandidate } from "./derived-callbacks.ts";
import { deriveShowContext, type ShowContext } from "./derived-show.ts";

const MAX_LOG_SIZE = 50;
const MAX_RECENT_LINES = 10;
const MAX_RECENT_MODES = 10;

export interface ShiftMemoryView {
  events: readonly ShiftEvent[];
  counters: Counters;
  mood: Mood;
  callbackPool: readonly CallbackCandidate[];
  recentLines: readonly { text: string; mode: ProducerMode | "legacy"; airedAt: number }[];
  recentModes: readonly (ProducerMode | "legacy")[];
  show: ShowContext;
}

export class ShiftMemory {
  #log: ShiftEvent[] = [];
  #usedCallbackIds: Set<string> = new Set();
  /** Async-populated by callback-summarizer (Task 7); read by Producer in Phase 2. */
  #descriptions: Map<string, string> = new Map();

  record(event: ShiftEvent): void {
    this.#log.push(event);
    if (this.#log.length > MAX_LOG_SIZE) {
      this.#log.splice(0, this.#log.length - MAX_LOG_SIZE);
    }
  }

  /**
   * Async description rewrite from callback-summarizer.
   * Producer reads via view().callbackPool[i].description; if no override is
   * set, the structural fallback from derived-callbacks.ts is used.
   */
  setDescription(eventId: string, description: string): void {
    this.#descriptions.set(eventId, description);
  }

  markCallbackUsed(eventId: string): void {
    this.#usedCallbackIds.add(eventId);
  }

  evictOlderThan(cutoffMs: number): void {
    this.#log = this.#log.filter((e) => airedAtOf(e) >= cutoffMs);
  }

  /** Clear all state — used by shift-boundary handler (Phase 2). */
  clear(): void {
    this.#log = [];
    this.#usedCallbackIds.clear();
    this.#descriptions.clear();
  }

  view(nowMs: number): ShiftMemoryView {
    const lenaLines = this.#log
      .filter((e): e is Extract<ShiftEvent, { type: "lena_line_aired" }> => e.type === "lena_line_aired")
      .sort((a, b) => b.airedAt - a.airedAt);

    const recentLines = lenaLines.slice(0, MAX_RECENT_LINES).map((e) => ({
      text: e.text,
      mode: e.mode,
      airedAt: e.airedAt,
    }));
    const recentModes = lenaLines.slice(0, MAX_RECENT_MODES).map((e) => e.mode);

    const pool = deriveCallbacks(this.#log, nowMs, this.#usedCallbackIds).map((c) => ({
      ...c,
      description: this.#descriptions.get(c.id) ?? c.description,
    }));

    return Object.freeze({
      events: Object.freeze([...this.#log]),
      counters: deriveCounters(this.#log, nowMs),
      mood: deriveMood(this.#log, nowMs),
      callbackPool: Object.freeze(pool),
      recentLines: Object.freeze(recentLines),
      recentModes: Object.freeze(recentModes),
      show: deriveShowContext(nowMs),
    });
  }
}

function airedAtOf(e: ShiftEvent): number {
  switch (e.type) {
    case "track_aired":
    case "lena_line_aired":
    case "shoutout_aired":
    case "youtube_mention":
      return e.airedAt;
    case "operator_force":
      return e.forcedAt;
  }
}
