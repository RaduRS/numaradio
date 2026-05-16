# Lena Producer — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Producer + Writer split for the `auto_track_boundary` trigger only, behind the `LENA_PRODUCER_AUTO` flag. When flag is on, Lena's between-track lines come from a two-stage LLM pipeline (Producer decides mode/tone/length, Writer writes the line) instead of the existing single-shot rotation prompts. When the flag is off, current behavior is preserved exactly. Other triggers (YouTube replies, shoutout narration, queue actions) remain unchanged — those land in Phases 3-5.

**Architecture:** A new `lenaSpeak(trigger)` public API in `workers/queue-daemon/lena-producer/` builds a `ProducerContext` from `ShiftMemory.view()` plus the trigger payload, calls MiniMax once to get a strict-JSON `ProducerDecision` (mode/tone/length/target_focus), then routes to a per-mode Writer that calls MiniMax again to produce the actual spoken line. `auto-host.ts` gates the existing inline-prompt path with the new flag — when on, it calls `lenaSpeak` and uses the returned text in place of `generateScript(prompts)`. The Chatter row gets `producerVersion: 1` so the daemon's reconstruction on restart can distinguish Producer-era rows from legacy rows. If Producer + Writer wall-clock exceeds 20s, the auto-host falls back to the legacy single-call path for that break.

**Tech Stack:** TypeScript (`tsx`), Node `node:test`, existing MiniMax client at `workers/queue-daemon/minimax-script.ts` (the `generateChatterScript({system, user}, {apiKey, fetcher?})` function returns the model's text; Producer just needs JSON-shaped output from the same call).

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`
**Prior plan (Phase 1 — reference for patterns):** `docs/superpowers/plans/2026-05-16-lena-producer-phase-1.md`

---

## File Structure

### Created in this phase

```
workers/queue-daemon/lena-producer/
├── modes.ts                  # ProducerDecision type + length-hint helpers
├── producer-context.ts       # ProducerContext type + buildProducerContext()
├── producer-context.test.ts
├── producer-prompt.ts        # buildProducerPrompt(ctx) → {system, user}
├── producer-prompt.test.ts
├── producer.ts               # runProducer(ctx, llm) → ProducerDecision
├── producer.test.ts
├── fallbacks.ts              # safeDefaultDecision() — deterministic last-resort
├── fallbacks.test.ts
├── writers/
│   ├── opinion.ts            # buildOpinionPrompt(decision, ctx) → {system, user}
│   ├── opinion.test.ts
│   ├── aside.ts
│   ├── aside.test.ts
│   ├── callback.ts
│   └── callback.test.ts
├── writer.ts                 # runWriter(decision, ctx, llm) → string
├── writer.test.ts
└── index.ts                  # lenaSpeak(trigger) — public API
    index.test.ts             # end-to-end with fake LLM
```

### Modified

| File | What |
|---|---|
| `workers/queue-daemon/lena-producer/feature-flag.ts` | Add `isProducerAutoEnabled(env)` (extends existing module) |
| `workers/queue-daemon/auto-host.ts` | New optional dep `lenaSpeak`; gate inside `generateAsset` when flag on |
| `workers/queue-daemon/index.ts:232-243` | `persistChatter` accepts `producerVersion?: number`; pass through |
| `docs/HANDOFF.md` | Prepend Phase 2 deploy notes |

### Not modified in this phase (Phases 3-5)

- `lib/lena-reply.ts` (YouTube reply path — Phase 3)
- `dashboard/lib/humanize.ts` (shoutout narration — Phase 4)
- `dashboard/lib/radio-host.ts` (`,.` regex fix — Phase 4)
- `workers/queue-daemon/chatter-prompts.ts` (kept as fallback path during migration — deleted in Phase 6)

---

## Conventions (from Phase 1)

- Tests use `node:test`. Run a single file with `npx tsx --test path/to/file.test.ts`. Run full suite with `npm test` (note: there's a pre-existing failure in `workers/song-worker/prompt-expand.test.ts` unrelated to Phase 1/2 — ignore).
- Module-relative imports use `./foo.ts`; cross-module use `@/lib/...`.
- Commit one task per commit. Footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Phase 1 schema findings (apply throughout): `Track.key` doesn't exist; `Shoutout.handle` is actually `requesterName`.
- **Safety:** no `prisma db push` — Phase 2 needs no schema changes (the `producerVersion` column shipped in Phase 1). If a task seems to need a migration, STOP and report — something's wrong.

---

## Task 1: Extend feature-flag.ts with `isProducerAutoEnabled`

**Files:**
- Modify: `workers/queue-daemon/lena-producer/feature-flag.ts`
- Modify: `workers/queue-daemon/lena-producer/feature-flag.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `feature-flag.test.ts`:

```typescript
import { isProducerAutoEnabled } from "./feature-flag.ts";

test("isProducerAutoEnabled returns true when env='on'", () => {
  assert.equal(isProducerAutoEnabled({ LENA_PRODUCER_AUTO: "on" }), true);
});

test("isProducerAutoEnabled returns true when env='true'", () => {
  assert.equal(isProducerAutoEnabled({ LENA_PRODUCER_AUTO: "true" }), true);
});

test("isProducerAutoEnabled returns false when env is unset", () => {
  assert.equal(isProducerAutoEnabled({}), false);
});

test("isProducerAutoEnabled returns false when env='off'", () => {
  assert.equal(isProducerAutoEnabled({ LENA_PRODUCER_AUTO: "off" }), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test workers/queue-daemon/lena-producer/feature-flag.test.ts`
Expected: FAIL on the new tests (function not exported).

- [ ] **Step 3: Implement**

Append to `feature-flag.ts`:

```typescript
export function isProducerAutoEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const v = (env.LENA_PRODUCER_AUTO ?? "").toLowerCase();
  return v === "on" || v === "true" || v === "1";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx --test workers/queue-daemon/lena-producer/feature-flag.test.ts`
Expected: 8/8 PASS (4 original + 4 new).

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/feature-flag.ts workers/queue-daemon/lena-producer/feature-flag.test.ts
git commit -m "$(cat <<'EOF'
lena-producer: add LENA_PRODUCER_AUTO feature flag

Phase 2 gate. Defaults off — Producer + Writer code is dead-loaded
until the operator flips this in /etc/numa/env.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Producer decision types (`modes.ts`)

**Files:**
- Create: `workers/queue-daemon/lena-producer/modes.ts`

- [ ] **Step 1: Write the module**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add workers/queue-daemon/lena-producer/modes.ts
git commit -m "$(cat <<'EOF'
lena-producer: ProducerDecision types + Phase 2 mode allowlist

Pure types. PHASE_2_MODES = [opinion, callback, aside, silence] —
other modes will be validated in by Phases 3-5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: ProducerContext + builder (`producer-context.ts`)

**Files:**
- Create: `workers/queue-daemon/lena-producer/producer-context.ts`
- Create: `workers/queue-daemon/lena-producer/producer-context.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// workers/queue-daemon/lena-producer/producer-context.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ShiftMemory } from "./shift-memory.ts";
import type { ShiftEvent } from "./shift-event.ts";
import { buildProducerContext, type AutoTrackBoundaryTrigger } from "./producer-context.ts";

const T0 = 1_700_000_000_000;

function trackEv(id: string, airedAt: number, genre: string | null, bpm: number | null): ShiftEvent {
  return { type: "track_aired", id, trackId: id, title: id, artist: null, genre, bpm, key: null, airedAt };
}

test("buildProducerContext for auto_track_boundary: assembles trigger + show + counters + mood + recentTracksSummary", () => {
  const mem = new ShiftMemory();
  mem.record(trackEv("a", T0 - 400_000, "synth", 120));
  mem.record(trackEv("b", T0 - 300_000, "synth", 118));
  mem.record(trackEv("c", T0 - 200_000, "synth", 115));
  const trigger: AutoTrackBoundaryTrigger = {
    source: "auto_track_boundary",
    nextTrack: { id: "d", title: "Dusk", artist: "Anna", genre: "synth", bpm: 112 },
  };
  const ctx = buildProducerContext({ memoryView: mem.view(T0), trigger, nowMs: T0 });
  assert.equal(ctx.trigger.source, "auto_track_boundary");
  assert.equal(ctx.trigger.nextTrack.title, "Dusk");
  assert.ok(typeof ctx.show.name === "string");
  assert.equal(ctx.mood.currentRun.genre, "synth");
  assert.equal(ctx.mood.currentRun.count, 3);
  assert.match(ctx.recentTracksSummary, /3 track/);
});

test("buildProducerContext recentLinesSummary is empty when no Lena lines yet", () => {
  const mem = new ShiftMemory();
  const trigger: AutoTrackBoundaryTrigger = {
    source: "auto_track_boundary",
    nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null },
  };
  const ctx = buildProducerContext({ memoryView: mem.view(T0), trigger, nowMs: T0 });
  assert.equal(ctx.recentLinesSummary, "(no recent Lena lines this shift)");
});

test("buildProducerContext recentLinesSummary describes last 3 modes with ages", () => {
  const mem = new ShiftMemory();
  mem.record({ type: "lena_line_aired", id: "c1", mode: "opinion", targetFocus: null, text: "x", airedAt: T0 - 300_000, trigger: "auto_track_boundary", addressedListener: null });
  mem.record({ type: "lena_line_aired", id: "c2", mode: "aside", targetFocus: null, text: "y", airedAt: T0 - 200_000, trigger: "auto_track_boundary", addressedListener: null });
  const trigger: AutoTrackBoundaryTrigger = {
    source: "auto_track_boundary",
    nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null },
  };
  const ctx = buildProducerContext({ memoryView: mem.view(T0), trigger, nowMs: T0 });
  assert.match(ctx.recentLinesSummary, /opinion/);
  assert.match(ctx.recentLinesSummary, /aside/);
});

test("buildProducerContext callbackPool exposes top entries with description + minsAgo", () => {
  const mem = new ShiftMemory();
  mem.record({ type: "shoutout_aired", id: "s1", handle: "anna", originalText: "love this set", airedAt: T0 - 600_000 });
  const trigger: AutoTrackBoundaryTrigger = {
    source: "auto_track_boundary",
    nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null },
  };
  const ctx = buildProducerContext({ memoryView: mem.view(T0), trigger, nowMs: T0 });
  assert.equal(ctx.callbackPool.length, 1);
  assert.equal(ctx.callbackPool[0].id, "s1");
  assert.equal(ctx.callbackPool[0].minsAgo, 10);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test workers/queue-daemon/lena-producer/producer-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/producer-context.ts

import type { ShiftMemoryView } from "./shift-memory.ts";

/**
 * Triggers the Producer can handle. Phase 2 supports auto_track_boundary
 * only — Phases 3-5 add youtube_chat_*, operator_force.
 */
export interface AutoTrackBoundaryTrigger {
  source: "auto_track_boundary";
  nextTrack: {
    id: string;
    title: string;
    artist: string | null;
    genre: string | null;
    bpm: number | null;
  };
}

/**
 * Compressed snapshot passed to the Producer LLM. ShiftMemoryView is
 * the raw store; ProducerContext is what the prompt actually sees —
 * pre-digested into strings to keep the prompt small.
 */
export interface ProducerContext {
  trigger: AutoTrackBoundaryTrigger;
  now: { localTime: string; bucket: string };
  show: { name: string; minutesIn: number; minutesUntilNext: number };
  recentTracksSummary: string;
  recentLinesSummary: string;
  callbackPool: { id: string; description: string; minsAgo: number }[];
  counters: {
    msSinceLastLine: number;
    msSinceLastWeatherMention: number;
    msSinceLastStationDrop: number;
    tracksSinceLastShoutout: number;
  };
  mood: {
    currentRun: { genre: string | null; count: number };
    tempoTrend: "rising" | "steady" | "falling";
    avgBpmLast5: number | null;
    topGenreThisHour: string | null;
  };
}

const BUCKETS = ["late night", "morning", "afternoon", "evening", "night"] as const;
function bucketFor(hour: number): string {
  if (hour < 5) return "late night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function fmtHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function summarizeRecentTracks(view: ShiftMemoryView): string {
  const tracks = view.events.filter((e) => e.type === "track_aired").slice(-5);
  if (tracks.length === 0) return "(no recent tracks)";
  const genres = new Map<string, number>();
  for (const t of tracks) {
    if (t.type !== "track_aired") continue;
    const g = t.genre ?? "unknown";
    genres.set(g, (genres.get(g) ?? 0) + 1);
  }
  const genreParts = [...genres.entries()].map(([g, n]) => `${n} ${g}`).join(", ");
  const trendPart =
    view.mood.tempoTrend === "rising"
      ? `BPM trending up to ${view.mood.avgBpmLast5}`
      : view.mood.tempoTrend === "falling"
      ? `BPM trending down to ${view.mood.avgBpmLast5}`
      : view.mood.avgBpmLast5 != null
      ? `BPM steady around ${view.mood.avgBpmLast5}`
      : "tempo unclear";
  return `Last ${tracks.length} track${tracks.length === 1 ? "" : "s"}: ${genreParts}; ${trendPart}.`;
}

function summarizeRecentLines(view: ShiftMemoryView): string {
  if (view.recentLines.length === 0) return "(no recent Lena lines this shift)";
  const last3 = view.recentLines.slice(0, 3);
  const parts = last3.map((l) => `${l.mode}`);
  const modeCounts = new Map<string, number>();
  for (const m of view.recentModes) modeCounts.set(m, (modeCounts.get(m) ?? 0) + 1);
  const overIndexed = [...modeCounts.entries()]
    .filter(([, n]) => n >= 3)
    .map(([m, n]) => `${n} ${m}s`)
    .join(", ");
  const overPart = overIndexed ? ` (over-indexed: ${overIndexed})` : "";
  return `Last ${last3.length}: ${parts.join(", ")}.${overPart}`;
}

export function buildProducerContext(deps: {
  memoryView: ShiftMemoryView;
  trigger: AutoTrackBoundaryTrigger;
  nowMs: number;
}): ProducerContext {
  const now = new Date(deps.nowMs);
  return {
    trigger: deps.trigger,
    now: { localTime: fmtHHMM(now), bucket: bucketFor(now.getHours()) },
    show: {
      name: deps.memoryView.show.name,
      minutesIn: deps.memoryView.show.minutesIn,
      minutesUntilNext: deps.memoryView.show.minutesUntilNext,
    },
    recentTracksSummary: summarizeRecentTracks(deps.memoryView),
    recentLinesSummary: summarizeRecentLines(deps.memoryView),
    callbackPool: deps.memoryView.callbackPool.map((c) => ({
      id: c.id,
      description: c.description,
      minsAgo: c.minsAgo,
    })),
    counters: {
      msSinceLastLine: deps.memoryView.counters.msSinceLastLine,
      msSinceLastWeatherMention: deps.memoryView.counters.msSinceLastWeatherMention,
      msSinceLastStationDrop: deps.memoryView.counters.msSinceLastStationDrop,
      tracksSinceLastShoutout: deps.memoryView.counters.tracksSinceLastShoutout,
    },
    mood: {
      currentRun: {
        genre: deps.memoryView.mood.currentRun.genre,
        count: deps.memoryView.mood.currentRun.count,
      },
      tempoTrend: deps.memoryView.mood.tempoTrend,
      avgBpmLast5: deps.memoryView.mood.avgBpmLast5,
      topGenreThisHour: deps.memoryView.mood.topGenreThisHour,
    },
  };
}

void BUCKETS; // suppress unused-array warning from some linters; type is the contract
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx --test workers/queue-daemon/lena-producer/producer-context.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/producer-context.ts workers/queue-daemon/lena-producer/producer-context.test.ts
git commit -m "lena-producer: ProducerContext + buildProducerContext

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Producer prompt builder (`producer-prompt.ts`)

**Files:**
- Create: `workers/queue-daemon/lena-producer/producer-prompt.ts`
- Create: `workers/queue-daemon/lena-producer/producer-prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// workers/queue-daemon/lena-producer/producer-prompt.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProducerPrompt } from "./producer-prompt.ts";
import type { ProducerContext } from "./producer-context.ts";

function ctx(): ProducerContext {
  return {
    trigger: {
      source: "auto_track_boundary",
      nextTrack: { id: "x", title: "Dusk", artist: "Anna", genre: "synth", bpm: 112 },
    },
    now: { localTime: "23:15", bucket: "night" },
    show: { name: "Prime Hours", minutesIn: 120, minutesUntilNext: 300 },
    recentTracksSummary: "Last 3 tracks: 3 synth; BPM trending down to 115.",
    recentLinesSummary: "Last 2: opinion, aside.",
    callbackPool: [{ id: "s1", description: "Anna shouted out about the late-night set", minsAgo: 18 }],
    counters: { msSinceLastLine: 240_000, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: 1800_000, tracksSinceLastShoutout: 2 },
    mood: { currentRun: { genre: "synth", count: 3 }, tempoTrend: "falling", avgBpmLast5: 115, topGenreThisHour: "synth" },
  };
}

test("buildProducerPrompt returns {system, user} strings", () => {
  const p = buildProducerPrompt(ctx());
  assert.equal(typeof p.system, "string");
  assert.equal(typeof p.user, "string");
});

test("buildProducerPrompt enforces strict JSON output instruction in system", () => {
  const p = buildProducerPrompt(ctx());
  assert.match(p.system, /strict JSON/i);
  assert.match(p.system, /no prose/i);
});

test("buildProducerPrompt includes mode allowlist", () => {
  const p = buildProducerPrompt(ctx());
  assert.match(p.system, /"opinion"/);
  assert.match(p.system, /"callback"/);
  assert.match(p.system, /"aside"/);
  assert.match(p.system, /"silence"/);
});

test("buildProducerPrompt mentions silence is valid for auto_track_boundary", () => {
  const p = buildProducerPrompt(ctx());
  assert.match(p.system, /silence/i);
});

test("buildProducerPrompt user message contains trigger + show + tracks + mood", () => {
  const p = buildProducerPrompt(ctx());
  assert.match(p.user, /Dusk/);
  assert.match(p.user, /Prime Hours/);
  assert.match(p.user, /23:15/);
  assert.match(p.user, /synth/);
  assert.match(p.user, /Anna shouted out/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test workers/queue-daemon/lena-producer/producer-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/producer-prompt.ts

import type { ProducerContext } from "./producer-context.ts";

const SYSTEM = `You are the producer for Lena, a calm slightly-studio-slang DJ on Numa Radio.
Your job: decide HOW she responds right now. You do NOT write her words — a separate Writer does.
You only emit a small JSON object describing the decision.

OUTPUT — strict JSON, no prose, no markdown, no code fence:
{
  "mode": "opinion" | "callback" | "aside" | "silence",
  "target_focus": "<one short phrase: what is this line about>",
  "callback_to": "<event id from callbackPool, or null>",
  "length_hint": "short" | "medium" | "long",
  "tone": "dry" | "warm" | "playful" | "low-key",
  "address_listener": null
}

RULES:
- "silence" is a valid and often correct choice here. Real DJs don't fill every break.
- Pick "callback" ONLY if a callbackPool entry genuinely fits the moment — never force one.
- Do not repeat a mode that already appears 3+ times in recentLinesSummary.
- length_hint: short=4-25 words, medium=25-45, long=50-80.
- Tone should track mood — low-key for mellow runs, playful for high-BPM moments, dry by default.
- For this trigger (auto_track_boundary), address_listener is always null.
- callback_to must be a literal id from callbackPool, or null. Never invent ids.`;

export function buildProducerPrompt(ctx: ProducerContext): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Trigger: auto_track_boundary`);
  lines.push(
    `Next track: "${ctx.trigger.nextTrack.title}" by ${ctx.trigger.nextTrack.artist ?? "?"} ` +
      `(${ctx.trigger.nextTrack.genre ?? "?"}, ${ctx.trigger.nextTrack.bpm ?? "?"} BPM)`,
  );
  lines.push(`Local time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  lines.push(
    `Show: ${ctx.show.name} — ${ctx.show.minutesIn}min in, ${ctx.show.minutesUntilNext}min until next`,
  );
  lines.push(`Recent tracks: ${ctx.recentTracksSummary}`);
  lines.push(`Recent Lena lines: ${ctx.recentLinesSummary}`);
  lines.push(
    `Mood: currentRun=${ctx.mood.currentRun.count}x ${ctx.mood.currentRun.genre ?? "?"}, ` +
      `trend=${ctx.mood.tempoTrend}, topGenreThisHour=${ctx.mood.topGenreThisHour ?? "?"}`,
  );
  lines.push(
    `Counters: msSinceLastLine=${ctx.counters.msSinceLastLine === Infinity ? "never" : Math.round(ctx.counters.msSinceLastLine / 1000) + "s"}, ` +
      `tracksSinceLastShoutout=${ctx.counters.tracksSinceLastShoutout}, ` +
      `msSinceLastWeather=${ctx.counters.msSinceLastWeatherMention === Infinity ? "never" : Math.round(ctx.counters.msSinceLastWeatherMention / 60000) + "min"}, ` +
      `msSinceLastStationDrop=${ctx.counters.msSinceLastStationDrop === Infinity ? "never" : Math.round(ctx.counters.msSinceLastStationDrop / 60000) + "min"}`,
  );

  if (ctx.callbackPool.length === 0) {
    lines.push(`Callback pool: (empty)`);
  } else {
    lines.push(`Callback pool:`);
    for (const c of ctx.callbackPool) {
      lines.push(`  - id=${c.id} (${c.minsAgo}min ago): ${c.description}`);
    }
  }

  lines.push("");
  lines.push("Emit the decision JSON now.");

  return { system: SYSTEM, user: lines.join("\n") };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx --test workers/queue-daemon/lena-producer/producer-prompt.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/producer-prompt.ts workers/queue-daemon/lena-producer/producer-prompt.test.ts
git commit -m "lena-producer: producer-prompt (system + user builders)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Safe-default decision (`fallbacks.ts`)

**Files:**
- Create: `workers/queue-daemon/lena-producer/fallbacks.ts`
- Create: `workers/queue-daemon/lena-producer/fallbacks.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// workers/queue-daemon/lena-producer/fallbacks.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeDefaultDecision } from "./fallbacks.ts";

test("safeDefaultDecision for auto_track_boundary returns aside/low-key/short with null callbackTo", () => {
  const d = safeDefaultDecision({ source: "auto_track_boundary" });
  assert.equal(d.mode, "aside");
  assert.equal(d.tone, "low-key");
  assert.equal(d.lengthHint, "short");
  assert.equal(d.callbackTo, null);
  assert.equal(d.addressListener, null);
  assert.equal(typeof d.targetFocus, "string");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test workers/queue-daemon/lena-producer/fallbacks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/fallbacks.ts

import type { ProducerDecision } from "./modes.ts";

/**
 * Deterministic last-resort decision when the Producer LLM call fails
 * twice in a row. For auto_track_boundary, fall back to a short low-key
 * aside — never "silence" as a fallback (we'd rather have a generic
 * line than dead air).
 */
export function safeDefaultDecision(args: { source: "auto_track_boundary" }): ProducerDecision {
  if (args.source === "auto_track_boundary") {
    return {
      mode: "aside",
      targetFocus: "station vibe",
      callbackTo: null,
      lengthHint: "short",
      tone: "low-key",
      addressListener: null,
    };
  }
  throw new Error(`safeDefaultDecision: unsupported source ${args.source}`);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx --test workers/queue-daemon/lena-producer/fallbacks.test.ts`
Expected: 1/1 PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/fallbacks.ts workers/queue-daemon/lena-producer/fallbacks.test.ts
git commit -m "lena-producer: safeDefaultDecision fallback for Producer JSON failure

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Producer runner with JSON parse + retry (`producer.ts`)

**Files:**
- Create: `workers/queue-daemon/lena-producer/producer.ts`
- Create: `workers/queue-daemon/lena-producer/producer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// workers/queue-daemon/lena-producer/producer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runProducer } from "./producer.ts";
import type { ProducerContext } from "./producer-context.ts";

function ctx(): ProducerContext {
  return {
    trigger: {
      source: "auto_track_boundary",
      nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null },
    },
    now: { localTime: "00:00", bucket: "late night" },
    show: { name: "Night Shift", minutesIn: 0, minutesUntilNext: 300 },
    recentTracksSummary: "(no recent tracks)",
    recentLinesSummary: "(no recent Lena lines this shift)",
    callbackPool: [],
    counters: { msSinceLastLine: Infinity, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: Infinity, tracksSinceLastShoutout: 0 },
    mood: { currentRun: { genre: null, count: 0 }, tempoTrend: "steady", avgBpmLast5: null, topGenreThisHour: null },
  };
}

test("runProducer happy path: LLM returns valid JSON → parsed decision", async () => {
  const llm = async () =>
    JSON.stringify({
      mode: "opinion",
      target_focus: "the next track's mood",
      callback_to: null,
      length_hint: "medium",
      tone: "warm",
      address_listener: null,
    });
  const d = await runProducer(ctx(), { llm });
  assert.equal(d.mode, "opinion");
  assert.equal(d.targetFocus, "the next track's mood");
  assert.equal(d.lengthHint, "medium");
  assert.equal(d.tone, "warm");
});

test("runProducer: invalid JSON first time → retries → second valid call wins", async () => {
  let call = 0;
  const llm = async () => {
    call += 1;
    if (call === 1) return "not json at all";
    return JSON.stringify({
      mode: "aside",
      target_focus: "weather",
      callback_to: null,
      length_hint: "short",
      tone: "low-key",
      address_listener: null,
    });
  };
  const d = await runProducer(ctx(), { llm });
  assert.equal(call, 2);
  assert.equal(d.mode, "aside");
});

test("runProducer: two bad calls → safeDefaultDecision (aside / low-key / short)", async () => {
  const llm = async () => "garbage";
  const d = await runProducer(ctx(), { llm });
  assert.equal(d.mode, "aside");
  assert.equal(d.tone, "low-key");
});

test("runProducer: invalid mode (not in PHASE_2_MODES) → retry, then fallback", async () => {
  let call = 0;
  const llm = async () => {
    call += 1;
    return JSON.stringify({
      mode: "queue_pick",
      target_focus: "x",
      callback_to: null,
      length_hint: "short",
      tone: "warm",
      address_listener: null,
    });
  };
  const d = await runProducer(ctx(), { llm });
  assert.equal(call, 2);
  assert.equal(d.mode, "aside"); // fallback
});

test("runProducer: callback_to references unknown id → strip to null, do not retry", async () => {
  const llm = async () =>
    JSON.stringify({
      mode: "opinion",
      target_focus: "x",
      callback_to: "does_not_exist",
      length_hint: "short",
      tone: "warm",
      address_listener: null,
    });
  const d = await runProducer(ctx(), { llm });
  assert.equal(d.mode, "opinion");
  assert.equal(d.callbackTo, null);
});

test("runProducer: silence is allowed for auto_track_boundary", async () => {
  const llm = async () =>
    JSON.stringify({
      mode: "silence",
      target_focus: "",
      callback_to: null,
      length_hint: "short",
      tone: "low-key",
      address_listener: null,
    });
  const d = await runProducer(ctx(), { llm });
  assert.equal(d.mode, "silence");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test workers/queue-daemon/lena-producer/producer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/producer.ts

import type { ProducerContext } from "./producer-context.ts";
import { PHASE_2_MODES, type ProducerDecision } from "./modes.ts";
import { buildProducerPrompt } from "./producer-prompt.ts";
import { safeDefaultDecision } from "./fallbacks.ts";

export interface ProducerDeps {
  /** Single-call LLM that returns the model's text. The producer wraps it with JSON parse + validate + retry. */
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

function parseDecision(
  raw: string,
  validCallbackIds: ReadonlySet<string>,
): ProducerDecision | null {
  let json: unknown;
  try {
    json = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.mode !== "string") return null;
  if (!PHASE_2_MODES.includes(o.mode as never)) return null;
  if (typeof o.target_focus !== "string") return null;
  if (typeof o.length_hint !== "string" || !["short", "medium", "long"].includes(o.length_hint)) return null;
  if (typeof o.tone !== "string" || !["dry", "warm", "playful", "low-key"].includes(o.tone)) return null;
  const callbackToRaw = o.callback_to;
  const callbackTo =
    typeof callbackToRaw === "string" && validCallbackIds.has(callbackToRaw)
      ? callbackToRaw
      : null;
  return {
    mode: o.mode as ProducerDecision["mode"],
    targetFocus: o.target_focus,
    callbackTo,
    lengthHint: o.length_hint as ProducerDecision["lengthHint"],
    tone: o.tone as ProducerDecision["tone"],
    addressListener: null, // auto_track_boundary
  };
}

export async function runProducer(
  ctx: ProducerContext,
  deps: ProducerDeps,
): Promise<ProducerDecision> {
  const validIds = new Set(ctx.callbackPool.map((c) => c.id));
  const baseline = buildProducerPrompt(ctx);

  // Attempt 1
  try {
    const raw = await deps.llm(baseline);
    const parsed = parseDecision(raw, validIds);
    if (parsed) return parsed;
  } catch {
    // fall through to retry
  }

  // Attempt 2 — reinforce JSON output
  const reinforced = {
    system: baseline.system,
    user: `${baseline.user}\n\nIMPORTANT: Output strict JSON only. No prose. No markdown.`,
  };
  try {
    const raw = await deps.llm(reinforced);
    const parsed = parseDecision(raw, validIds);
    if (parsed) return parsed;
  } catch {
    // fall through to safe default
  }

  return safeDefaultDecision({ source: ctx.trigger.source });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx --test workers/queue-daemon/lena-producer/producer.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/producer.ts workers/queue-daemon/lena-producer/producer.test.ts
git commit -m "$(cat <<'EOF'
lena-producer: runProducer (JSON parse + retry + safe default)

One LLM call. Parses strict JSON, validates mode is in PHASE_2_MODES,
strips invalid callback_to refs. On parse failure → reinforced retry.
On second failure → safeDefaultDecision (aside / low-key / short)
so dead air is never the outcome.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Writers — opinion + aside + callback prompts

**Files:**
- Create: `workers/queue-daemon/lena-producer/writers/opinion.ts`
- Create: `workers/queue-daemon/lena-producer/writers/opinion.test.ts`
- Create: `workers/queue-daemon/lena-producer/writers/aside.ts`
- Create: `workers/queue-daemon/lena-producer/writers/aside.test.ts`
- Create: `workers/queue-daemon/lena-producer/writers/callback.ts`
- Create: `workers/queue-daemon/lena-producer/writers/callback.test.ts`

All three writers share a common shape. Build them in one task for cohesion.

- [ ] **Step 1: Write all three tests**

```typescript
// workers/queue-daemon/lena-producer/writers/opinion.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpinionPrompt } from "./opinion.ts";

const decision = { mode: "opinion" as const, targetFocus: "this dusky synth", callbackTo: null, lengthHint: "medium" as const, tone: "warm" as const, addressListener: null };
const ctx = {
  trigger: { source: "auto_track_boundary" as const, nextTrack: { id: "x", title: "Dusk", artist: "Anna", genre: "synth", bpm: 112 } },
  now: { localTime: "23:15", bucket: "night" },
  show: { name: "Prime Hours", minutesIn: 60, minutesUntilNext: 360 },
  recentTracksSummary: "Last 3 tracks: 3 synth.",
  recentLinesSummary: "Last 2: opinion, aside.",
  callbackPool: [],
  counters: { msSinceLastLine: 240_000, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: Infinity, tracksSinceLastShoutout: 0 },
  mood: { currentRun: { genre: "synth", count: 3 }, tempoTrend: "falling" as const, avgBpmLast5: 115, topGenreThisHour: "synth" },
};

test("buildOpinionPrompt returns {system, user}", () => {
  const p = buildOpinionPrompt(decision, ctx, []);
  assert.equal(typeof p.system, "string");
  assert.equal(typeof p.user, "string");
});

test("buildOpinionPrompt bans 'let it ride' and similar in system", () => {
  const p = buildOpinionPrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
  assert.match(p.system, /banned/i);
});

test("buildOpinionPrompt includes target_focus + next track in user", () => {
  const p = buildOpinionPrompt(decision, ctx, []);
  assert.match(p.user, /this dusky synth/);
  assert.match(p.user, /Dusk/);
});

test("buildOpinionPrompt embeds recent_aired_lines for anti-echo", () => {
  const p = buildOpinionPrompt(decision, ctx, ["that one's a vibe", "letting this synth pile up"]);
  assert.match(p.user, /that one's a vibe/);
  assert.match(p.user, /letting this synth pile up/);
});

test("buildOpinionPrompt includes length window from lengthHint", () => {
  const p = buildOpinionPrompt(decision, ctx, []);
  assert.match(p.user, /25-45/); // medium
});
```

```typescript
// workers/queue-daemon/lena-producer/writers/aside.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAsidePrompt } from "./aside.ts";

const decision = { mode: "aside" as const, targetFocus: "late-shift station vibe", callbackTo: null, lengthHint: "short" as const, tone: "low-key" as const, addressListener: null };
const ctx = {
  trigger: { source: "auto_track_boundary" as const, nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
  now: { localTime: "02:30", bucket: "late night" },
  show: { name: "Night Shift", minutesIn: 90, minutesUntilNext: 60 },
  recentTracksSummary: "(no recent tracks)",
  recentLinesSummary: "(no recent Lena lines this shift)",
  callbackPool: [],
  counters: { msSinceLastLine: Infinity, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: Infinity, tracksSinceLastShoutout: 0 },
  mood: { currentRun: { genre: null, count: 0 }, tempoTrend: "steady" as const, avgBpmLast5: null, topGenreThisHour: null },
};

test("buildAsidePrompt returns {system, user}", () => {
  const p = buildAsidePrompt(decision, ctx, []);
  assert.equal(typeof p.system, "string");
});

test("buildAsidePrompt bans 'let it ride'", () => {
  const p = buildAsidePrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
});

test("buildAsidePrompt mentions the bucket and localTime so wording matches the hour", () => {
  const p = buildAsidePrompt(decision, ctx, []);
  assert.match(p.user, /02:30/);
  assert.match(p.user, /late night/);
});

test("buildAsidePrompt includes target_focus", () => {
  const p = buildAsidePrompt(decision, ctx, []);
  assert.match(p.user, /late-shift station vibe/);
});
```

```typescript
// workers/queue-daemon/lena-producer/writers/callback.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCallbackPrompt } from "./callback.ts";

const decision = { mode: "callback" as const, targetFocus: "the late-night thread Anna started", callbackTo: "s1", lengthHint: "medium" as const, tone: "warm" as const, addressListener: null };
const ctx = {
  trigger: { source: "auto_track_boundary" as const, nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
  now: { localTime: "23:30", bucket: "night" },
  show: { name: "Prime Hours", minutesIn: 60, minutesUntilNext: 360 },
  recentTracksSummary: "Last 3 tracks: 3 synth.",
  recentLinesSummary: "Last 2: opinion, aside.",
  callbackPool: [{ id: "s1", description: "Anna shouted out about loving the late-night set", minsAgo: 18 }],
  counters: { msSinceLastLine: 240_000, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: Infinity, tracksSinceLastShoutout: 0 },
  mood: { currentRun: { genre: "synth", count: 3 }, tempoTrend: "steady" as const, avgBpmLast5: 120, topGenreThisHour: "synth" },
};

test("buildCallbackPrompt includes the resolved callback description", () => {
  const p = buildCallbackPrompt(decision, ctx, []);
  assert.match(p.user, /Anna shouted out about loving the late-night set/);
});

test("buildCallbackPrompt has banned phrases list", () => {
  const p = buildCallbackPrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
});

test("buildCallbackPrompt resolves callbackTo='s1' from the pool", () => {
  const p = buildCallbackPrompt(decision, ctx, []);
  assert.match(p.user, /Anna/);
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npx tsx --test workers/queue-daemon/lena-producer/writers/*.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement all three writers**

```typescript
// workers/queue-daemon/lena-producer/writers/opinion.ts

import type { ProducerDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ProducerContext } from "../producer-context.ts";

const SYSTEM = `You write ONE spoken line for Lena, a calm slightly-studio-slang DJ on Numa Radio.
Mode: opinion. You react to a track with TASTE — you have a view, not a description.

RULES:
- Contractions. Spoken English. No poetry. No "wandering piano lines" / "dawn peeking through curtains".
- Have an opinion: "I love this one", "earned its slot tonight", "I'd skip but it grew on me", "this is a re-listen kind of track".
- Do not use any 4+ word substring from recently_aired_lines.
- BANNED phrases (forever): "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".
- Do not name the show unless it genuinely serves the line.

OUTPUT: one line. No quotes. No stage directions. No JSON. Just the spoken text.`;

export function buildOpinionPrompt(
  decision: ProducerDecision,
  ctx: ProducerContext,
  recentAiredLines: readonly string[],
): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const t = ctx.trigger.nextTrack;
  const lines: string[] = [];
  lines.push(`target_focus: ${decision.targetFocus}`);
  lines.push(`next_track: "${t.title}" by ${t.artist ?? "unknown"} (${t.genre ?? "?"}, ${t.bpm ?? "?"} BPM)`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAiredLines.length > 0) {
    lines.push(`recently_aired_lines (DO NOT echo their phrasing):`);
    for (const l of recentAiredLines) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write the line now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

```typescript
// workers/queue-daemon/lena-producer/writers/aside.ts

import type { ProducerDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ProducerContext } from "../producer-context.ts";

const SYSTEM = `You write ONE spoken line for Lena, a calm slightly-studio-slang DJ on Numa Radio.
Mode: aside. You're not talking about the music — you're talking about the moment.
Weather, time of day, late-shift vibe, station-running observation, a small noticing.

RULES:
- Contractions. Spoken English. No poetry.
- Match the bucket: late-night gets quieter, evening more conversational, morning brighter.
- Do not use any 4+ word substring from recently_aired_lines.
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".
- If the bucket is "late night" and target_focus is generic, prefer something a 2am DJ would actually notice.

OUTPUT: one line. No quotes. No stage directions.`;

export function buildAsidePrompt(
  decision: ProducerDecision,
  ctx: ProducerContext,
  recentAiredLines: readonly string[],
): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const lines: string[] = [];
  lines.push(`target_focus: ${decision.targetFocus}`);
  lines.push(`local_time: ${ctx.now.localTime} (${ctx.now.bucket})`);
  lines.push(`show: ${ctx.show.name}`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAiredLines.length > 0) {
    lines.push(`recently_aired_lines (DO NOT echo):`);
    for (const l of recentAiredLines) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write the line now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

```typescript
// workers/queue-daemon/lena-producer/writers/callback.ts

import type { ProducerDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ProducerContext } from "../producer-context.ts";

const SYSTEM = `You write ONE spoken line for Lena, a calm slightly-studio-slang DJ on Numa Radio.
Mode: callback. You're tying THIS moment to something that happened earlier in the shift.

RULES:
- Contractions. Spoken English. No poetry.
- Reference the earlier event NATURALLY — don't say "earlier" or "before"; just place it: "Anna's been with us tonight", "third synth track since that shoutout".
- Do not use any 4+ word substring from recently_aired_lines.
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".

OUTPUT: one line. No quotes. No stage directions.`;

export function buildCallbackPrompt(
  decision: ProducerDecision,
  ctx: ProducerContext,
  recentAiredLines: readonly string[],
): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const cb = ctx.callbackPool.find((c) => c.id === decision.callbackTo);
  const lines: string[] = [];
  lines.push(`target_focus: ${decision.targetFocus}`);
  lines.push(
    `callback_event: ${cb ? `${cb.description} (${cb.minsAgo}min ago)` : "(unresolved — write a general observation instead)"}`,
  );
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAiredLines.length > 0) {
    lines.push(`recently_aired_lines (DO NOT echo):`);
    for (const l of recentAiredLines) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write the line now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

- [ ] **Step 4: Run to verify all pass**

Run: `npx tsx --test workers/queue-daemon/lena-producer/writers/*.test.ts`
Expected: 12/12 PASS (5 opinion + 4 aside + 3 callback).

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/writers/
git commit -m "$(cat <<'EOF'
lena-producer: per-mode writer prompts (opinion, aside, callback)

Each writer gets the Producer's decision + the minimum context for
its mode (next_track for opinion, time-of-day for aside, callback
event description for callback). All three include the banned-phrase
list ('let it ride' etc.) and an anti-echo block against recently
aired lines.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Writer dispatcher (`writer.ts`)

**Files:**
- Create: `workers/queue-daemon/lena-producer/writer.ts`
- Create: `workers/queue-daemon/lena-producer/writer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// workers/queue-daemon/lena-producer/writer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runWriter } from "./writer.ts";
import type { ProducerContext } from "./producer-context.ts";
import type { ProducerDecision } from "./modes.ts";

const ctx: ProducerContext = {
  trigger: { source: "auto_track_boundary", nextTrack: { id: "x", title: "Dusk", artist: "Anna", genre: "synth", bpm: 112 } },
  now: { localTime: "23:15", bucket: "night" },
  show: { name: "Prime Hours", minutesIn: 60, minutesUntilNext: 360 },
  recentTracksSummary: "(none)",
  recentLinesSummary: "(none)",
  callbackPool: [{ id: "s1", description: "Anna shouted out earlier", minsAgo: 18 }],
  counters: { msSinceLastLine: Infinity, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: Infinity, tracksSinceLastShoutout: 0 },
  mood: { currentRun: { genre: null, count: 0 }, tempoTrend: "steady", avgBpmLast5: null, topGenreThisHour: null },
};

test("runWriter mode=opinion uses opinion prompt and returns the LLM's trimmed text", async () => {
  const decision: ProducerDecision = { mode: "opinion", targetFocus: "x", callbackTo: null, lengthHint: "short", tone: "warm", addressListener: null };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /opinion/i);
    return "  this one's grown on me.  \n";
  };
  const out = await runWriter(decision, ctx, [], { llm });
  assert.equal(out, "this one's grown on me.");
});

test("runWriter mode=aside uses aside prompt", async () => {
  const decision: ProducerDecision = { mode: "aside", targetFocus: "x", callbackTo: null, lengthHint: "short", tone: "low-key", addressListener: null };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /aside/i);
    return "still and easy in here tonight.";
  };
  const out = await runWriter(decision, ctx, [], { llm });
  assert.equal(out, "still and easy in here tonight.");
});

test("runWriter mode=callback uses callback prompt", async () => {
  const decision: ProducerDecision = { mode: "callback", targetFocus: "x", callbackTo: "s1", lengthHint: "short", tone: "warm", addressListener: null };
  const llm = async (p: { system: string }) => {
    assert.match(p.system, /callback/i);
    return "anna's been with us a while.";
  };
  const out = await runWriter(decision, ctx, [], { llm });
  assert.equal(out, "anna's been with us a while.");
});

test("runWriter mode=silence returns null without calling LLM", async () => {
  const decision: ProducerDecision = { mode: "silence", targetFocus: "", callbackTo: null, lengthHint: "short", tone: "low-key", addressListener: null };
  let called = false;
  const llm = async () => {
    called = true;
    return "should not call";
  };
  const out = await runWriter(decision, ctx, [], { llm });
  assert.equal(out, null);
  assert.equal(called, false);
});

test("runWriter throws on unsupported mode (for Phase 2 — answer/shoutout_read etc. land in 3-5)", async () => {
  const decision: ProducerDecision = { mode: "answer", targetFocus: "x", callbackTo: null, lengthHint: "short", tone: "warm", addressListener: null };
  const llm = async () => "ok";
  await assert.rejects(() => runWriter(decision, ctx, [], { llm }), /unsupported mode/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test workers/queue-daemon/lena-producer/writer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/writer.ts

import type { ProducerDecision } from "./modes.ts";
import type { ProducerContext } from "./producer-context.ts";
import { buildOpinionPrompt } from "./writers/opinion.ts";
import { buildAsidePrompt } from "./writers/aside.ts";
import { buildCallbackPrompt } from "./writers/callback.ts";

export interface WriterDeps {
  llm: (prompts: { system: string; user: string }) => Promise<string>;
}

export async function runWriter(
  decision: ProducerDecision,
  ctx: ProducerContext,
  recentAiredLines: readonly string[],
  deps: WriterDeps,
): Promise<string | null> {
  if (decision.mode === "silence") return null;

  let prompts: { system: string; user: string };
  if (decision.mode === "opinion") prompts = buildOpinionPrompt(decision, ctx, recentAiredLines);
  else if (decision.mode === "aside") prompts = buildAsidePrompt(decision, ctx, recentAiredLines);
  else if (decision.mode === "callback") prompts = buildCallbackPrompt(decision, ctx, recentAiredLines);
  else throw new Error(`unsupported mode for Phase 2: ${decision.mode}`);

  const raw = await deps.llm(prompts);
  return raw.trim();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx --test workers/queue-daemon/lena-producer/writer.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/writer.ts workers/queue-daemon/lena-producer/writer.test.ts
git commit -m "lena-producer: writer dispatcher (opinion / aside / callback / silence)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: lenaSpeak public API (`index.ts`)

**Files:**
- Create: `workers/queue-daemon/lena-producer/index.ts`
- Create: `workers/queue-daemon/lena-producer/index.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// workers/queue-daemon/lena-producer/index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lenaSpeak, type LenaResult } from "./index.ts";
import { ShiftMemory } from "./shift-memory.ts";

test("lenaSpeak auto_track_boundary happy path: Producer→Writer→{ text, mode }", async () => {
  const mem = new ShiftMemory();
  const calls: string[] = [];
  const llm = async (p: { system: string }) => {
    calls.push(p.system.slice(0, 40));
    if (p.system.startsWith("You are the producer")) {
      return JSON.stringify({
        mode: "opinion",
        target_focus: "this one",
        callback_to: null,
        length_hint: "short",
        tone: "warm",
        address_listener: null,
      });
    }
    return "this one's a sleeper hit.";
  };
  const r: LenaResult | null = await lenaSpeak({
    trigger: { source: "auto_track_boundary", nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
    memory: mem,
    llm,
    nowMs: Date.now(),
  });
  assert.ok(r);
  assert.equal(r!.mode, "opinion");
  assert.equal(r!.text, "this one's a sleeper hit.");
  assert.equal(calls.length, 2); // Producer then Writer
});

test("lenaSpeak returns null when Producer chooses silence", async () => {
  const mem = new ShiftMemory();
  const llm = async () =>
    JSON.stringify({
      mode: "silence",
      target_focus: "",
      callback_to: null,
      length_hint: "short",
      tone: "low-key",
      address_listener: null,
    });
  const r = await lenaSpeak({
    trigger: { source: "auto_track_boundary", nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
    memory: mem,
    llm,
    nowMs: Date.now(),
  });
  assert.equal(r, null);
});

test("lenaSpeak falls back when Producer fails twice then Writer also fails — returns null (caller falls back to legacy path)", async () => {
  const mem = new ShiftMemory();
  let llmCalls = 0;
  const llm = async (p: { system: string }) => {
    llmCalls += 1;
    if (p.system.startsWith("You are the producer")) return "garbage";
    throw new Error("writer down");
  };
  const r = await lenaSpeak({
    trigger: { source: "auto_track_boundary", nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
    memory: mem,
    llm,
    nowMs: Date.now(),
  });
  assert.equal(r, null);
  assert.ok(llmCalls >= 3); // producer x2 + writer x1
});

test("lenaSpeak passes last 5 lena lines to Writer for anti-echo", async () => {
  const mem = new ShiftMemory();
  const now = Date.now();
  for (let i = 0; i < 5; i += 1) {
    mem.record({
      type: "lena_line_aired",
      id: `c${i}`,
      mode: "opinion",
      targetFocus: null,
      text: `line ${i}`,
      airedAt: now - (5 - i) * 60_000,
      trigger: "auto_track_boundary",
      addressedListener: null,
    });
  }
  let writerUserSeen = "";
  const llm = async (p: { system: string; user: string }) => {
    if (p.system.startsWith("You are the producer")) {
      return JSON.stringify({
        mode: "opinion",
        target_focus: "x",
        callback_to: null,
        length_hint: "short",
        tone: "warm",
        address_listener: null,
      });
    }
    writerUserSeen = p.user;
    return "fresh line";
  };
  await lenaSpeak({
    trigger: { source: "auto_track_boundary", nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
    memory: mem,
    llm,
    nowMs: now,
  });
  assert.match(writerUserSeen, /line 4/);
  assert.match(writerUserSeen, /line 0/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test workers/queue-daemon/lena-producer/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
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
}

export interface LenaSpeakArgs {
  trigger: AutoTrackBoundaryTrigger;
  memory: ShiftMemory;
  llm: (prompts: { system: string; user: string }) => Promise<string>;
  nowMs: number;
}

/**
 * Phase 2 public API for auto_track_boundary trigger.
 * Returns null when Producer picks silence OR when Writer fails — caller
 * (auto-host.ts) should fall back to the legacy single-call path on null.
 */
export async function lenaSpeak(args: LenaSpeakArgs): Promise<LenaResult | null> {
  const view = args.memory.view(args.nowMs);
  const ctx = buildProducerContext({ memoryView: view, trigger: args.trigger, nowMs: args.nowMs });

  const decision = await runProducer(ctx, { llm: args.llm });
  if (decision.mode === "silence") return null;

  const recentAiredLines = view.recentLines.slice(0, 5).map((l) => l.text);
  try {
    const text = await runWriter(decision, ctx, recentAiredLines, { llm: args.llm });
    if (!text) return null;
    return { text, mode: decision.mode, targetFocus: decision.targetFocus };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx --test workers/queue-daemon/lena-producer/index.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/index.ts workers/queue-daemon/lena-producer/index.test.ts
git commit -m "$(cat <<'EOF'
lena-producer: lenaSpeak public API (Producer + Writer for auto-break)

Single entry-point for the Phase 2 trigger (auto_track_boundary).
Reads ShiftMemory.view(), builds ProducerContext, runs Producer →
Writer. Returns null on silence OR Writer failure so the caller
falls back to the existing single-call path.

Last 5 lena_line_aired events are passed to the Writer as
recentAiredLines for anti-echo.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire `lenaSpeak` into `auto-host.ts` (behind flag)

This is the integration point. When `LENA_PRODUCER_AUTO=on`, `generateAsset()` calls `lenaSpeak` instead of the legacy `promptFor + generateScript` path. Otherwise it stays exactly as today.

**Files:**
- Modify: `workers/queue-daemon/auto-host.ts`

Two strategies for the wiring:

**Strategy chosen — add an optional dependency.** Keeps the auto-host class testable. The daemon-boot wiring (Task 11) decides whether to inject the real `lenaSpeak` or `undefined`.

- [ ] **Step 1: Read the current shape**

Open `workers/queue-daemon/auto-host.ts`. Confirm:
- `AutoHostDeps` interface defines `generateScript`, `synthesizeSpeech`, `uploadChatter`, `pushToOverlay`, `logPush`, `persistChatter`, `logFailure`, `randomGate?`, `config?`, `revertExpired?`, `fetchWorldAside?`, `now?`
- `generateAsset` reads `this.deps.generateScript(prompts)` at ~line 529
- `ReadyAsset` interface includes `{ chatterId, type, slot, url, script }`

- [ ] **Step 2: Extend the type definitions**

In `auto-host.ts`, locate the `AutoHostDeps` interface (search `AutoHostDeps`). Add new optional fields:

```typescript
// In AutoHostDeps interface, add:
/** Phase 2: when present and Producer flag is on, lenaSpeak replaces generateScript for auto-break content. */
lenaSpeak?: (trigger: { source: "auto_track_boundary"; nextTrack: { id: string; title: string; artist: string | null; genre: string | null; bpm: number | null } }) => Promise<{ text: string; mode: string; targetFocus: string } | null>;
/** Returns true when the Producer code path should be used. */
isProducerEnabled?: () => boolean;
```

In the `ReadyAsset` interface, add an optional field:

```typescript
// In ReadyAsset interface, add:
producerVersion?: number;
producerMode?: string;
```

In the `persistChatter` dep signature (in `AutoHostDeps`), accept the new optional fields (look for `persistChatter: (args: { type, slot, url, script }) => Promise<void>` — extend args):

```typescript
persistChatter: (args: {
  type: string;
  slot: number;
  url: string;
  script: string;
  producerVersion?: number;
  producerMode?: string;
}) => Promise<void>;
```

(Adjust the `type` field name if the existing signature differs.)

- [ ] **Step 3: Insert the gate inside `generateAsset`**

Find the block around line 522-537 that reads:

```typescript
let script: string;
if (externalScript) {
  script = externalScript;
} else {
  const prompts = promptFor(type, context);
  try {
    script = await this.deps.generateScript(prompts);
  } catch (e) {
    this.deps.logFailure({ reason: "auto_chatter_script_failed", detail: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
```

Replace with:

```typescript
let script: string;
let producerVersion: number | undefined;
let producerMode: string | undefined;

if (externalScript) {
  // World_aside: NanoClaw already wrote the line. Skip MiniMax.
  script = externalScript;
} else if (this.deps.lenaSpeak && this.deps.isProducerEnabled?.()) {
  // Phase 2 Producer path. nextTrack metadata is derived from `current`
  // (the about-to-play track) or a generic placeholder for filler slots.
  const nextTrack = current
    ? {
        id: current.trackId ?? "unknown",
        title: current.title,
        artist: current.artist,
        genre: current.genre ?? null,
        bpm: current.bpm ?? null,
      }
    : { id: "unknown", title: "(next track)", artist: null, genre: null, bpm: null };
  try {
    const r = await this.deps.lenaSpeak({ source: "auto_track_boundary", nextTrack });
    if (!r) {
      // Producer chose silence OR Writer failed. Skip this break entirely
      // (no script, no audio) — the rotation slot advances regardless.
      this.deps.logFailure({ reason: "producer_silence_or_writer_fail" });
      return null;
    }
    script = r.text;
    producerVersion = 1;
    producerMode = r.mode;
  } catch (e) {
    this.deps.logFailure({
      reason: "producer_unexpected_error",
      detail: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
} else {
  // Legacy single-call path (default until LENA_PRODUCER_AUTO=on).
  const prompts = promptFor(type, context);
  try {
    script = await this.deps.generateScript(prompts);
  } catch (e) {
    this.deps.logFailure({
      reason: "auto_chatter_script_failed",
      detail: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
```

> NOTE: the field names `current.trackId`, `current.genre`, `current.bpm` may or may not exist on `CurrentTrackInfo` in this file. Grep the type definition (`grep -n "interface CurrentTrackInfo\|type CurrentTrackInfo" workers/queue-daemon/auto-host.ts workers/queue-daemon/*.ts`) and adjust the fields to whatever's actually available. For Phase 2 it's OK if `genre`/`bpm` come through as null because the legacy code didn't surface them either.

- [ ] **Step 4: Return the new fields on the ReadyAsset**

At the bottom of `generateAsset` (the `return { chatterId, type, slot, url, script }` line at ~570), extend to include the new optional fields:

```typescript
return { chatterId, type, slot, url, script, producerVersion, producerMode };
```

- [ ] **Step 5: Update wherever the asset is persisted**

Inside `auto-host.ts`, find where `persistChatter` is called (search `persistChatter`). Extend the call to pass through the new fields:

```typescript
await this.deps.persistChatter({
  type: asset.type,
  slot: asset.slot,
  url: asset.url,
  script: asset.script,
  producerVersion: asset.producerVersion,
  producerMode: asset.producerMode,
});
```

(If the existing call uses different arg names, preserve them — only add the two new fields.)

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit workers/queue-daemon/auto-host.ts 2>&1 | head -20`

Ignore unrelated pre-existing errors. Confirm no NEW errors caused by your changes. If `current.trackId` or similar field names don't exist, adjust per Step 3's note.

- [ ] **Step 7: Update auto-host tests (if any break)**

Run: `npx tsx --test workers/queue-daemon/auto-host.test.ts 2>&1 | tail -20`

If existing tests pass because the new fields are optional, great. If any fail because the `persistChatter` mock signature changed, update the mock to accept the new optional fields.

- [ ] **Step 8: Commit**

```bash
git add workers/queue-daemon/auto-host.ts workers/queue-daemon/auto-host.test.ts
git commit -m "$(cat <<'EOF'
auto-host: gate Producer path in generateAsset (Phase 2)

When lenaSpeak dep is present AND isProducerEnabled() returns true,
auto-break content comes from the Producer + Writer split. Otherwise
the legacy promptFor + generateScript path runs unchanged.

ReadyAsset gains optional producerVersion / producerMode so the
chatter persistence layer can tag the row (set producerVersion=1 for
Producer-era rows, null for legacy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Wire daemon boot (`workers/queue-daemon/index.ts`)

The orchestrator needs to inject `lenaSpeak` + `isProducerEnabled` deps into the existing `autoHost = new AutoHostOrchestrator({...})` call site. Also extends `persistChatter` to write `producerVersion`.

**Files:**
- Modify: `workers/queue-daemon/index.ts`

- [ ] **Step 1: Locate the autoHost instantiation**

Find the existing `autoHost = ...` or `new AutoHostOrchestrator({...})` call. The `persistChatter` dep is currently:

```typescript
persistChatter: async ({ type, slot, url, script }) => {
  const sid = await stationId();
  await prisma.chatter.create({
    data: { stationId: sid, chatterType: type, slot, script, audioUrl: url },
  });
},
```

(This is around line 232-243 in the file you saw earlier.)

- [ ] **Step 2: Extend persistChatter to accept and write producerVersion + producerMode**

Replace with:

```typescript
persistChatter: async ({ type, slot, url, script, producerVersion, producerMode }) => {
  const sid = await stationId();
  await prisma.chatter.create({
    data: {
      stationId: sid,
      // For Producer-era rows, chatterType stores the ProducerMode string
      // (opinion/aside/callback). Legacy rows keep their rotation type.
      chatterType: producerMode ?? type,
      slot,
      script,
      audioUrl: url,
      producerVersion: producerVersion ?? null,
    },
  });
},
```

- [ ] **Step 3: Add the new imports near the top of the file**

Alongside the existing Lena Producer imports (Phase 1 added some — find `from "./lena-producer/`):

```typescript
import { lenaSpeak as runLenaSpeak } from "./lena-producer/index.ts";
import { isProducerAutoEnabled } from "./lena-producer/feature-flag.ts";
```

- [ ] **Step 4: Inject the new deps when constructing autoHost**

In the `new AutoHostOrchestrator({...})` call, add (after the existing deps, alongside `persistChatter`):

```typescript
isProducerEnabled: () => isProducerAutoEnabled(process.env),
lenaSpeak: async (trigger) => {
  // shiftMemory is the Phase 1 singleton wired in the same boot block
  // — only available when LENA_SHIFT_MEMORY=on. If it's not present,
  // the Producer can't read history and would be flying blind, so
  // refuse and let auto-host fall back to legacy.
  if (!shiftMemory) return null;
  return runLenaSpeak({
    trigger,
    memory: shiftMemory,
    nowMs: Date.now(),
    llm: async (prompts) =>
      generateChatterScript(prompts, { apiKey: process.env.MINIMAX_API_KEY ?? "" }),
  });
},
```

> NOTE: `shiftMemory` is the local variable from Phase 1's boot wiring (look for `const shiftMemory = new ShiftMemory()` inside the `if (isShiftMemoryEnabled(process.env)) { ... }` block — but it's scoped inside that block). To make it visible to autoHost, lift its declaration above the `if`: declare `let shiftMemory: ShiftMemory | null = null;` before the if-block, assign inside.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit workers/queue-daemon/index.ts 2>&1 | head -20`

Fix any scope issues with `shiftMemory`. Confirm no new errors.

- [ ] **Step 6: Smoke test (locally, if DB reachable)**

```bash
# Flag OFF (default): old behavior
npx tsx workers/queue-daemon/index.ts &
sleep 5
kill %1
# Expect: "[lena-shift-memory] disabled" (if you haven't set the env)
# AND NO new Producer-related logs.

# Both flags on:
LENA_SHIFT_MEMORY=on LENA_PRODUCER_AUTO=on npx tsx workers/queue-daemon/index.ts &
sleep 5
kill %1
# Expect: "[lena-shift-memory] booted..." — Producer path is now armed
# but only fires on next track boundary (no log on boot).
```

Skip if local DB isn't reachable.

- [ ] **Step 7: Commit**

```bash
git add workers/queue-daemon/index.ts
git commit -m "$(cat <<'EOF'
queue-daemon: inject lenaSpeak + isProducerEnabled deps into autoHost

Producer path activates when LENA_PRODUCER_AUTO=on AND
LENA_SHIFT_MEMORY=on (Producer needs ShiftMemory to read history).
persistChatter now writes producerVersion=1 for Producer-era rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: HANDOFF.md Phase 2 deploy notes

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Update Last-updated + prepend new section**

Change `Last updated: 2026-05-16` to today's date (today is 2026-05-16, so leave if same-day).

Prepend after the first `---` divider:

```markdown
## 2026-05-16 — Lena Producer Phase 2: Producer + Writer for auto-chatter — CODE READY, NEEDS DEPLOY

First user-visible Lena change. Behind `LENA_PRODUCER_AUTO` flag,
default off. Phase 1 (ShiftMemory) MUST be deployed and `LENA_SHIFT_MEMORY=on`
for the Producer path to activate — Producer needs ShiftMemory.view()
to read history.

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`
**Plan:** `docs/superpowers/plans/2026-05-16-lena-producer-phase-2.md`

**What ships:**
- `workers/queue-daemon/lena-producer/` adds: producer.ts (JSON-validated
  decision), writer.ts (per-mode prompt dispatcher), writers/
  {opinion,aside,callback}.ts, producer-context.ts, producer-prompt.ts,
  modes.ts, fallbacks.ts, index.ts (lenaSpeak public API)
- `auto-host.ts:generateAsset` gated: if `LENA_PRODUCER_AUTO=on` AND
  lenaSpeak dep present, use the new pipeline; otherwise legacy
  promptFor+generateScript runs unchanged.
- Chatter rows from the Producer path get `producerVersion: 1` and
  `chatterType` set to the ProducerMode ("opinion" / "aside" /
  "callback"). Legacy rows keep their rotation type.

**Deploy:**
1. `cd /home/marku/saas/numaradio && git pull`
2. Confirm Phase 1 is live: `LENA_SHIFT_MEMORY=on` in `/etc/numa/env`
   and the daemon log shows `[lena-shift-memory] booted with N events`
3. Add `LENA_PRODUCER_AUTO=on` to `/etc/numa/env`:
   ```
   sudo nano /etc/numa/env
   # add: LENA_PRODUCER_AUTO=on
   ```
4. `sudo systemctl restart numa-queue-daemon`
5. Watch the first 3-5 auto-chatter breaks:
   ```
   journalctl --user -u numa-queue-daemon -f | grep -E "auto-chatter|producer"
   ```
   Expect Lena lines that don't say "let it ride", vary in length
   (sometimes silence — that's Producer choosing not to talk), and
   occasionally reference earlier shoutouts ("Anna's been with us
   tonight" patterns).

**Rollback:** `LENA_PRODUCER_AUTO=off` in `/etc/numa/env`, restart
the daemon. Code stays loaded but the gate flips back to legacy path.

**What to watch:**
- Producer falls back to safe-default (aside / low-key / short) on
  malformed JSON — search `safeDefaultDecision` hits in logs.
- If `producer_silence_or_writer_fail` fires often → either the
  Writer LLM is flaky or the silence rate feels too high (tune by
  editing producer-prompt.ts rules).
- Latency: Producer + Writer is 2 MiniMax calls. ~2-8s typical, ~16s
  worst-case with one Producer retry. Auto-host's existing timing
  budget covers this for tracks >90s; very short tracks may see
  pre-push offset eaten. Monitor via `[auto-chatter] slot=...`
  log spacing.

**Next phase:** Phase 2.5 extends the YouTube classifier with `request`
+ `shoutout_with_request` intents (no behavior change, just new
classifier outputs ready for Phases 3/5 to consume).

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs: HANDOFF — Phase 2 (Producer + Writer for auto-chatter) deploy notes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test 2>&1 | grep -E "^(ℹ|# )" | tail -10`
Expected: ~540+ tests pass. Allow the pre-existing `workers/song-worker/prompt-expand.test.ts` failure (not introduced by Phase 2). All Phase 2 tests (~28-30 new) green.

- [ ] **Step 2: Build the public site**

Run: `npm run build 2>&1 | grep -E "(error|Error|✓ Compiled|Failed)"`
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Build the dashboard**

Run: `cd dashboard && npm run build 2>&1 | grep -E "(error|Error|✓ Compiled|Failed)"`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Review commits**

Run: `git log --oneline origin/main..HEAD | head -20`
Expected: ~12 new commits from Phase 2 on top of Phase 1's 24.

- [ ] **Step 5: DO NOT push** — user controls deploy.

---

## What ships at end of Phase 2

✅ `LENA_PRODUCER_AUTO` feature flag (default off)
✅ ProducerContext + Producer + Writer modules (~10 new files)
✅ Per-mode writers: opinion / aside / callback (silence is a no-op)
✅ JSON parse + retry + safe default in Producer
✅ Banned-phrase list ("let it ride" etc.) on all Writer prompts
✅ Anti-echo via recently-aired-lines passed to Writer
✅ auto-host.ts gates Producer path behind flag — zero behavior change when off
✅ Chatter rows tagged `producerVersion: 1` for Producer-era output
✅ Legacy `chatter-prompts.ts` path preserved as default and as fallback

🔜 Phase 2.5 extends YouTube classifier with `request` + `shoutout_with_request`
🔜 Phase 3 routes YouTube replies through lenaSpeak
🔜 Phase 4 routes shoutout narration through lenaSpeak + fixes `,.` regex
🔜 Phase 5 adds QueueDirector + queue autonomy
🔜 Phase 6 deletes deprecated paths
