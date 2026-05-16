/**
 * Per-call show context for the Producer. Wraps the existing show-block
 * grid (Night Shift 00-05, Morning Room 05-10, Daylight Channel 10-17,
 * Prime Hours 17-24) and adds minutesIn / minutesUntilNext for prompt
 * context, plus a 30-min overlap window for cross-boundary callbacks.
 */

export const SHIFT_BOUNDARIES_HOURS = [0, 5, 10, 17] as const;
const SHIFT_NAMES = ["Night Shift", "Morning Room", "Daylight Channel", "Prime Hours"] as const;
const OVERLAP_WINDOW_MS = 30 * 60 * 1000;

export interface ShowContext {
  name: (typeof SHIFT_NAMES)[number];
  /** Wall-clock ms of the show-block start (today, local time). */
  startedAt: number;
  minutesIn: number;
  minutesUntilNext: number;
  /**
   * Events with airedAt >= overlapWindowStart should remain visible in
   * the Producer's view even after a show boundary, so callbacks can
   * bridge transitions.
   */
  overlapWindowStart: number;
}

export function deriveShowContext(nowMs: number): ShowContext {
  const now = new Date(nowMs);
  const hour = now.getHours();

  let blockIndex = 0;
  for (let i = SHIFT_BOUNDARIES_HOURS.length - 1; i >= 0; i -= 1) {
    if (hour >= SHIFT_BOUNDARIES_HOURS[i]) {
      blockIndex = i;
      break;
    }
  }

  const startHour = SHIFT_BOUNDARIES_HOURS[blockIndex];
  const endHour =
    blockIndex < SHIFT_BOUNDARIES_HOURS.length - 1
      ? SHIFT_BOUNDARIES_HOURS[blockIndex + 1]
      : 24;

  const startedAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, 0, 0).getTime();
  const endsAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endHour, 0, 0).getTime();

  return {
    name: SHIFT_NAMES[blockIndex],
    startedAt,
    minutesIn: Math.floor((nowMs - startedAt) / 60_000),
    minutesUntilNext: Math.floor((endsAt - nowMs) / 60_000),
    overlapWindowStart: startedAt - OVERLAP_WINDOW_MS,
  };
}
