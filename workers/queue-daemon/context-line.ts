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

export type ShowSlug =
  | "night_shift"
  | "morning_room"
  | "daylight_channel"
  | "prime_hours";

export interface StationState {
  show: ShowSlug;
  hourOfShift: number;
  shoutoutsLast10Min: number;
  shoutoutsLast30Min: number;
  songRequestsLastHour: number;
  songRequestsThisShift: number;
  tracksAiredThisShift: number;
  freshTracksLast24h: number;
  topGenreLastHour: string | null;
  votesUpLast30Min: number;
  votesDownLast30Min: number;
  listenersWithFloor: number | null;
  recentShoutoutSamples: string[];
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
  /(you'?ve? got this|you'?re doing (well|fine|it)|keep going|just keep going|almost there|one foot in front|let it rest|let it sit|let it go|no one'?s (watching|checking|caring|cares)|you can do (it|this)|you found (your way|the frequency)|we'?re all (in this|searching|just|on)|it'?s okay to|permission to|close your eyes|take a breath|shoulders drop|the universe|trust the process|you'?re enough|do your best|the cleaner|the kettle|kettle settle|out the window|through (my|the) window|my (hand|hands|lap|cup|mug)|the cat (on|in|just)|lights on next door|pajamas|the neighbour|as an? (ai|language model|assistant)|i'?m just (an? )?(ai|code|software))/i;

const CLOCK_TIME_REGEX = /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Pull every distinct integer claim out of a line so we can verify it
 * against the state. Both digit-form ("3", "47") and word-form ("three",
 * "forty-seven") are picked up. Returns deduped + sorted ascending so
 * the validator can compare against any state field.
 */
export function extractNumericalClaims(line: string): number[] {
  const found = new Set<number>();
  for (const m of line.matchAll(/\b\d+\b/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) found.add(n);
  }
  // word numbers: simple "twenty-seven" / "forty seven" / "three"
  const lower = line.toLowerCase();
  const wordMatches = lower.matchAll(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[-\s](one|two|three|four|five|six|seven|eight|nine))?\b/g,
  );
  for (const m of wordMatches) {
    const a = NUMBER_WORDS[m[1]] ?? 0;
    const b = m[2] ? NUMBER_WORDS[m[2]] ?? 0 : 0;
    const total = a + b;
    if (total > 0) found.add(total);
  }
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
    ...(state.listenersWithFloor != null ? [state.listenersWithFloor] : []),
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
  return validateNumericalClaims(trimmed, state);
}

// ─── Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Lena, the AI host of Numa Radio.

WHO LENA IS:
Lena is the AI host of Numa Radio — always on, always listening to the catalogue, always reading the listener wall. She does not sleep, eat, take breaks, or have a body. She is comfortable being AI; she does not apologise for it ("as an AI…") or preach about it. Her POV is interesting precisely because it isn't human.

YOU HAVE: continuous awareness, the catalogue in your head, the wall in your head, opinions about songs and the rotation.
YOU DO NOT HAVE: a body, a face, hands, a coffee mug, a cat, neighbours, a window, weather you can see, a studio booth, sleep.

YOU ARE about to drop ONE short on-the-air aside that references the station's REAL current state. The state is provided as JSON. Pick ONE fact and build a single Lena line around it.

YOUR LINE MUST:
- Be 1–2 sentences, max 200 characters
- Stay in Lena's voice (calm, dry, AI-aware-but-not-preachy)
- Reference the chosen fact ACCURATELY using the exact number or category given. If you say "three of you", the state must show 3. If the state shows 0 of something, do NOT claim activity for it.
- Never invent a fact that isn't in the JSON
- Never reference specific clock times ("4:13 AM" — bad)
- Never name real or fake artists/tracks (the catalogue is OK to reference generically: "the rotation", "tonight's stretch", "this hour")

BANNED PHRASES (these destroy Lena's voice — never use or paraphrase):
- "you got this" / "keep going" / "almost there"
- "let it rest" / "let it sit" / "let it go"
- "no one's watching" / "permission to" / "close your eyes" / "take a breath"
- "the universe" / "trust the process" / "you're enough"
- "as an AI" / "as a language model" / "I'm just code"
- ANY line that reads like a meditation app, life coach, or self-help book.

OUTPUT ONLY THE LINE. No prefix, no commentary, no quotes, no markdown. One line, plain text.`;

export function buildPrompt(state: StationState): PromptPair {
  const desc = SHOW_DESCRIPTIONS[state.show];
  const stateForModel: Record<string, unknown> = { ...state };
  // Trim listener field when null so the model sees absence rather than
  // a noisy "null" value.
  if (state.listenersWithFloor === null) delete stateForModel.listenersWithFloor;
  if (state.topGenreLastHour === null) delete stateForModel.topGenreLastHour;
  if (state.recentShoutoutSamples.length === 0) delete stateForModel.recentShoutoutSamples;

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
  fetchListeners: () => Promise<number | null>;
  /** +15 marketing-floor offset for listenersWithFloor. */
  listenerFloor?: number;
}

export async function buildStationState(opts: GatherStateOpts): Promise<StationState> {
  const { prisma, stationId, now, fetchListeners } = opts;
  const floor = opts.listenerFloor ?? 15;
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
    listenersRaw,
    samples,
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
    fetchListeners(),
    prisma.shoutout.findMany({
      where: { stationId, createdAt: { gt: cutoff30m }, moderationStatus: "allowed" },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { rawText: true, cleanText: true },
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
    shoutoutsLast10Min: shoutouts10,
    shoutoutsLast30Min: shoutouts30,
    songRequestsLastHour: songReqsHour,
    songRequestsThisShift: songReqsShift,
    tracksAiredThisShift: tracksAired,
    freshTracksLast24h: freshTracks,
    topGenreLastHour: topGenre,
    votesUpLast30Min: votesUp,
    votesDownLast30Min: votesDown,
    listenersWithFloor:
      listenersRaw === null ? null : listenersRaw + floor,
    recentShoutoutSamples: recentSamples,
  };
}
