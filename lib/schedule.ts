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

export type TimeOfDay =
  | "late night"
  | "morning"
  | "afternoon"
  | "evening"
  | "night";

// DJ-plain buckets for a 24-hour clock. Narrower than the 4-block show
// schedule because the vocabulary Lena reaches for ("this morning",
// "tonight") doesn't line up 1:1 with programming boundaries.
export function timeOfDayFor(h: number): TimeOfDay {
  if (h < 5) return "late night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

/** Local clock as HH:MM (24h), for embedding in prompts. */
export function formatLocalTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export type DayOfWeek = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

const DAY_NAMES: readonly DayOfWeek[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 3-letter weekday name for the local timezone. */
export function dayOfWeekFor(d: Date): DayOfWeek {
  return DAY_NAMES[d.getDay()];
}

export type WeekPart = "start of week" | "midweek" | "end of week" | "weekend";

/**
 * DJ-plain bucket for "where in the week we are". Mon = start, Tue–Thu =
 * midweek, Fri = end of week (TGIF energy), Sat–Sun = weekend. Lets the
 * prompt rule out "hope your week's started right" on a Saturday without
 * giving Lena a calendar lecture.
 */
export function weekPartFor(d: Date): WeekPart {
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  if (day === 0 || day === 6) return "weekend";
  if (day === 1) return "start of week";
  if (day === 5) return "end of week";
  return "midweek";
}
