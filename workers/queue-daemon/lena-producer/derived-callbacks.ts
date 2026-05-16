import type { ShiftEvent } from "./shift-event.ts";

export interface CallbackCandidate {
  /** Source event id — passed back as `callback_to` when Producer references it. */
  id: string;
  sourceType: "shoutout" | "mention" | "aside";
  /** Pre-summarized human-readable description; populated by callback-summarizer.ts (Task 7). */
  description: string;
  minsAgo: number;
  used: boolean;
}

const MAX_POOL_SIZE = 8;

export function deriveCallbacks(
  log: readonly ShiftEvent[],
  nowMs: number,
  usedIds: ReadonlySet<string>,
): CallbackCandidate[] {
  const candidates: CallbackCandidate[] = [];

  for (const e of log) {
    if (e.type === "shoutout_aired") {
      candidates.push({
        id: e.id,
        sourceType: "shoutout",
        description: `Shoutout from ${e.handle}: ${truncate(e.originalText, 60)}`,
        minsAgo: Math.floor((nowMs - e.airedAt) / 60_000),
        used: usedIds.has(e.id),
      });
    } else if (e.type === "youtube_mention" && e.intent !== "noise") {
      candidates.push({
        id: e.id,
        sourceType: "mention",
        description: `${e.handle} said: ${truncate(e.text, 60)}`,
        minsAgo: Math.floor((nowMs - e.airedAt) / 60_000),
        used: usedIds.has(e.id),
      });
    } else if (e.type === "lena_line_aired" && e.mode === "aside") {
      candidates.push({
        id: e.id,
        sourceType: "aside",
        description: `Earlier aside: ${truncate(e.text, 60)}`,
        minsAgo: Math.floor((nowMs - e.airedAt) / 60_000),
        used: usedIds.has(e.id),
      });
    }
  }

  // Most recent first, cap at MAX_POOL_SIZE
  return candidates.sort((a, b) => a.minsAgo - b.minsAgo).slice(0, MAX_POOL_SIZE);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
