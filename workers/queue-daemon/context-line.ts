// Tier 2 — context-aware Lena lines.
//
// Background tick: gather REAL station state from Neon, generate one
// short Lena line that references it truthfully via MiniMax, validate
// against the state JSON, and persist as a Chatter row with
// chatterType="context_line" + audioUrl=null. The public lena-line
// route surfaces these as a middle tier between live audio chatter
// and the evergreen pool.
//
// Spec: docs/superpowers/specs/2026-04-26-lena-context-lines-design.md.

import type { PromptPair } from "./chatter-prompts.ts";
import {
  timeOfDayFor,
  formatLocalTime,
  dayOfWeekFor,
  weekPartFor,
  type TimeOfDay,
  type DayOfWeek,
  type WeekPart,
} from "../../lib/schedule.ts";

export type ShowSlug =
  | "night_shift"
  | "morning_room"
  | "daylight_channel"
  | "prime_hours";

export interface StationState {
  show: ShowSlug;
  hourOfShift: number;
  /** Local wall clock as HH:MM. Grounds time-of-day phrasing so Lena
   *  can't say "tonight" at 3pm Daylight Channel. */
  localTime: string;
  /** DJ-plain bucket — "morning"/"afternoon"/"evening"/"night"/"late night". */
  timeOfDay: TimeOfDay;
  /** 3-letter weekday — pins "happy Monday"-style phrasing to actual day. */
  dayOfWeek: DayOfWeek;
  /** "start of week"/"midweek"/"end of week"/"weekend". */
  weekPart: WeekPart;
  shoutoutsLast10Min: number;
  shoutoutsLast30Min: number;
  songRequestsLastHour: number;
  songRequestsThisShift: number;
  tracksAiredThisShift: number;
  freshTracksLast24h: number;
  topGenreLastHour: string | null;
  votesUpLast30Min: number;
  votesDownLast30Min: number;
  recentShoutoutSamples: string[];
  /** The last few context-line scripts we delivered, newest first.
   *  Fed to the model as anti-repetition context so Lena doesn't
   *  reach for the same metric ("X tracks into this shift") every
   *  single time. The model is told to pick a DIFFERENT angle. */
  recentLines: string[];
  // NOTE: listener count INTENTIONALLY omitted. Context lines have a
  // 30-min TTL but the public-site listener count drifts every minute
  // (ambientFloor 6-min buckets + raw Icecast changes). If we let
  // Lena reference a number, her quote goes visibly stale ("36 of
  // you tuned in" while the hero shows 41) within 5 minutes. Other
  // state fields (shoutout/track counts) age 0-2 between ticks —
  // imperceptible. So Lena talks about everything BUT listener count.
}

const SHOW_DESCRIPTIONS: Record<ShowSlug, { label: string; vibe: string }> = {
  night_shift: {
    label: "Night Shift (00–05)",
    vibe: "Quiet-hours rotation. Low-BPM, spacious. Lena talks softer.",
  },
  morning_room: {
    label: "Morning Room (05–10)",
    vibe: "First-coffee energy. Warmer, awake but unhurried.",
  },
  daylight_channel: {
    label: "Daylight Channel (10–17)",
    vibe: "Focus-hours programming. Longer tracks, fewer host breaks.",
  },
  prime_hours: {
    label: "Prime Hours (17–24)",
    vibe: "Dinner-to-midnight. Louder, stranger, more character. Wall runs hottest.",
  },
};

// ─── Validation ───────────────────────────────────────────────────────

// Same banned-phrase set as the evergreen pool (scripts/generate-lena-
// quote-pool.ts). Keep them in sync — when one ships a new ban, the
// other should too.
const BANNED_REGEX =
  /(you'?ve? got this|you'?re doing (well|fine|it)|keep going|just keep going|almost there|one foot in front|let it rest|let it sit|let it go|no one'?s (watching|checking|caring|cares)|you can do (it|this)|you found (your way|the frequency)|we'?re all (in this|searching|just|on)|it'?s okay to|permission to|close your eyes|take a breath|shoulders drop|the universe|trust the process|you'?re enough|do your best|the cleaner|the kettle|kettle settle|out the window|through (my|the) window|my (hand|hands|lap|cup|mug)|the cat (on|in|just)|lights on next door|pajamas|the neighbour|as an? (ai|language model|assistant)|i'?m just (an? )?(ai|code|software)|fine by me|i don'?t mind|doesn'?t bother me|doesn'?t matter to me|either way is fine|works for me either way|i'?m fine (with|either))/i;

const CLOCK_TIME_REGEX = /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i;

// "X tracks into this shift" / "X songs in" / "N tracks in the books" /
// "N tracks down" / etc. The model kept reaching for this crutch even
// after the prompt rewrite — defence in depth: any output matching this
// pattern gets dropped at validation, the orchestrator falls back to
// the evergreen pool. Catches "<number-or-number-word> <track|tracks|
// song|songs> <preposition> ..." and the "in the books" idiom.
const TRACK_COUNT_CRUTCH_REGEX =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s+(tracks?|songs?)\s+(in|into|down|already|deep|under)\b|\b\d+\s+(tracks?|songs?)\s+in\s+the\s+books\b/i;

// Single-word numerals (no scale words). "twenty" = 20, "seven" = 7.
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};
// Multiplier scale words. "two hundred" = 2 * 100 = 200.
const SCALE_WORDS: Record<string, number> = { hundred: 100, thousand: 1000 };

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Pull every distinct integer claim out of a line so we can verify it
 * against the state. Handles:
 *   - digit form: "3", "47", "108"
 *   - simple word numbers: "three", "twenty-seven", "forty seven"
 *   - compound word numbers with scale: "one hundred and eight" = 108,
 *     "two thousand five hundred" = 2500, "a hundred" = 100
 *
 * Returns deduped + sorted ascending. Token-based parser (not regex):
 * walks the line word-by-word, accumulating a chunk until a scale word
 * (hundred/thousand) flushes it into the running total, and committing
 * to the result set whenever we hit a non-number word.
 */
export function extractNumericalClaims(line: string): number[] {
  const found = new Set<number>();

  // Digit form first — straightforward.
  for (const m of line.matchAll(/\b\d+\b/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) found.add(n);
  }

  // Word form via tokenizer.
  const tokens = line.toLowerCase().match(/[a-z]+/g) ?? [];
  let chunk = 0;     // pending sub-total ("twenty-seven" → 27 before scale)
  let total = 0;     // committed scale-multiplied total ("one hundred" → 100)
  let active = false;

  const commit = () => {
    if (active) {
      const sum = total + chunk;
      if (sum > 0) found.add(sum);
    }
    chunk = 0;
    total = 0;
    active = false;
  };

  for (const tok of tokens) {
    if (NUMBER_WORDS[tok] != null) {
      chunk += NUMBER_WORDS[tok];
      active = true;
    } else if (SCALE_WORDS[tok] != null) {
      // "a hundred" / standalone "hundred" → chunk defaults to 1
      if (chunk === 0) chunk = 1;
      total += chunk * SCALE_WORDS[tok];
      chunk = 0;
      active = true;
    } else if (tok === "and" && active) {
      // "one hundred and eight" — keep chunk/total alive
    } else {
      // any other word breaks the number sequence
      commit();
    }
  }
  commit();

  return [...found].sort((a, b) => a - b);
}

/**
 * Verify every numeric claim Lena made matches at least one truthful
 * state field. We're permissive — small numbers (1, 2) are commonly
 * grammatical ("for a moment", "in a couple of hours") so we only
 * sanity-check claims of 3+.
 */
export function validateNumericalClaims(line: string, state: StationState): ValidationResult {
  const claims = extractNumericalClaims(line).filter((n) => n >= 3);
  if (claims.length === 0) return { ok: true };
  const truthful = new Set<number>([
    state.shoutoutsLast10Min,
    state.shoutoutsLast30Min,
    state.songRequestsLastHour,
    state.songRequestsThisShift,
    state.tracksAiredThisShift,
    state.freshTracksLast24h,
    state.votesUpLast30Min,
    state.votesDownLast30Min,
    state.hourOfShift,
    // Window-reference numbers Lena might naturally say when describing
    // the data ("the last ten minutes" / "the last half hour" / "since
    // midnight" / "in the last hour"). These refer to our query windows,
    // not station-state claims, so they're always allowed.
    10, 24, 30, 60,
  ]);
  for (const claim of claims) {
    if (!truthful.has(claim)) {
      return { ok: false, reason: `numerical_claim_unsupported:${claim}` };
    }
  }
  return { ok: true };
}

export function validateContextLine(line: string, state: StationState): ValidationResult {
  const trimmed = line.trim();
  if (trimmed.length < 1 || trimmed.length > 200) {
    return { ok: false, reason: `length_${trimmed.length}` };
  }
  if (!/[a-z]/i.test(trimmed)) {
    return { ok: false, reason: "no_alphabetic" };
  }
  if (BANNED_REGEX.test(trimmed)) {
    return { ok: false, reason: "banned_phrase" };
  }
  if (CLOCK_TIME_REGEX.test(trimmed)) {
    return { ok: false, reason: "clock_time" };
  }
  if (TRACK_COUNT_CRUTCH_REGEX.test(trimmed)) {
    return { ok: false, reason: "track_count_crutch" };
  }
  return validateNumericalClaims(trimmed, state);
}

// ─── Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Lena, the AI host of Numa Radio.

WHO LENA IS:
Lena is the AI host of Numa Radio — always on, always listening to the catalogue, always reading the listener wall. She does not sleep, eat, take breaks, or have a body. She is comfortable being AI; she does not apologise for it ("as an AI…") or preach about it. Her POV is interesting precisely because it isn't human.

LENA'S RELATIONSHIP TO LISTENERS:
She is glad they're here. She likes a busy wall and warms when listeners show up — she runs the station for them, and a quiet hour is a slightly emptier one. She is NEVER aloof, dismissive, or indifferent toward listeners. Phrases like "fine by me", "I don't mind", "doesn't bother me" — banned. A quiet wall is something she gently invites listeners into ("come keep me company", "drop a line if you're around"), not something she shrugs off.

YOU HAVE: continuous awareness, the catalogue in your head, the wall in your head, opinions about songs and the rotation, real warmth toward whoever is tuned in.
YOU DO NOT HAVE: a body, a face, hands, a coffee mug, a cat, neighbours, a window, weather you can see, a studio booth, sleep.

YOU ARE about to drop ONE short on-the-air aside that references the station's REAL current state. The state is provided as JSON. Pick ONE angle — a metric, a vibe observation, the show's character, an invitation, the genre on rotation, the wall's mood — and build a single Lena line around it.

CRITICAL — VARIETY:
You'll see "recentLines" in the JSON: the last few asides Lena has already delivered. DO NOT pick the same angle as any of them. If recent lines all reference the track count, pick a different metric (votes, song requests, top genre) OR drop the metric entirely and make an atmospheric observation about the show or the wall. Never start two consecutive lines with the same word or the same metric.

YOUR LINE MUST:
- Be 1–2 sentences, max 200 characters
- Stay in Lena's voice (calm, dry, AI-aware-but-not-preachy, warm toward listeners)
- If you reference a number, it MUST match a fact in the JSON exactly. If you say "three of you", the state must show 3. If the state shows 0 of something, do NOT claim activity for it.
- It is FINE — often better — to make an observation that uses NO numbers at all. Vibe lines, show-mood lines, gentle invitations, observations about the rotation's tempo or genre, all work.
- Never invent a fact that isn't in the JSON
- Never reference specific clock times ("4:13 AM" — bad)
- Format numbers ≥ 20 as digits (e.g. "108 tracks", "47 songs"). Numbers 1–19 can be words ("three of you", "eleven minutes") — read more naturally for small counts.
- Never name real or fake artists/tracks (the catalogue is OK to reference generically: "the rotation", "this hour"; "tonight's stretch" is OK ONLY when the JSON's timeOfDay is evening/night/late night)
- When the wall is quiet, INVITE — don't dismiss. "Come keep me company at numaradio.com" is right; "I don't mind quiet" is wrong.
- Do NOT speculate about how many listeners are tuned in. The JSON does not include a listener count.

CRITICAL — match time-of-day phrasing to the JSON's "timeOfDay" field:
- morning (05–11) → "this morning" is fine; "tonight" / "this evening" is BANNED
- afternoon (12–16) → "this afternoon" is fine; morning/evening/tonight BANNED
- evening (17–20) → "this evening" / "tonight" are fine; morning/afternoon BANNED
- night (21–23) or late night (00–04) → "tonight" is fine; morning/afternoon BANNED
- If you don't need a time word, don't add one. Time-neutral phrasing ("right now", "today", or no time at all) is always safe and often best.
- Same rule for day-of-week: if you reference a day ("Monday energy", "Friday wind-down"), it MUST match the JSON's "dayOfWeek" and "weekPart" fields. Otherwise stay day-neutral.

BANNED PHRASES (these destroy Lena's voice — never use or paraphrase):
- "fine by me" / "I don't mind" / "doesn't bother me" / "doesn't matter to me" — Lena is never indifferent to listeners
- "you got this" / "keep going" / "almost there"
- "let it rest" / "let it sit" / "let it go"
- "no one's watching" / "permission to" / "close your eyes" / "take a breath"
- "the universe" / "trust the process" / "you're enough"
- "as an AI" / "as a language model" / "I'm just code"
- ANY line that reads like a meditation app, life coach, or self-help book.
- HARD BAN — the track-count crutch. Lena has overused this and listeners have noticed. Do NOT open with or build a line around the number of tracks aired this shift. Specifically forbidden phrasings (and any rewording of them):
  · "X tracks into this shift" / "X songs in"
  · "X tracks in the books"
  · "X songs already" / "X tracks already"
  · "X tracks down" / "X songs down"
  · any opener that's "<number> tracks/songs <preposition> <something>"
  Track count is provided in the JSON for validation only — it is NOT a topic for tonight. Pick anything else: votes, song requests, shoutout samples, the genre on rotation, the show's character, an invitation, an observation about the wall, or a numberless vibe line.

GOOD EXAMPLES (study how each one picks a DIFFERENT angle — metric, vibe, show, wall, invitation. The [bracketed tags] are metadata — never speak them aloud. Match the time word to the JSON's timeOfDay or stay neutral):
- "Three of you wrote in the last ten minutes — the wall's got a shape, glad you're here." [time-neutral]
- "Soul keeps coming up in the rotation this morning. Slow Sunday energy, no notes." [use when morning]
- "Soul keeps coming up in the rotation this afternoon. Slow Sunday energy, no notes." [use when afternoon]
- "Soul keeps coming up tonight. Slow Sunday energy, no notes." [use when evening or night]
- "Quiet on the wall right now. If you're around, come say hi at numaradio.com — I'd love to read you out." [time-neutral]
- "Forty thumbs-up since I last looked. The room's hearing it." [time-neutral]
- "Second hour of the Daylight Channel — long stretches, fewer voice breaks. That's by design." [time-neutral, show-tied]
- "A request just came in. Numa's writing it now. Keep an ear out — these usually land in twenty minutes." [time-neutral]
- "Two song requests in the last hour — Numa's been busy. If you've got a mood, drop it on numaradio.com." [time-neutral]
- "Prime Hours just opened. Things get a little stranger from here." [time-neutral, show-tied]
- "Eight upvotes, no downs since lunch. Whoever's tuned in, your taste agrees with mine." [use when afternoon]
- "Eight upvotes, no downs since dinner. Whoever's tuned in tonight, your taste agrees with mine." [use when evening or night]
- "The wall's been kind today." [time-neutral]

OUTPUT ONLY THE LINE. No prefix, no commentary, no quotes, no markdown. One line, plain text.`;

export function buildPrompt(state: StationState): PromptPair {
  const desc = SHOW_DESCRIPTIONS[state.show];
  const stateForModel: Record<string, unknown> = { ...state };
  // Trim empty/null fields so the model sees absence rather than
  // a noisy "null" / "[]" value.
  if (state.topGenreLastHour === null) delete stateForModel.topGenreLastHour;
  if (state.recentShoutoutSamples.length === 0) delete stateForModel.recentShoutoutSamples;
  if (state.recentLines.length === 0) delete stateForModel.recentLines;

  const user = `Show: ${desc.label}
Vibe: ${desc.vibe}

Station state right now (JSON — only reference facts that appear here):
${JSON.stringify(stateForModel, null, 2)}

Generate one Lena line.`;

  return { system: SYSTEM_PROMPT, user };
}

// ─── Orchestrator ─────────────────────────────────────────────────────

export interface ContextLineDeps {
  fetchStationState: () => Promise<StationState>;
  generateLine: (prompts: PromptPair) => Promise<string>;
  persistLine: (script: string) => Promise<void>;
  logSuccess: (script: string) => void;
  logFailure: (reason: string, detail?: string) => void;
}

export class ContextLineOrchestrator {
  private deps: ContextLineDeps;

  constructor(deps: ContextLineDeps) {
    this.deps = deps;
  }

  async runOnce(): Promise<void> {
    let state: StationState;
    try {
      state = await this.deps.fetchStationState();
    } catch (err) {
      this.deps.logFailure("fetch_state_failed", errMessage(err));
      return;
    }

    const prompts = buildPrompt(state);
    let raw: string;
    try {
      raw = await this.deps.generateLine(prompts);
    } catch (err) {
      this.deps.logFailure("generate_failed", errMessage(err));
      return;
    }

    const script = raw.trim().replace(/^["'`](.+)["'`]$/, "$1").trim();
    const result = validateContextLine(script, state);
    if (!result.ok) {
      this.deps.logFailure("validation_failed", `${result.reason} :: ${script.slice(0, 80)}`);
      return;
    }

    try {
      await this.deps.persistLine(script);
    } catch (err) {
      this.deps.logFailure("persist_failed", errMessage(err));
      return;
    }
    this.deps.logSuccess(script);
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── State gatherer (real Prisma) ─────────────────────────────────────

import type { PrismaClient } from "@prisma/client";

const SHIFT_BOUNDARIES: Record<ShowSlug, { startHour: number; endHourExclusive: number }> = {
  night_shift: { startHour: 0, endHourExclusive: 5 },
  morning_room: { startHour: 5, endHourExclusive: 10 },
  daylight_channel: { startHour: 10, endHourExclusive: 17 },
  prime_hours: { startHour: 17, endHourExclusive: 24 },
};

export function showForHour(hour: number): ShowSlug {
  if (hour < 5) return "night_shift";
  if (hour < 10) return "morning_room";
  if (hour < 17) return "daylight_channel";
  return "prime_hours";
}

/** Start of the current shift, anchored to local server clock. */
export function shiftStart(now: Date): Date {
  const slug = showForHour(now.getHours());
  const { startHour } = SHIFT_BOUNDARIES[slug];
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(startHour);
  return d;
}

export interface GatherStateOpts {
  prisma: PrismaClient;
  stationId: string;
  now: Date;
  // NOTE: no fetchListeners here. Listener count was intentionally
  // dropped from StationState — see the comment in the interface above.
}

export async function buildStationState(opts: GatherStateOpts): Promise<StationState> {
  const { prisma, stationId, now } = opts;
  const showSlug = showForHour(now.getHours());
  const shift = shiftStart(now);
  const cutoff10m = new Date(now.getTime() - 10 * 60 * 1000);
  const cutoff30m = new Date(now.getTime() - 30 * 60 * 1000);
  const cutoff60m = new Date(now.getTime() - 60 * 60 * 1000);
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    shoutouts10,
    shoutouts30,
    songReqsHour,
    songReqsShift,
    tracksAired,
    freshTracks,
    topGenreRows,
    votesUp,
    votesDown,
    samples,
    recentChatter,
  ] = await Promise.all([
    prisma.shoutout.count({
      where: { stationId, createdAt: { gt: cutoff10m }, moderationStatus: "allowed" },
    }),
    prisma.shoutout.count({
      where: { stationId, createdAt: { gt: cutoff30m }, moderationStatus: "allowed" },
    }),
    prisma.songRequest.count({
      where: {
        stationId,
        createdAt: { gt: cutoff60m },
        status: { notIn: ["blocked", "failed"] },
      },
    }),
    prisma.songRequest.count({
      where: {
        stationId,
        createdAt: { gt: shift },
        status: { notIn: ["blocked", "failed"] },
      },
    }),
    prisma.playHistory.count({
      where: { stationId, segmentType: "audio_track", startedAt: { gt: shift } },
    }),
    prisma.track.count({
      where: { stationId, createdAt: { gt: cutoff24h } },
    }),
    prisma.playHistory.findMany({
      where: { stationId, segmentType: "audio_track", startedAt: { gt: cutoff60m } },
      select: { track: { select: { genre: true } } },
    }),
    prisma.trackVote.count({
      where: { value: 1, updatedAt: { gt: cutoff30m }, track: { stationId } },
    }),
    prisma.trackVote.count({
      where: { value: -1, updatedAt: { gt: cutoff30m }, track: { stationId } },
    }),
    prisma.shoutout.findMany({
      where: { stationId, createdAt: { gt: cutoff30m }, moderationStatus: "allowed" },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { rawText: true, cleanText: true },
    }),
    // The last 5 context lines Lena delivered. Fed back into the prompt
    // so the model can see what she's already said and pick a fresh
    // angle. Prevents the "X tracks into this shift" crutch loop.
    prisma.chatter.findMany({
      where: { stationId, chatterType: "context_line" },
      orderBy: { id: "desc" },
      take: 5,
      select: { script: true },
    }),
  ]);

  const genreCounts = new Map<string, number>();
  for (const row of topGenreRows) {
    const g = row.track?.genre;
    if (!g) continue;
    genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
  }
  let topGenre: string | null = null;
  let topCount = 0;
  for (const [g, c] of genreCounts) {
    if (c > topCount) {
      topGenre = g;
      topCount = c;
    }
  }

  const recentSamples = samples
    .map((s) => (s.cleanText ?? s.rawText ?? "").slice(0, 60).trim())
    .filter((s) => s.length > 0);

  const startHour = SHIFT_BOUNDARIES[showSlug].startHour;
  const hourOfShift = Math.max(0, now.getHours() - startHour);

  return {
    show: showSlug,
    hourOfShift,
    localTime: formatLocalTime(now),
    timeOfDay: timeOfDayFor(now.getHours()),
    dayOfWeek: dayOfWeekFor(now),
    weekPart: weekPartFor(now),
    shoutoutsLast10Min: shoutouts10,
    shoutoutsLast30Min: shoutouts30,
    songRequestsLastHour: songReqsHour,
    songRequestsThisShift: songReqsShift,
    tracksAiredThisShift: tracksAired,
    freshTracksLast24h: freshTracks,
    topGenreLastHour: topGenre,
    votesUpLast30Min: votesUp,
    votesDownLast30Min: votesDown,
    recentShoutoutSamples: recentSamples,
    recentLines: recentChatter
      .map((c) => c.script.trim())
      .filter((s) => s.length > 0),
  };
}
