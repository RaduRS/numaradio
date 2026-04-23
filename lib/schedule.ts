export type ShowBlock =
  | "Night Shift"
  | "Morning Room"
  | "Daylight Channel"
  | "Prime Hours";

export interface ShowSlot {
  readonly name: ShowBlock;
  /** Inclusive. */
  readonly startHour: number;
  /** Exclusive (24 = midnight). */
  readonly endHour: number;
  /** Display label, e.g. "00 – 05". Uses an en-dash. */
  readonly timeLabel: string;
  readonly titleLines: readonly [string, string];
  readonly description: string;
}

export const SHOW_SCHEDULE: readonly ShowSlot[] = [
  {
    name: "Night Shift",
    startHour: 0,
    endHour: 5,
    timeLabel: "00 – 05",
    titleLines: ["Night", "Shift"],
    description:
      "Quiet-hours rotation. Low-BPM, spacious, voices that don't shout. Lena whispers. Mostly.",
  },
  {
    name: "Morning Room",
    startHour: 5,
    endHour: 10,
    timeLabel: "05 – 10",
    titleLines: ["Morning", "Room"],
    description:
      "First coffee energy. Warmer tones, field recordings, the occasional cover of something you'd forgotten.",
  },
  {
    name: "Daylight Channel",
    startHour: 10,
    endHour: 17,
    timeLabel: "10 – 17",
    titleLines: ["Daylight", "Channel"],
    description:
      "Focus-hours programming. Longer tracks, fewer host breaks. Good for writing, commuting, staring out.",
  },
  {
    name: "Prime Hours",
    startHour: 17,
    endHour: 24,
    timeLabel: "17 – 24",
    titleLines: ["Prime", "Hours"],
    description:
      "Dinner to midnight. Louder, stranger, more character. The request wall runs hottest here.",
  },
] as const;

export function showForHour(h: number): ShowSlot {
  const match = SHOW_SCHEDULE.find((s) => h >= s.startHour && h < s.endHour);
  return match ?? SHOW_SCHEDULE[0];
}
