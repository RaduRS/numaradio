# Lena Producer — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the foundation for the Lena Producer architecture: in-memory ShiftMemory in the queue-daemon that records shift events (tracks aired, Lena lines, shoutouts, YouTube mentions), derives views (counters, mood, callback pool), reconstructs from the database on daemon restart, and accepts cross-process events via Postgres LISTEN/NOTIFY. **No Lena behavior changes ship in this phase** — all reads are observability-only behind the `LENA_SHIFT_MEMORY` feature flag.

**Architecture:** A singleton ShiftMemory class lives in the long-running queue-daemon process. It maintains a capped raw event log; derived views (counters, mood, callback pool, recentLines) are recomputed lazily on read. Cross-process emitters (Next.js routes for track-started, shoutout-airing, YouTube chat) call `pg_notify` on a `lena_event` channel; the daemon listens on a dedicated pg connection and ingests events. A 5-second DB poll runs as a fallback whenever the NOTIFY connection drops or stalls.

**Tech Stack:** TypeScript (`tsx`), Next.js (App Router), Prisma + raw `pg` (for LISTEN/NOTIFY), Node `node:test` runner with `--experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`

---

## File Structure

### Created in this phase

```
workers/queue-daemon/lena-producer/
├── shift-event.ts            # ShiftEvent union types + helpers
├── shift-memory.ts           # singleton class: record(), view()
├── shift-memory.test.ts      # unit tests
├── derived-counters.ts       # pure function: log → counters
├── derived-counters.test.ts
├── derived-mood.ts           # pure function: log → mood
├── derived-mood.test.ts
├── derived-callbacks.ts      # pure function: log → callbackPool
├── derived-callbacks.test.ts
├── derived-show.ts           # pure function: now → { name, minutesIn, minutesUntilNext, shiftStart }
├── derived-show.test.ts
├── callback-summarizer.ts    # async event → human-readable description
├── callback-summarizer.test.ts
├── reconstruction.ts         # boot-time: DB → events
├── reconstruction.test.ts
├── notify-listener.ts        # pg LISTEN client, reconnect, fallback poll
├── notify-listener.test.ts
└── feature-flag.ts           # reads LENA_SHIFT_MEMORY env

app/api/lena/event/route.ts   # HTTP fallback for emitters that can't pg_notify

prisma/migrations/<timestamp>_add_chatter_producer_version/
└── migration.sql             # ALTER TABLE "Chatter" ADD COLUMN "producerVersion" INT;
```

### Modified

| File | What |
|---|---|
| `prisma/schema.prisma:212-226` | Add `producerVersion Int?` to `Chatter` model |
| `workers/queue-daemon/index.ts` | Wire `ShiftMemory` singleton + `notify-listener` on boot |
| `app/api/internal/track-started/route.ts` | Emit `track_aired` via `pg_notify` after the existing transaction |
| `dashboard/lib/shoutout.ts` | Emit `shoutout_aired` via `pg_notify` after broadcast |
| `workers/queue-daemon/youtube-chat-loop.ts` | Emit `youtube_mention` via `pg_notify` after dispatch decision |

### Not modified in this phase (Phase 2+ work)

- `workers/queue-daemon/auto-host.ts` (no Producer call yet)
- `workers/queue-daemon/chatter-prompts.ts`
- `lib/lena-reply.ts` (still uses existing prompt)
- `dashboard/lib/humanize.ts` (still uses existing prompt)

---

## Conventions

- **Tests:** Use `node:test`. Run with `npm test` (test runner already wired in `package.json:scripts.test`).
- **Env loading:** Scripts that need env vars use `import "../../lib/load-env"` first.
- **Path alias:** `@/*` resolves to repo root.
- **Imports inside `workers/queue-daemon/lena-producer/`:** use relative paths within the module (`./shift-event.ts`), use `@/lib/...` for shared, and avoid importing from `workers/queue-daemon/*` files that don't already export cleanly.
- **Commits:** one commit per task. Sign-off `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Next.js note:** This repo's `AGENTS.md` warns: "This is NOT the Next.js you know — read the relevant guide in `node_modules/next/dist/docs/` before writing any code." For any Next.js route changes, peek at one neighboring route (`app/api/internal/track-started/route.ts` is a good reference) before writing the new one.
- **`pg` client:** Already in `package.json` deps (`pg ^8.20.0`, `@types/pg ^8.20.0`). Use it directly for LISTEN — Prisma's `$queryRaw` cannot subscribe to NOTIFY.

---

## Task 1: Prisma migration — `Chatter.producerVersion`

**Files:**
- Modify: `prisma/schema.prisma:212-226`
- Create: `prisma/migrations/<auto-named>_add_chatter_producer_version/migration.sql`

- [ ] **Step 1: Edit schema.prisma**

Add the new column to the existing `Chatter` model:

```prisma
model Chatter {
  id              String   @id @default(cuid())
  stationId       String
  /// "back_announce" | "shoutout_cta" | "song_cta" | "filler" | (post-Producer: any ProducerMode string)
  chatterType     String
  /// 1..20 — slot index in the daemon's rotation buffer (pre-Producer); null for Producer-era rows
  slot            Int
  script          String
  audioUrl        String?
  airedAt         DateTime @default(now())
  /// null for pre-Producer rows; 1+ for Producer-era rows so reconstruction can distinguish vocabularies.
  producerVersion Int?

  station Station @relation(fields: [stationId], references: [id])

  @@index([stationId, airedAt])
}
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_chatter_producer_version --create-only`
Expected: a new directory under `prisma/migrations/` containing `migration.sql` with `ALTER TABLE "Chatter" ADD COLUMN "producerVersion" INTEGER;`

- [ ] **Step 3: Verify migration is reversible and additive**

Open the generated `migration.sql` and confirm it is a single `ALTER TABLE ... ADD COLUMN ... INTEGER;` line, no `NOT NULL`, no default. (Nullable so existing rows aren't touched.)

- [ ] **Step 4: Apply locally and regenerate the client**

Run: `npx prisma migrate deploy && npx prisma generate`
Expected: "All migrations have been successfully applied." Client regenerates with `producerVersion: number | null` on Chatter.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "$(cat <<'EOF'
db: add Chatter.producerVersion for Lena Producer reconstruction

Phase 1 of the Lena Producer architecture. Null for pre-Producer rows,
≥1 for Producer-era rows so daemon-restart reconstruction can
distinguish the old chatterType vocabulary from the new ProducerMode
vocabulary that ships in Phase 2.

Pure additive migration; existing rows untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `ShiftEvent` type definitions

**Files:**
- Create: `workers/queue-daemon/lena-producer/shift-event.ts`

- [ ] **Step 1: Write the type module**

```typescript
// workers/queue-daemon/lena-producer/shift-event.ts

/**
 * ShiftEvent: a discriminated union representing every observable thing that
 * happens during Lena's current shift. ShiftMemory keeps a rolling log of
 * these and derives views (counters, mood, callback pool) from them.
 *
 * All timestamps are Unix epoch milliseconds (Date.now() compatible).
 */

export type ProducerMode =
  | "opinion"
  | "callback"
  | "aside"
  | "answer"
  | "shoutout_read"
  | "shoutout_with_request"
  | "queue_pick"
  | "accept_request"
  | "accept_request_deferred"
  | "decline_request"
  | "silence";

export type TriggerSource =
  | "auto_track_boundary"
  | "youtube_chat_mention"
  | "youtube_chat_shoutout"
  | "youtube_chat_request"
  | "youtube_chat_shoutout_with_request"
  | "operator_force";

export type ShiftEvent =
  | {
      type: "track_aired";
      id: string; // PlayHistory row id
      trackId: string;
      title: string;
      artist: string | null;
      genre: string | null;
      bpm: number | null;
      key: string | null;
      airedAt: number;
    }
  | {
      type: "lena_line_aired";
      id: string; // Chatter row id
      mode: ProducerMode | "legacy"; // "legacy" for pre-Producer rows
      targetFocus: string | null;
      text: string;
      airedAt: number;
      trigger: TriggerSource | "legacy";
      addressedListener: string | null;
    }
  | {
      type: "shoutout_aired";
      id: string; // Shoutout row id
      handle: string;
      originalText: string;
      airedAt: number;
    }
  | {
      type: "youtube_mention";
      id: string; // YouTube message id
      handle: string;
      text: string;
      intent: "shoutout" | "reply" | "request" | "shoutout_with_request" | "noise";
      airedAt: number;
    }
  | {
      type: "operator_force";
      hint: string;
      forcedAt: number;
    };

export type ShiftEventType = ShiftEvent["type"];

/** Compile-time exhaustiveness helper — call from a default case in switches over ShiftEvent.type. */
export function assertNever(x: never): never {
  throw new Error(`Unexpected ShiftEvent type: ${JSON.stringify(x)}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add workers/queue-daemon/lena-producer/shift-event.ts
git commit -m "$(cat <<'EOF'
lena-producer: ShiftEvent type definitions

Phase 1 foundation. Discriminated union covering every observable
event that ShiftMemory ingests. ProducerMode + TriggerSource live
here so Phase 2's Producer can import them without a circular dep.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `derived-show.ts` — shift boundary helper

`shiftStart()` already exists at `workers/queue-daemon/context-line.ts:437` keyed to the 4 show blocks (Night Shift 00-05, Morning Room 05-10, Daylight Channel 10-17, Prime Hours 17-24). We're not changing that logic — we're wrapping it with a per-call view that also exposes `minutesIn` and `minutesUntilNext` for the Producer's context (Phase 2). Also implements the 30-min overlap window the spec calls for.

**Files:**
- Create: `workers/queue-daemon/lena-producer/derived-show.ts`
- Create: `workers/queue-daemon/lena-producer/derived-show.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// workers/queue-daemon/lena-producer/derived-show.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveShowContext, SHIFT_BOUNDARIES_HOURS } from "./derived-show.ts";

test("deriveShowContext at 02:15 sits inside Night Shift", () => {
  // 2026-05-16 02:15 local
  const now = new Date(2026, 4, 16, 2, 15, 0).getTime();
  const ctx = deriveShowContext(now);
  assert.equal(ctx.name, "Night Shift");
  assert.equal(ctx.minutesIn, 2 * 60 + 15);
  assert.equal(ctx.minutesUntilNext, 5 * 60 - 135);
  assert.equal(ctx.overlapWindowStart, new Date(2026, 4, 16, 0, -30).getTime());
});

test("deriveShowContext just after 17:00 is Prime Hours with overlap covering 16:30", () => {
  const now = new Date(2026, 4, 16, 17, 10, 0).getTime();
  const ctx = deriveShowContext(now);
  assert.equal(ctx.name, "Prime Hours");
  assert.equal(ctx.minutesIn, 10);
  const sixteenThirty = new Date(2026, 4, 16, 16, 30, 0).getTime();
  assert.equal(ctx.overlapWindowStart, sixteenThirty);
});

test("SHIFT_BOUNDARIES_HOURS matches existing context-line.ts boundaries (00/05/10/17)", () => {
  assert.deepEqual(SHIFT_BOUNDARIES_HOURS, [0, 5, 10, 17]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="deriveShowContext|SHIFT_BOUNDARIES"`
Expected: FAIL with "Cannot find module './derived-show.ts'"

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/derived-show.ts

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="deriveShowContext|SHIFT_BOUNDARIES"`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/derived-show.ts workers/queue-daemon/lena-producer/derived-show.test.ts
git commit -m "$(cat <<'EOF'
lena-producer: derived-show — boundaries + 30min overlap window

Wraps existing show-block grid (00/05/10/17) with minutesIn /
minutesUntilNext for the Phase 2 Producer prompt context, plus the
30-min overlap window the spec defines for cross-boundary callbacks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `derived-counters.ts` — time-since counters

**Files:**
- Create: `workers/queue-daemon/lena-producer/derived-counters.ts`
- Create: `workers/queue-daemon/lena-producer/derived-counters.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// workers/queue-daemon/lena-producer/derived-counters.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShiftEvent } from "./shift-event.ts";
import { deriveCounters } from "./derived-counters.ts";

const T0 = 1_700_000_000_000; // arbitrary epoch ms anchor

test("empty log → all 'since' counters are Infinity, tracksSinceLastShoutout is 0", () => {
  const c = deriveCounters([], T0);
  assert.equal(c.msSinceLastLine, Infinity);
  assert.equal(c.msSinceLastWeatherMention, Infinity);
  assert.equal(c.tracksSinceLastShoutout, 0);
});

test("msSinceLastLine reads most recent lena_line_aired", () => {
  const log: ShiftEvent[] = [
    {
      type: "lena_line_aired",
      id: "c1",
      mode: "opinion",
      targetFocus: null,
      text: "hello",
      airedAt: T0 - 30_000,
      trigger: "auto_track_boundary",
      addressedListener: null,
    },
  ];
  const c = deriveCounters(log, T0);
  assert.equal(c.msSinceLastLine, 30_000);
});

test("tracksSinceLastShoutout counts track_aired events after the latest shoutout_aired", () => {
  const log: ShiftEvent[] = [
    {
      type: "shoutout_aired",
      id: "s1",
      handle: "anna",
      originalText: "hi",
      airedAt: T0 - 300_000,
    },
    { type: "track_aired", id: "t1", trackId: "tr1", title: "A", artist: null, genre: null, bpm: null, key: null, airedAt: T0 - 200_000 },
    { type: "track_aired", id: "t2", trackId: "tr2", title: "B", artist: null, genre: null, bpm: null, key: null, airedAt: T0 - 100_000 },
  ];
  const c = deriveCounters(log, T0);
  assert.equal(c.tracksSinceLastShoutout, 2);
});

test("msSinceLastWeatherMention scans lena_line_aired.text for weather-ish tokens", () => {
  const log: ShiftEvent[] = [
    {
      type: "lena_line_aired",
      id: "c1",
      mode: "aside",
      targetFocus: "weather",
      text: "rain in Tokyo tonight",
      airedAt: T0 - 60_000,
      trigger: "auto_track_boundary",
      addressedListener: null,
    },
  ];
  const c = deriveCounters(log, T0);
  assert.equal(c.msSinceLastWeatherMention, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="deriveCounters|msSince|tracksSince"`
Expected: FAIL with "Cannot find module './derived-counters.ts'"

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/derived-counters.ts

import type { ShiftEvent } from "./shift-event.ts";

export interface Counters {
  msSinceLastLine: number;
  msSinceLastWeatherMention: number;
  msSinceLastTimeCheck: number;
  msSinceLastStationDrop: number;
  tracksSinceLastShoutout: number;
}

const WEATHER_RE = /\b(rain|sun|sunny|snow|wind|storm|cloud|fog|warm|cold|chilly|breeze|drizzle|frost)\b/i;
const TIME_CHECK_RE = /\b(o'?clock|half past|quarter (to|past)|gone \d|just gone|tonight at|this hour)\b/i;
const STATION_DROP_RE = /\bnuma\s*radio\b/i;

export function deriveCounters(log: readonly ShiftEvent[], nowMs: number): Counters {
  let lastLine = -Infinity;
  let lastWeather = -Infinity;
  let lastTime = -Infinity;
  let lastStation = -Infinity;
  let lastShoutout = -Infinity;
  let tracksAfterShoutout = 0;

  for (const e of log) {
    if (e.type === "lena_line_aired") {
      if (e.airedAt > lastLine) lastLine = e.airedAt;
      if (WEATHER_RE.test(e.text) && e.airedAt > lastWeather) lastWeather = e.airedAt;
      if (TIME_CHECK_RE.test(e.text) && e.airedAt > lastTime) lastTime = e.airedAt;
      if (STATION_DROP_RE.test(e.text) && e.airedAt > lastStation) lastStation = e.airedAt;
    } else if (e.type === "shoutout_aired") {
      if (e.airedAt > lastShoutout) lastShoutout = e.airedAt;
    }
  }

  for (const e of log) {
    if (e.type === "track_aired" && e.airedAt > lastShoutout) {
      tracksAfterShoutout += 1;
    }
  }

  const since = (t: number) => (t === -Infinity ? Infinity : nowMs - t);

  return {
    msSinceLastLine: since(lastLine),
    msSinceLastWeatherMention: since(lastWeather),
    msSinceLastTimeCheck: since(lastTime),
    msSinceLastStationDrop: since(lastStation),
    tracksSinceLastShoutout: tracksAfterShoutout,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="deriveCounters|msSince|tracksSince"`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/derived-counters.ts workers/queue-daemon/lena-producer/derived-counters.test.ts
git commit -m "$(cat <<'EOF'
lena-producer: derived-counters — time-since trackers

Pure function: ShiftEvent log → { msSinceLastLine,
msSinceLastWeatherMention, msSinceLastTimeCheck, msSinceLastStationDrop,
tracksSinceLastShoutout }. Used by the Phase 2 Producer to decide
when to mention weather, the time, or the station name; and when
shoutouts have been quiet long enough to encourage one.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `derived-mood.ts` — current run, BPM trend, top genre

**Files:**
- Create: `workers/queue-daemon/lena-producer/derived-mood.ts`
- Create: `workers/queue-daemon/lena-producer/derived-mood.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// workers/queue-daemon/lena-producer/derived-mood.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShiftEvent } from "./shift-event.ts";
import { deriveMood } from "./derived-mood.ts";

const T0 = 1_700_000_000_000;

function track(id: string, airedAt: number, genre: string | null, bpm: number | null): ShiftEvent {
  return { type: "track_aired", id, trackId: id, title: id, artist: null, genre, bpm, key: null, airedAt };
}

test("empty log → null run, steady trend, no avg bpm", () => {
  const m = deriveMood([], T0);
  assert.equal(m.currentRun.genre, null);
  assert.equal(m.currentRun.count, 0);
  assert.equal(m.tempoTrend, "steady");
  assert.equal(m.avgBpmLast5, null);
  assert.equal(m.topGenreThisHour, null);
});

test("currentRun captures the tail of consecutive same-genre tracks", () => {
  const log: ShiftEvent[] = [
    track("a", T0 - 500_000, "rock", 110),
    track("b", T0 - 400_000, "synth", 120),
    track("c", T0 - 300_000, "synth", 118),
    track("d", T0 - 200_000, "synth", 115),
    track("e", T0 - 100_000, "synth", 112),
  ];
  const m = deriveMood(log, T0);
  assert.equal(m.currentRun.genre, "synth");
  assert.equal(m.currentRun.count, 4);
  assert.equal(m.currentRun.startedAt, T0 - 400_000);
});

test("tempoTrend = 'falling' when last 5 BPMs descend", () => {
  const log: ShiftEvent[] = [
    track("a", T0 - 500_000, "x", 130),
    track("b", T0 - 400_000, "x", 124),
    track("c", T0 - 300_000, "x", 120),
    track("d", T0 - 200_000, "x", 114),
    track("e", T0 - 100_000, "x", 108),
  ];
  const m = deriveMood(log, T0);
  assert.equal(m.tempoTrend, "falling");
  assert.equal(m.avgBpmLast5, 119);
});

test("topGenreThisHour counts only tracks in the last 60min", () => {
  const log: ShiftEvent[] = [
    track("old", T0 - 90 * 60_000, "ambient", 80),
    track("a", T0 - 30 * 60_000, "rock", 130),
    track("b", T0 - 20 * 60_000, "rock", 132),
    track("c", T0 - 10 * 60_000, "synth", 115),
  ];
  const m = deriveMood(log, T0);
  assert.equal(m.topGenreThisHour, "rock");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="deriveMood|currentRun|tempoTrend|topGenre"`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/derived-mood.ts

import type { ShiftEvent } from "./shift-event.ts";

export interface Mood {
  currentRun: { genre: string | null; count: number; startedAt: number };
  tempoTrend: "rising" | "steady" | "falling";
  avgBpmLast5: number | null;
  topGenreThisHour: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

export function deriveMood(log: readonly ShiftEvent[], nowMs: number): Mood {
  const tracks = log
    .filter((e): e is Extract<ShiftEvent, { type: "track_aired" }> => e.type === "track_aired")
    .sort((a, b) => a.airedAt - b.airedAt);

  if (tracks.length === 0) {
    return {
      currentRun: { genre: null, count: 0, startedAt: 0 },
      tempoTrend: "steady",
      avgBpmLast5: null,
      topGenreThisHour: null,
    };
  }

  // currentRun: walk backwards from latest until genre changes
  const latest = tracks[tracks.length - 1];
  let runCount = 1;
  let runStartedAt = latest.airedAt;
  for (let i = tracks.length - 2; i >= 0; i -= 1) {
    if (tracks[i].genre === latest.genre && latest.genre !== null) {
      runCount += 1;
      runStartedAt = tracks[i].airedAt;
    } else {
      break;
    }
  }

  // tempoTrend + avgBpmLast5
  const last5 = tracks.slice(-5);
  const bpms = last5.map((t) => t.bpm).filter((b): b is number => b !== null);
  const avgBpmLast5 = bpms.length > 0 ? Math.round(bpms.reduce((s, n) => s + n, 0) / bpms.length) : null;

  let tempoTrend: Mood["tempoTrend"] = "steady";
  if (bpms.length >= 3) {
    const first = bpms[0];
    const last = bpms[bpms.length - 1];
    const delta = last - first;
    if (delta >= 8) tempoTrend = "rising";
    else if (delta <= -8) tempoTrend = "falling";
  }

  // topGenreThisHour
  const cutoff = nowMs - HOUR_MS;
  const recentGenres = tracks
    .filter((t) => t.airedAt >= cutoff && t.genre !== null)
    .map((t) => t.genre!);
  const counts = new Map<string, number>();
  for (const g of recentGenres) counts.set(g, (counts.get(g) ?? 0) + 1);
  let topGenreThisHour: string | null = null;
  let topCount = 0;
  for (const [g, n] of counts) {
    if (n > topCount) {
      topGenreThisHour = g;
      topCount = n;
    }
  }

  return {
    currentRun: { genre: latest.genre, count: runCount, startedAt: runStartedAt },
    tempoTrend,
    avgBpmLast5,
    topGenreThisHour,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="deriveMood|currentRun|tempoTrend|topGenre"`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/derived-mood.ts workers/queue-daemon/lena-producer/derived-mood.test.ts
git commit -m "lena-producer: derived-mood (current run, tempo trend, top genre)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `derived-callbacks.ts` — callback pool curator

The Producer (Phase 2) reads a curated `callbackPool` — pre-summarized event descriptions, marked `used: true` after being referenced. This task implements the deriver that turns raw events into pool entries. The actual *summarizer* (LLM-side) is Task 7 — for now, the deriver writes a structural placeholder description that the summarizer fills in.

**Files:**
- Create: `workers/queue-daemon/lena-producer/derived-callbacks.ts`
- Create: `workers/queue-daemon/lena-producer/derived-callbacks.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// workers/queue-daemon/lena-producer/derived-callbacks.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShiftEvent } from "./shift-event.ts";
import { deriveCallbacks } from "./derived-callbacks.ts";

const T0 = 1_700_000_000_000;

test("empty log → empty pool", () => {
  assert.deepEqual(deriveCallbacks([], T0, new Set()), []);
});

test("shoutout becomes a callback candidate with minsAgo", () => {
  const log: ShiftEvent[] = [
    { type: "shoutout_aired", id: "s1", handle: "anna", originalText: "love this set", airedAt: T0 - 18 * 60_000 },
  ];
  const pool = deriveCallbacks(log, T0, new Set());
  assert.equal(pool.length, 1);
  assert.equal(pool[0].id, "s1");
  assert.equal(pool[0].sourceType, "shoutout");
  assert.equal(pool[0].minsAgo, 18);
  assert.equal(pool[0].used, false);
});

test("usedSet flips the used flag", () => {
  const log: ShiftEvent[] = [
    { type: "shoutout_aired", id: "s1", handle: "anna", originalText: "x", airedAt: T0 - 60_000 },
  ];
  const pool = deriveCallbacks(log, T0, new Set(["s1"]));
  assert.equal(pool[0].used, true);
});

test("pool is capped at 8 most recent eligible events", () => {
  const log: ShiftEvent[] = Array.from({ length: 20 }, (_, i) => ({
    type: "shoutout_aired",
    id: `s${i}`,
    handle: "x",
    originalText: "y",
    airedAt: T0 - (20 - i) * 60_000,
  }));
  const pool = deriveCallbacks(log, T0, new Set());
  assert.equal(pool.length, 8);
  // last 8 ids should be the most recent (s12..s19)
  assert.equal(pool[0].id, "s19");
  assert.equal(pool[7].id, "s12");
});

test("track_aired is NOT a callback candidate by default (callbacks are listener-driven)", () => {
  const log: ShiftEvent[] = [
    { type: "track_aired", id: "t1", trackId: "tr1", title: "X", artist: "Y", genre: null, bpm: null, key: null, airedAt: T0 - 60_000 },
  ];
  assert.equal(deriveCallbacks(log, T0, new Set()).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="deriveCallbacks|callback"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/derived-callbacks.ts

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="deriveCallbacks|callback"`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/derived-callbacks.ts workers/queue-daemon/lena-producer/derived-callbacks.test.ts
git commit -m "lena-producer: derived-callbacks (curated pool, cap 8, used-flag aware)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `callback-summarizer.ts` — async rewrite of `description`

The deriver from Task 6 emits a structural fallback description (`"Shoutout from anna: love this set"`). The summarizer rewrites these into more natural one-liners (`"Anna shouted out about loving the set 18 min ago"`) using a single small MiniMax call. Runs async on each event ingestion, not on each Producer call, so it does not add Producer-call latency.

Phase 2 will read these descriptions through the in-memory ShiftMemory; the summarizer writes its results to a separate `descriptions: Map<eventId, string>` inside `ShiftMemory` (added in Task 9).

**Files:**
- Create: `workers/queue-daemon/lena-producer/callback-summarizer.ts`
- Create: `workers/queue-daemon/lena-producer/callback-summarizer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// workers/queue-daemon/lena-producer/callback-summarizer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShiftEvent } from "./shift-event.ts";
import { summarizeEvent } from "./callback-summarizer.ts";

test("summarizeEvent: shoutout — sends event to LLM and returns trimmed line", async () => {
  const event: ShiftEvent = {
    type: "shoutout_aired",
    id: "s1",
    handle: "anna",
    originalText: "love this set, late-night vibes",
    airedAt: 1,
  };
  const fakeLlm = async (_prompt: string): Promise<string> => "Anna shouted out about late-night vibes.\n";
  const out = await summarizeEvent(event, { llm: fakeLlm });
  assert.equal(out, "Anna shouted out about late-night vibes.");
});

test("summarizeEvent: mention — uses fake LLM and returns line", async () => {
  const event: ShiftEvent = {
    type: "youtube_mention",
    id: "m1",
    handle: "bob",
    text: "tuning in from Berlin",
    intent: "reply",
    airedAt: 1,
  };
  const fakeLlm = async (_prompt: string): Promise<string> => "Bob said he's tuning in from Berlin.";
  const out = await summarizeEvent(event, { llm: fakeLlm });
  assert.equal(out, "Bob said he's tuning in from Berlin.");
});

test("summarizeEvent: unsummarizable event types return null", async () => {
  const event: ShiftEvent = {
    type: "track_aired",
    id: "t1",
    trackId: "x",
    title: "Y",
    artist: null,
    genre: null,
    bpm: null,
    key: null,
    airedAt: 1,
  };
  const fakeLlm = async (): Promise<string> => "should not be called";
  const out = await summarizeEvent(event, { llm: fakeLlm });
  assert.equal(out, null);
});

test("summarizeEvent: LLM failure → returns null (caller falls back to structural description)", async () => {
  const event: ShiftEvent = {
    type: "shoutout_aired",
    id: "s2",
    handle: "anna",
    originalText: "hi",
    airedAt: 1,
  };
  const fakeLlm = async (): Promise<string> => {
    throw new Error("rate limit");
  };
  const out = await summarizeEvent(event, { llm: fakeLlm });
  assert.equal(out, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="summarizeEvent"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/callback-summarizer.ts

import type { ShiftEvent } from "./shift-event.ts";

export interface SummarizerDeps {
  /** Single-call LLM — takes a prompt, returns a one-line description. */
  llm: (prompt: string) => Promise<string>;
}

const PROMPT_HEADER = `Write ONE short past-tense sentence (8-14 words) describing this listener event so a radio DJ can reference it later. No quotes. No emoji. Plain English.`;

export async function summarizeEvent(
  event: ShiftEvent,
  deps: SummarizerDeps,
): Promise<string | null> {
  let prompt: string;
  switch (event.type) {
    case "shoutout_aired":
      prompt = `${PROMPT_HEADER}\n\nEvent: shoutout from ${event.handle}\nMessage: ${event.originalText}`;
      break;
    case "youtube_mention":
      prompt = `${PROMPT_HEADER}\n\nEvent: chat message from ${event.handle}\nMessage: ${event.text}`;
      break;
    case "lena_line_aired":
      if (event.mode !== "aside") return null;
      prompt = `${PROMPT_HEADER}\n\nEvent: earlier on-air aside\nText: ${event.text}`;
      break;
    default:
      return null;
  }

  try {
    const raw = await deps.llm(prompt);
    return raw.trim() || null;
  } catch {
    // Caller (ShiftMemory) keeps the structural fallback description.
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="summarizeEvent"`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/callback-summarizer.ts workers/queue-daemon/lena-producer/callback-summarizer.test.ts
git commit -m "lena-producer: callback-summarizer (event → human-readable line)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `feature-flag.ts` — `LENA_SHIFT_MEMORY` gate

**Files:**
- Create: `workers/queue-daemon/lena-producer/feature-flag.ts`
- Create: `workers/queue-daemon/lena-producer/feature-flag.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// workers/queue-daemon/lena-producer/feature-flag.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isShiftMemoryEnabled } from "./feature-flag.ts";

test("isShiftMemoryEnabled returns true when env='on'", () => {
  assert.equal(isShiftMemoryEnabled({ LENA_SHIFT_MEMORY: "on" }), true);
});

test("isShiftMemoryEnabled returns true when env='true'", () => {
  assert.equal(isShiftMemoryEnabled({ LENA_SHIFT_MEMORY: "true" }), true);
});

test("isShiftMemoryEnabled returns false when env is unset", () => {
  assert.equal(isShiftMemoryEnabled({}), false);
});

test("isShiftMemoryEnabled returns false when env='off'", () => {
  assert.equal(isShiftMemoryEnabled({ LENA_SHIFT_MEMORY: "off" }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="isShiftMemoryEnabled"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/feature-flag.ts

export function isShiftMemoryEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const v = (env.LENA_SHIFT_MEMORY ?? "").toLowerCase();
  return v === "on" || v === "true" || v === "1";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="isShiftMemoryEnabled"`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/feature-flag.ts workers/queue-daemon/lena-producer/feature-flag.test.ts
git commit -m "lena-producer: LENA_SHIFT_MEMORY feature flag

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `shift-memory.ts` — singleton, raw log + record, derived view

Brings Tasks 3-6 together. The singleton exposes:

- `record(event)` — adds to the log (capped at 50, oldest evicted), kicks off async summarizer if applicable, evicts events older than the show-overlap window
- `view(nowMs)` — returns a frozen snapshot `{ events, counters, mood, callbackPool, recentLines, recentModes, show }` for the Producer

**Files:**
- Create: `workers/queue-daemon/lena-producer/shift-memory.ts`
- Create: `workers/queue-daemon/lena-producer/shift-memory.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// workers/queue-daemon/lena-producer/shift-memory.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ShiftMemory } from "./shift-memory.ts";
import type { ShiftEvent } from "./shift-event.ts";

function track(id: string, airedAt: number, genre: string | null = null, bpm: number | null = null): ShiftEvent {
  return { type: "track_aired", id, trackId: id, title: id, artist: null, genre, bpm, key: null, airedAt };
}

test("ShiftMemory.record appends to event log and view reflects it", () => {
  const mem = new ShiftMemory();
  const now = Date.now();
  mem.record(track("t1", now - 60_000, "rock", 120));
  const v = mem.view(now);
  assert.equal(v.events.length, 1);
  assert.equal(v.events[0].id, "t1");
});

test("ShiftMemory caps log at 50 events (oldest evicted)", () => {
  const mem = new ShiftMemory();
  const t0 = Date.now() - 60 * 60_000; // 1h ago
  for (let i = 0; i < 60; i += 1) {
    mem.record(track(`t${i}`, t0 + i * 60_000));
  }
  const v = mem.view(Date.now());
  assert.equal(v.events.length, 50);
  assert.equal(v.events[0].id, "t10"); // first 10 evicted
});

test("ShiftMemory view exposes counters, mood, show, recentLines", () => {
  const mem = new ShiftMemory();
  const now = Date.now();
  mem.record(track("t1", now - 60_000, "synth", 110));
  const v = mem.view(now);
  assert.equal(v.counters.tracksSinceLastShoutout, 1);
  assert.equal(v.mood.currentRun.genre, "synth");
  assert.ok(typeof v.show.name === "string");
  assert.equal(v.recentLines.length, 0);
});

test("ShiftMemory.recentLines returns last 10 lena_line_aired events newest-first", () => {
  const mem = new ShiftMemory();
  const now = Date.now();
  for (let i = 0; i < 12; i += 1) {
    mem.record({
      type: "lena_line_aired",
      id: `c${i}`,
      mode: "opinion",
      targetFocus: null,
      text: `line ${i}`,
      airedAt: now - (12 - i) * 60_000,
      trigger: "auto_track_boundary",
      addressedListener: null,
    });
  }
  const v = mem.view(now);
  assert.equal(v.recentLines.length, 10);
  assert.equal(v.recentLines[0].text, "line 11");
  assert.equal(v.recentLines[9].text, "line 2");
});

test("ShiftMemory.markCallbackUsed flips the used flag in callbackPool", () => {
  const mem = new ShiftMemory();
  const now = Date.now();
  mem.record({
    type: "shoutout_aired",
    id: "s1",
    handle: "anna",
    originalText: "hi",
    airedAt: now - 60_000,
  });
  assert.equal(mem.view(now).callbackPool[0].used, false);
  mem.markCallbackUsed("s1");
  assert.equal(mem.view(now).callbackPool[0].used, true);
});

test("ShiftMemory.evictOlderThan removes events older than the cutoff", () => {
  const mem = new ShiftMemory();
  const now = Date.now();
  mem.record(track("old", now - 10 * 60 * 60_000));
  mem.record(track("new", now - 5 * 60_000));
  mem.evictOlderThan(now - 60 * 60_000); // evict events older than 1h
  const v = mem.view(now);
  assert.equal(v.events.length, 1);
  assert.equal(v.events[0].id, "new");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="ShiftMemory"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/shift-memory.ts

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="ShiftMemory"`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/shift-memory.ts workers/queue-daemon/lena-producer/shift-memory.test.ts
git commit -m "$(cat <<'EOF'
lena-producer: ShiftMemory singleton with rolling log + frozen view

Combines derived-counters / derived-mood / derived-callbacks /
derived-show into a single class. Log capped at 50, recentLines /
recentModes capped at 10. Callback descriptions can be overridden
by the async summarizer (Task 7). markCallbackUsed and
evictOlderThan are wired for Phase 2's shift-boundary handler.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `reconstruction.ts` — boot-time DB → ShiftMemory

On daemon restart, the in-memory log is empty. This task reconstructs the last ~4 hours of events from existing Prisma tables so callbacks and counters survive a restart.

**Files:**
- Create: `workers/queue-daemon/lena-producer/reconstruction.ts`
- Create: `workers/queue-daemon/lena-producer/reconstruction.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// workers/queue-daemon/lena-producer/reconstruction.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructEvents } from "./reconstruction.ts";

const T0 = 1_700_000_000_000;

test("reconstructEvents merges PlayHistory + Chatter + Shoutout into one sorted log", async () => {
  const fakePrisma = {
    playHistory: {
      findMany: async () => [
        {
          id: "p1",
          trackId: "tr1",
          titleSnapshot: "Song A",
          startedAt: new Date(T0 - 600_000),
          track: { artistDisplay: "Anna", genre: "rock", bpm: 120, key: "C" },
        },
      ],
    },
    chatter: {
      findMany: async () => [
        {
          id: "c1",
          chatterType: "back_announce",
          script: "next up",
          airedAt: new Date(T0 - 400_000),
          producerVersion: null,
        },
      ],
    },
    shoutout: {
      findMany: async () => [
        {
          id: "s1",
          cleanText: "hi lena",
          handle: "anna",
          createdAt: new Date(T0 - 200_000),
        },
      ],
    },
  };

  const events = await reconstructEvents({
    prisma: fakePrisma as never,
    stationId: "station1",
    sinceMs: T0 - 4 * 60 * 60_000,
    nowMs: T0,
  });

  assert.equal(events.length, 3);
  assert.equal(events[0].type, "track_aired");
  assert.equal(events[1].type, "lena_line_aired");
  assert.equal((events[1] as { mode: string }).mode, "legacy");
  assert.equal(events[2].type, "shoutout_aired");
});

test("reconstructEvents tags producerVersion!=null Chatter rows with their mode, legacy otherwise", async () => {
  const fakePrisma = {
    playHistory: { findMany: async () => [] },
    chatter: {
      findMany: async () => [
        { id: "c1", chatterType: "opinion", script: "x", airedAt: new Date(T0 - 60_000), producerVersion: 1 },
        { id: "c2", chatterType: "filler", script: "y", airedAt: new Date(T0 - 30_000), producerVersion: null },
      ],
    },
    shoutout: { findMany: async () => [] },
  };

  const events = await reconstructEvents({
    prisma: fakePrisma as never,
    stationId: "station1",
    sinceMs: T0 - 60 * 60_000,
    nowMs: T0,
  });

  const c1 = events.find((e) => e.id === "c1") as { type: "lena_line_aired"; mode: string };
  const c2 = events.find((e) => e.id === "c2") as { type: "lena_line_aired"; mode: string };
  assert.equal(c1.mode, "opinion");
  assert.equal(c2.mode, "legacy");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="reconstructEvents"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/reconstruction.ts

import type { PrismaClient } from "@prisma/client";
import type { ProducerMode, ShiftEvent } from "./shift-event.ts";

type PrismaSlice = Pick<PrismaClient, "playHistory" | "chatter" | "shoutout">;

const PRODUCER_MODES: ReadonlySet<string> = new Set<ProducerMode>([
  "opinion",
  "callback",
  "aside",
  "answer",
  "shoutout_read",
  "shoutout_with_request",
  "queue_pick",
  "accept_request",
  "accept_request_deferred",
  "decline_request",
  "silence",
]);

export async function reconstructEvents(deps: {
  prisma: PrismaSlice;
  stationId: string;
  sinceMs: number;
  nowMs: number;
}): Promise<ShiftEvent[]> {
  const since = new Date(deps.sinceMs);

  const [plays, chatters, shoutouts] = await Promise.all([
    deps.prisma.playHistory.findMany({
      where: { stationId: deps.stationId, startedAt: { gte: since }, segmentType: "audio_track" },
      orderBy: { startedAt: "asc" },
      select: {
        id: true,
        trackId: true,
        titleSnapshot: true,
        startedAt: true,
        track: { select: { artistDisplay: true, genre: true, bpm: true, key: true } },
      },
    }),
    deps.prisma.chatter.findMany({
      where: { stationId: deps.stationId, airedAt: { gte: since } },
      orderBy: { airedAt: "asc" },
      select: { id: true, chatterType: true, script: true, airedAt: true, producerVersion: true },
    }),
    // Shoutout doesn't have an explicit "airedAt" — we treat the row createdAt as
    // the closest available proxy. Phase 2 may switch to JOIN through Track→PlayHistory.
    deps.prisma.shoutout.findMany({
      where: { stationId: deps.stationId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { id: true, cleanText: true, handle: true, createdAt: true },
    }),
  ]);

  const events: ShiftEvent[] = [];

  for (const p of plays) {
    events.push({
      type: "track_aired",
      id: p.id,
      trackId: p.trackId ?? p.id,
      title: p.titleSnapshot ?? "(unknown)",
      artist: p.track?.artistDisplay ?? null,
      genre: p.track?.genre ?? null,
      bpm: p.track?.bpm ?? null,
      key: p.track?.key ?? null,
      airedAt: p.startedAt.getTime(),
    });
  }

  for (const c of chatters) {
    const isProducerMode = c.producerVersion != null && PRODUCER_MODES.has(c.chatterType);
    events.push({
      type: "lena_line_aired",
      id: c.id,
      mode: isProducerMode ? (c.chatterType as ProducerMode) : "legacy",
      targetFocus: null,
      text: c.script,
      airedAt: c.airedAt.getTime(),
      trigger: isProducerMode ? "auto_track_boundary" : "legacy",
      addressedListener: null,
    });
  }

  for (const s of shoutouts) {
    events.push({
      type: "shoutout_aired",
      id: s.id,
      handle: s.handle ?? "anonymous",
      originalText: s.cleanText ?? "",
      airedAt: s.createdAt.getTime(),
    });
  }

  events.sort((a, b) => airedAt(a) - airedAt(b));
  return events;
}

function airedAt(e: ShiftEvent): number {
  return e.type === "operator_force" ? e.forcedAt : e.airedAt;
}
```

- [ ] **Step 4: Confirm schema field names**

The test fixture uses `Shoutout.cleanText` and `Shoutout.handle`. Verify these exist on your Shoutout model:

```bash
grep -n "model Shoutout" prisma/schema.prisma
```

If the field is named differently (e.g., `submitterHandle`), update the `select` block in `reconstruction.ts` and the test fixture to match. Same for `Track.artistDisplay`, `Track.genre`, `Track.bpm`, `Track.key`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="reconstructEvents"`
Expected: PASS, 2/2.

- [ ] **Step 6: Commit**

```bash
git add workers/queue-daemon/lena-producer/reconstruction.ts workers/queue-daemon/lena-producer/reconstruction.test.ts
git commit -m "$(cat <<'EOF'
lena-producer: reconstruction (DB → events on daemon boot)

Walks PlayHistory + Chatter + Shoutout for the last sinceMs window
and emits a sorted ShiftEvent[]. Chatter rows with
producerVersion != null AND chatterType in PRODUCER_MODES are tagged
with their actual mode; everything else is tagged "legacy". YouTube
mentions are not reconstructed (no table records every mention) —
acceptable degradation in the first 5-10min after restart.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `notify-listener.ts` — pg LISTEN + reconnect + poll fallback

Subscribes to the Postgres `lena_event` channel on a dedicated `pg.Client` connection. On each NOTIFY, parses the payload as a `ShiftEvent` and hands it to a callback. Auto-reconnects on connection loss with exponential backoff. Runs a 5-second DB poll fallback that reads `Chatter` / `PlayHistory` / `Shoutout` rows newer than a last-seen-id high-water mark whenever the LISTEN connection isn't healthy.

**Files:**
- Create: `workers/queue-daemon/lena-producer/notify-listener.ts`
- Create: `workers/queue-daemon/lena-producer/notify-listener.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// workers/queue-daemon/lena-producer/notify-listener.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNotifyPayload } from "./notify-listener.ts";

test("parseNotifyPayload returns the event when JSON is valid and shape matches", () => {
  const payload = JSON.stringify({
    type: "shoutout_aired",
    id: "s1",
    handle: "anna",
    originalText: "hi",
    airedAt: 1700000000000,
  });
  const ev = parseNotifyPayload(payload);
  assert.ok(ev);
  assert.equal(ev!.type, "shoutout_aired");
});

test("parseNotifyPayload returns null on invalid JSON", () => {
  assert.equal(parseNotifyPayload("not json"), null);
});

test("parseNotifyPayload returns null on missing required fields", () => {
  const payload = JSON.stringify({ type: "shoutout_aired" }); // missing fields
  assert.equal(parseNotifyPayload(payload), null);
});

test("parseNotifyPayload returns null on unknown event type", () => {
  const payload = JSON.stringify({ type: "made_up_event", id: "x", airedAt: 1 });
  assert.equal(parseNotifyPayload(payload), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="parseNotifyPayload"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// workers/queue-daemon/lena-producer/notify-listener.ts

import { Client as PgClient } from "pg";
import type { ShiftEvent, ShiftEventType } from "./shift-event.ts";

const NOTIFY_CHANNEL = "lena_event";
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000] as const;
const POLL_INTERVAL_MS = 5_000;

const VALID_TYPES: ReadonlySet<ShiftEventType> = new Set<ShiftEventType>([
  "track_aired",
  "lena_line_aired",
  "shoutout_aired",
  "youtube_mention",
  "operator_force",
]);

export function parseNotifyPayload(raw: string): ShiftEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== "string" || !VALID_TYPES.has(type as ShiftEventType)) return null;
  if (typeof obj.id !== "string") return null;
  // Per-type minimal sanity check — full validation is the consumer's job
  switch (type) {
    case "track_aired":
      if (typeof obj.airedAt !== "number" || typeof obj.trackId !== "string") return null;
      break;
    case "lena_line_aired":
      if (typeof obj.airedAt !== "number" || typeof obj.text !== "string") return null;
      break;
    case "shoutout_aired":
      if (typeof obj.airedAt !== "number" || typeof obj.handle !== "string") return null;
      break;
    case "youtube_mention":
      if (typeof obj.airedAt !== "number" || typeof obj.text !== "string") return null;
      break;
    case "operator_force":
      if (typeof obj.forcedAt !== "number" || typeof obj.hint !== "string") return null;
      break;
  }
  return parsed as ShiftEvent;
}

export interface NotifyListenerOpts {
  connectionString: string;
  onEvent: (event: ShiftEvent) => void;
  /** Called when the listener moves between healthy/unhealthy states (for logs/metrics). */
  onHealthChange?: (state: "healthy" | "reconnecting" | "polling") => void;
  /** Called to fetch any rows newer than the last seen high-water marks. Implementation in Task 12. */
  pollForMissedEvents?: () => Promise<ShiftEvent[]>;
}

export class NotifyListener {
  #opts: NotifyListenerOpts;
  #client: PgClient | null = null;
  #stopped = false;
  #reconnectAttempt = 0;
  #pollTimer: NodeJS.Timeout | null = null;

  constructor(opts: NotifyListenerOpts) {
    this.#opts = opts;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    await this.#connect();
    this.#startPolling();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    await this.#client?.end().catch(() => {});
    this.#client = null;
  }

  async #connect(): Promise<void> {
    if (this.#stopped) return;
    const client = new PgClient({ connectionString: this.#opts.connectionString });

    client.on("notification", (msg) => {
      if (msg.channel !== NOTIFY_CHANNEL || !msg.payload) return;
      const ev = parseNotifyPayload(msg.payload);
      if (ev) this.#opts.onEvent(ev);
    });

    client.on("error", () => {
      this.#opts.onHealthChange?.("reconnecting");
      this.#scheduleReconnect();
    });

    client.on("end", () => {
      if (!this.#stopped) {
        this.#opts.onHealthChange?.("reconnecting");
        this.#scheduleReconnect();
      }
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
      this.#client = client;
      this.#reconnectAttempt = 0;
      this.#opts.onHealthChange?.("healthy");
    } catch {
      await client.end().catch(() => {});
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    const backoff = RECONNECT_BACKOFF_MS[Math.min(this.#reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.#reconnectAttempt += 1;
    setTimeout(() => this.#connect(), backoff);
  }

  #startPolling(): void {
    if (!this.#opts.pollForMissedEvents) return;
    this.#pollTimer = setInterval(async () => {
      try {
        const missed = await this.#opts.pollForMissedEvents!();
        for (const ev of missed) this.#opts.onEvent(ev);
      } catch {
        // swallow — next tick retries
      }
    }, POLL_INTERVAL_MS);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="parseNotifyPayload"`
Expected: PASS, 4/4. (Integration test of the full reconnect/poll loop is Task 13.)

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/notify-listener.ts workers/queue-daemon/lena-producer/notify-listener.test.ts
git commit -m "$(cat <<'EOF'
lena-producer: notify-listener (pg LISTEN + reconnect + poll fallback)

Subscribes to Postgres NOTIFY 'lena_event' channel on a dedicated
pg.Client. Auto-reconnects with capped exponential backoff. 5s poll
fallback runs alongside and feeds any rows the consumer reports as
"missed" through the same onEvent callback. parseNotifyPayload is
exported and unit-tested independently.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `pollForMissedEvents` — high-water-mark DB poll

The fallback poll for the listener. Tracks the last-seen `id` for each event source (PlayHistory, Chatter, Shoutout) and returns only rows newer than the high-water marks. Used when LISTEN is unhealthy or to catch events dropped between disconnect and reconnect.

**Files:**
- Modify: `workers/queue-daemon/lena-producer/reconstruction.ts` (add `pollSince`)
- Modify: `workers/queue-daemon/lena-producer/reconstruction.test.ts`

- [ ] **Step 1: Add the failing test**

Add to `reconstruction.test.ts`:

```typescript
test("pollSince returns only rows with createdAt/airedAt > the watermark", async () => {
  const fakePrisma = {
    playHistory: {
      findMany: async (args: { where: { startedAt: { gt: Date } } }) => {
        const since = args.where.startedAt.gt.getTime();
        return [
          { id: "p_old", trackId: "x", titleSnapshot: "old", startedAt: new Date(since - 1), track: null },
          { id: "p_new", trackId: "y", titleSnapshot: "new", startedAt: new Date(since + 1), track: null },
        ].filter((p) => p.startedAt.getTime() > since);
      },
    },
    chatter: { findMany: async () => [] },
    shoutout: { findMany: async () => [] },
  };

  const events = await pollSince({
    prisma: fakePrisma as never,
    stationId: "s1",
    sincePlayHistoryAt: T0 - 10_000,
    sinceChatterAt: T0,
    sinceShoutoutAt: T0,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "p_new");
});
```

Add the import:

```typescript
import { reconstructEvents, pollSince } from "./reconstruction.ts";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="pollSince"`
Expected: FAIL.

- [ ] **Step 3: Add the function to `reconstruction.ts`**

Append:

```typescript
export async function pollSince(deps: {
  prisma: PrismaSlice;
  stationId: string;
  sincePlayHistoryAt: number;
  sinceChatterAt: number;
  sinceShoutoutAt: number;
}): Promise<ShiftEvent[]> {
  const [plays, chatters, shoutouts] = await Promise.all([
    deps.prisma.playHistory.findMany({
      where: {
        stationId: deps.stationId,
        startedAt: { gt: new Date(deps.sincePlayHistoryAt) },
        segmentType: "audio_track",
      },
      orderBy: { startedAt: "asc" },
      select: {
        id: true,
        trackId: true,
        titleSnapshot: true,
        startedAt: true,
        track: { select: { artistDisplay: true, genre: true, bpm: true, key: true } },
      },
    }),
    deps.prisma.chatter.findMany({
      where: { stationId: deps.stationId, airedAt: { gt: new Date(deps.sinceChatterAt) } },
      orderBy: { airedAt: "asc" },
      select: { id: true, chatterType: true, script: true, airedAt: true, producerVersion: true },
    }),
    deps.prisma.shoutout.findMany({
      where: { stationId: deps.stationId, createdAt: { gt: new Date(deps.sinceShoutoutAt) } },
      orderBy: { createdAt: "asc" },
      select: { id: true, cleanText: true, handle: true, createdAt: true },
    }),
  ]);

  const events: ShiftEvent[] = [];
  for (const p of plays) {
    events.push({
      type: "track_aired",
      id: p.id,
      trackId: p.trackId ?? p.id,
      title: p.titleSnapshot ?? "(unknown)",
      artist: p.track?.artistDisplay ?? null,
      genre: p.track?.genre ?? null,
      bpm: p.track?.bpm ?? null,
      key: p.track?.key ?? null,
      airedAt: p.startedAt.getTime(),
    });
  }
  for (const c of chatters) {
    const isProducerMode = c.producerVersion != null && PRODUCER_MODES.has(c.chatterType);
    events.push({
      type: "lena_line_aired",
      id: c.id,
      mode: isProducerMode ? (c.chatterType as ProducerMode) : "legacy",
      targetFocus: null,
      text: c.script,
      airedAt: c.airedAt.getTime(),
      trigger: isProducerMode ? "auto_track_boundary" : "legacy",
      addressedListener: null,
    });
  }
  for (const s of shoutouts) {
    events.push({
      type: "shoutout_aired",
      id: s.id,
      handle: s.handle ?? "anonymous",
      originalText: s.cleanText ?? "",
      airedAt: s.createdAt.getTime(),
    });
  }
  events.sort((a, b) => airedAt(a) - airedAt(b));
  return events;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="pollSince"`
Expected: PASS, 1/1.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/reconstruction.ts workers/queue-daemon/lena-producer/reconstruction.test.ts
git commit -m "lena-producer: pollSince (high-watermark fallback for NotifyListener)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Wire NotifyListener + ShiftMemory into the queue-daemon boot

This is the integration point. On daemon boot, if `LENA_SHIFT_MEMORY=on`:

1. Construct the ShiftMemory singleton.
2. Run `reconstructEvents` for the last 4 hours; replay each into ShiftMemory.
3. Capture the highest seen ids/timestamps as the poll watermarks.
4. Start NotifyListener wired to ShiftMemory.record + the polling fallback.

**Files:**
- Modify: `workers/queue-daemon/index.ts`

- [ ] **Step 1: Locate the daemon boot section**

Run: `grep -n "poller started" workers/queue-daemon/index.ts`
Expected: a line in the boot/main block. Note its line number; insert before the `[boot] poller started` log.

- [ ] **Step 2: Add the wiring**

Near the top of `workers/queue-daemon/index.ts`, add imports:

```typescript
import { ShiftMemory } from "./lena-producer/shift-memory.ts";
import { NotifyListener } from "./lena-producer/notify-listener.ts";
import { reconstructEvents, pollSince } from "./lena-producer/reconstruction.ts";
import { isShiftMemoryEnabled } from "./lena-producer/feature-flag.ts";
```

In the boot block (just before `[boot] poller started`), insert:

```typescript
let shiftMemory: ShiftMemory | null = null;
if (isShiftMemoryEnabled(process.env)) {
  shiftMemory = new ShiftMemory();
  const stationId = await resolveStationId(); // existing helper — adjust name if it differs
  const now = Date.now();
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
  const reconstructed = await reconstructEvents({
    prisma,
    stationId,
    sinceMs: now - FOUR_HOURS_MS,
    nowMs: now,
  });
  for (const ev of reconstructed) shiftMemory.record(ev);

  // High-water marks for the poll fallback
  let sincePlayHistoryAt = now - FOUR_HOURS_MS;
  let sinceChatterAt = now - FOUR_HOURS_MS;
  let sinceShoutoutAt = now - FOUR_HOURS_MS;
  for (const ev of reconstructed) {
    if (ev.type === "track_aired") sincePlayHistoryAt = Math.max(sincePlayHistoryAt, ev.airedAt);
    if (ev.type === "lena_line_aired") sinceChatterAt = Math.max(sinceChatterAt, ev.airedAt);
    if (ev.type === "shoutout_aired") sinceShoutoutAt = Math.max(sinceShoutoutAt, ev.airedAt);
  }

  const listener = new NotifyListener({
    connectionString: process.env.DATABASE_URL!,
    onEvent: (ev) => {
      shiftMemory!.record(ev);
      // Update high-water marks so the poll doesn't re-deliver
      const ts = "airedAt" in ev ? ev.airedAt : ev.forcedAt;
      if (ev.type === "track_aired") sincePlayHistoryAt = Math.max(sincePlayHistoryAt, ts);
      if (ev.type === "lena_line_aired") sinceChatterAt = Math.max(sinceChatterAt, ts);
      if (ev.type === "shoutout_aired") sinceShoutoutAt = Math.max(sinceShoutoutAt, ts);
    },
    onHealthChange: (state) => {
      console.log(`[lena-shift-memory] notify ${state}`);
    },
    pollForMissedEvents: async () => {
      return pollSince({
        prisma,
        stationId,
        sincePlayHistoryAt,
        sinceChatterAt,
        sinceShoutoutAt,
      });
    },
  });
  await listener.start();
  console.log(`[lena-shift-memory] booted with ${reconstructed.length} reconstructed events`);
} else {
  console.log("[lena-shift-memory] disabled (LENA_SHIFT_MEMORY not set)");
}
```

- [ ] **Step 3: Resolve any `resolveStationId` mismatch**

The daemon likely already resolves the station id elsewhere (e.g. via `STATION_SLUG` env or a `prisma.station.findFirst`). Search for the existing pattern:

```bash
grep -n "stationId" workers/queue-daemon/index.ts | head -5
```

Use the same pattern — do not introduce a new lookup if the daemon already caches one.

- [ ] **Step 4: Smoke test**

Run: `LENA_SHIFT_MEMORY=on npx tsx workers/queue-daemon/index.ts` (locally, against a dev DB)
Expected: `[lena-shift-memory] booted with N reconstructed events` followed by `[lena-shift-memory] notify healthy`. Kill with Ctrl-C.

Without the flag:
Run: `npx tsx workers/queue-daemon/index.ts`
Expected: `[lena-shift-memory] disabled (LENA_SHIFT_MEMORY not set)`.

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/index.ts
git commit -m "$(cat <<'EOF'
queue-daemon: wire ShiftMemory + NotifyListener on boot (LENA_SHIFT_MEMORY)

Gated behind LENA_SHIFT_MEMORY env flag (default off). When on:
- Construct ShiftMemory singleton
- Reconstruct last 4h of events from PlayHistory / Chatter / Shoutout
- Subscribe to Postgres NOTIFY 'lena_event' channel
- Run 5s poll fallback with high-water-mark dedup

No Lena behavior changes — observability foundation only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Emit `track_aired` from `track-started` route

**Files:**
- Modify: `app/api/internal/track-started/route.ts`

- [ ] **Step 1: Add the emitter helper**

At the bottom of the existing transaction in `track-started/route.ts` (after `await prisma.$transaction(ops as never)`), insert a `pg_notify` call. The `$executeRawUnsafe` runs the raw NOTIFY:

```typescript
// After: await prisma.$transaction(ops as never);

// Phase 1 (Lena Producer): notify the queue-daemon's ShiftMemory.
// Wrapped in try/catch — emission failure must NOT break the existing flow.
try {
  const payload = JSON.stringify({
    type: "track_aired",
    id: track.id, // PlayHistory id isn't available here without a re-select; use track.id as the event id
    trackId: track.id,
    title: track.title,
    artist: (track as { artistDisplay?: string | null }).artistDisplay ?? null,
    genre: (track as { genre?: string | null }).genre ?? null,
    bpm: (track as { bpm?: number | null }).bpm ?? null,
    key: (track as { key?: string | null }).key ?? null,
    airedAt: startedAt.getTime(),
  });
  // Use literal — pg_notify takes a TEXT literal channel, not a parameter binding.
  await prisma.$executeRawUnsafe(`SELECT pg_notify('lena_event', $1)`, payload);
} catch (err) {
  console.warn("[lena-shift-memory] track_aired NOTIFY failed:", err);
}
```

> **Note:** The `id` field used here is the Track.id, not the PlayHistory.id. The PlayHistory row was just created in the `playHistoryOp` but we don't have its assigned id without a re-select. For Phase 1 this is acceptable — ShiftMemory uses the id for callback dedup, and tracks aren't callback candidates. If the daemon ever needs the PlayHistory id, re-select inside the transaction.

- [ ] **Step 2: Smoke test the emitter**

In one terminal: `LENA_SHIFT_MEMORY=on npx tsx workers/queue-daemon/index.ts`

In another, simulate a track-started call (use an existing track id from your local DB):

```bash
curl -X POST http://localhost:3000/api/internal/track-started \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -d '{"trackId":"<some-real-id>"}'
```

In the daemon terminal expect: nothing visible by default — but you can add a temporary `console.log` inside `onEvent` to verify the event arrives. Remove the debug log before committing.

- [ ] **Step 3: Commit**

```bash
git add app/api/internal/track-started/route.ts
git commit -m "$(cat <<'EOF'
track-started: emit track_aired NOTIFY for Lena ShiftMemory

Wrapped in try/catch — emission failure cannot break the existing
track-started transaction. The queue-daemon's NotifyListener picks
up the payload and feeds it into ShiftMemory.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Emit `shoutout_aired` from `dashboard/lib/shoutout.ts`

`generateShoutout()` ends at `dashboard/lib/shoutout.ts:307-312` with `return { trackId, sourceUrl, queueItemId, spokenText }`. Variables in scope at that point: `trackId` (new Track id), `input.text` (raw listener text), `input.source` (`{ kind: 'agent'|'booth', sender?, requesterName? }`), `radioText` (post-rewrite text Lena will say). Insert the emit immediately before the `return { ... }`.

**Files:**
- Modify: `dashboard/lib/shoutout.ts:305-307`

- [ ] **Step 1: Insert the emit**

```typescript
// Just before the existing `return { trackId, sourceUrl, ... }` at line ~307:

// Phase 1 (Lena Producer): notify the daemon's ShiftMemory.
// Emitting at queue-time (not air-time) for Phase 1 — Phase 2 may
// switch to track-started for true air-time fidelity. The few-minute
// delta is acceptable for callback-pool purposes.
try {
  const handle =
    input.source.kind === "agent"
      ? input.source.sender ?? "anonymous"
      : input.source.requesterName ?? "anonymous";
  const payload = JSON.stringify({
    type: "shoutout_aired",
    id: trackId, // Track id is unique and lets Phase 2 JOIN through to Shoutout row if needed
    handle,
    originalText: input.text,
    airedAt: Date.now(),
  });
  await prisma.$executeRawUnsafe(`SELECT pg_notify('lena_event', $1)`, payload);
} catch (err) {
  console.warn("[lena-shift-memory] shoutout_aired NOTIFY failed:", err);
}
```

- [ ] **Step 2: Confirm `prisma` is imported**

`grep -n "^import.*prisma" dashboard/lib/shoutout.ts` — should find an existing import. If `prisma` is imported under a different name (e.g. `db`), use that name instead.

- [ ] **Step 3: Smoke test**

With the daemon running with `LENA_SHIFT_MEMORY=on`, submit a shoutout via the booth. Confirm the daemon log shows a NOTIFY arrival (add a temporary log in `notify-listener.ts onEvent` if needed; remove before commit).

- [ ] **Step 4: Commit**

```bash
git add dashboard/lib/shoutout.ts
git commit -m "shoutout: emit shoutout_aired NOTIFY for Lena ShiftMemory

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Emit `youtube_mention` from the dispatch endpoint (post-classification)

The intent classifier (`shoutout | reply | noise`, with `request` and `shoutout_with_request` added in Phase 2.5) runs server-side in `app/api/internal/youtube-chat-shoutout/route.ts:129` via `classifyShoutoutIntent()`. Emitting from here is the only place that has the **classified intent** — the daemon-side `youtube-chat-loop.ts` dispatches messages but doesn't know intent yet.

**Files:**
- Modify: `app/api/internal/youtube-chat-shoutout/route.ts`

- [ ] **Step 1: Insert the emit after classification + Shoutout row creation**

Open the route. The pattern from `route.ts:129-175`:

```typescript
const intent = await classifyShoutoutIntent(rawText);
if (intent.category === "noise") { return NextResponse.json({ ... }); }
// ...
const shoutout = await prisma.shoutout.create({ ... });   // line ~148
// ...
const isReply = intent.category === "reply";
// ...
return NextResponse.json({ ... });   // line ~175
```

Insert the emit just before the final `return NextResponse.json(...)` at line ~175:

```typescript
// Phase 1 (Lena Producer): notify the daemon's ShiftMemory.
try {
  const payload = JSON.stringify({
    type: "youtube_mention",
    id: shoutout.id,
    handle: body.displayName ?? "anonymous",
    text: rawText,
    intent: intent.category, // "shoutout" | "reply" — Phase 2.5 adds "request" + "shoutout_with_request"
    airedAt: Date.now(),
  });
  await prisma.$executeRawUnsafe(`SELECT pg_notify('lena_event', $1)`, payload);
} catch (err) {
  console.warn("[lena-shift-memory] youtube_mention NOTIFY failed:", err);
}
```

Variable name notes (verify by reading the surrounding ~30 lines):
- `shoutout.id` — the Shoutout row id created at `route.ts:148`.
- `body.displayName` — the field name used in the route's incoming POST body. If the route extracts this into a different local variable, use that.
- `rawText` — the raw message text in scope just above the classifier call.
- `intent.category` — the discriminator from `classifyShoutoutIntent()` return.

- [ ] **Step 2: Smoke test**

`LENA_SHIFT_MEMORY=on` + a live YouTube broadcast with a non-owner chat message → daemon log shows a NOTIFY arrival within seconds.

- [ ] **Step 3: Commit**

```bash
git add app/api/internal/youtube-chat-shoutout/route.ts
git commit -m "$(cat <<'EOF'
youtube-chat-shoutout: emit youtube_mention NOTIFY after classification

Emitting here (not the daemon-side loop) so the event payload carries
the classified intent. Phase 1 of the Lena Producer architecture.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: HTTP fallback endpoint `/api/lena/event`

For emitters that can't easily call `pg_notify` (third-party webhooks, future emitters). Same effect: posts an event, the route emits the NOTIFY.

**Files:**
- Create: `app/api/lena/event/route.ts`

- [ ] **Step 1: Locate a neighboring internal route**

Open `app/api/internal/track-started/route.ts` to confirm the conventions used in this repo (auth via `INTERNAL_API_SECRET`, Next.js App Router patterns).

- [ ] **Step 2: Write the route**

```typescript
// app/api/lena/event/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set([
  "track_aired",
  "lena_line_aired",
  "shoutout_aired",
  "youtube_mention",
  "operator_force",
]);

function authOk(req: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET ?? "";
  const got = req.headers.get("x-internal-secret") ?? "";
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || typeof (body as { type?: unknown }).type !== "string") {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }
  if (!VALID_TYPES.has((body as { type: string }).type)) {
    return NextResponse.json({ error: "unknown_type" }, { status: 400 });
  }
  try {
    await prisma.$executeRawUnsafe(`SELECT pg_notify('lena_event', $1)`, JSON.stringify(body));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("[lena-event] NOTIFY failed:", err);
    return NextResponse.json({ error: "notify_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Smoke test**

```bash
curl -X POST http://localhost:3000/api/lena/event \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -d '{"type":"operator_force","hint":"weather_check","forcedAt":'$(date +%s%3N)'}'
```

Expected: `{"ok":true}`. Daemon receives the event.

- [ ] **Step 4: Commit**

```bash
git add app/api/lena/event/route.ts
git commit -m "$(cat <<'EOF'
api/lena/event: HTTP fallback for ShiftMemory event ingestion

INTERNAL_API_SECRET-guarded POST that converts a JSON body into a
pg_notify on the lena_event channel. For emitters that can't call
pg_notify directly (third-party webhooks, future cross-process work).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Integration test — full event round-trip

End-to-end test against a real Postgres instance (the existing dev DB is fine — uses the same `DATABASE_URL`).

**Files:**
- Create: `workers/queue-daemon/lena-producer/integration.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// workers/queue-daemon/lena-producer/integration.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client as PgClient } from "pg";
import "../../../lib/load-env.ts"; // adjust path to match the repo's env loader
import { NotifyListener } from "./notify-listener.ts";
import { ShiftMemory } from "./shift-memory.ts";

test("NotifyListener round-trip: NOTIFY → onEvent → ShiftMemory.record", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const mem = new ShiftMemory();
  const listener = new NotifyListener({
    connectionString: process.env.DATABASE_URL,
    onEvent: (ev) => mem.record(ev),
  });
  await listener.start();

  // Wait briefly to ensure LISTEN is registered
  await new Promise((r) => setTimeout(r, 200));

  // Emit via a second client (mirrors how the Next.js side will emit)
  const emitter = new PgClient({ connectionString: process.env.DATABASE_URL });
  await emitter.connect();
  const payload = {
    type: "shoutout_aired",
    id: `integ-${Date.now()}`,
    handle: "test",
    originalText: "round trip",
    airedAt: Date.now(),
  };
  await emitter.query(`SELECT pg_notify('lena_event', $1)`, [JSON.stringify(payload)]);
  await emitter.end();

  // Wait for the message to flow through
  await new Promise((r) => setTimeout(r, 300));

  const view = mem.view(Date.now());
  const found = view.events.find((e) => e.id === payload.id);
  assert.ok(found, "expected NOTIFY payload to land in ShiftMemory");
  await listener.stop();
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --test-name-pattern="round-trip"`
Expected: PASS. If `DATABASE_URL` is unset (CI), test skips gracefully.

- [ ] **Step 3: Commit**

```bash
git add workers/queue-daemon/lena-producer/integration.test.ts
git commit -m "lena-producer: integration test — NOTIFY round-trip into ShiftMemory

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Deploy notes in HANDOFF.md

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Add a section at the top**

Prepend a new dated section under the topmost `---` divider in `docs/HANDOFF.md`:

```markdown
## 2026-05-16 — Lena Producer Phase 1: ShiftMemory + NOTIFY — CODE READY, NEEDS DEPLOY

Foundation for the new Lena Producer architecture. Read-only,
observability-only. No Lena behavior changes ship in this phase.

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`
**Plan:** `docs/superpowers/plans/2026-05-16-lena-producer-phase-1.md`

**What ships:**
- `Chatter.producerVersion Int?` migration (pure additive)
- `workers/queue-daemon/lena-producer/` module: ShiftMemory singleton,
  derived views (counters, mood, callback pool, show context), DB
  reconstruction on daemon boot, Postgres LISTEN/NOTIFY subscriber,
  5s poll fallback, `LENA_SHIFT_MEMORY` env flag
- Emitters wired in `app/api/internal/track-started/route.ts`,
  `dashboard/lib/shoutout.ts`, `workers/queue-daemon/youtube-chat-loop.ts`
- HTTP fallback at `POST /api/lena/event`

**Deploy:**
1. `cd /home/marku/saas/numaradio && git pull`
2. `npx prisma migrate deploy` (applies `add_chatter_producer_version`)
3. Add `LENA_SHIFT_MEMORY=on` to `/etc/numa/env`:
   ```
   sudo nano /etc/numa/env
   # add: LENA_SHIFT_MEMORY=on
   ```
4. Restart the daemon: `sudo systemctl restart numa-queue-daemon`
5. Deploy the dashboard so the shoutout emitter ships: `cd dashboard && npm run deploy`
6. Verify:
   ```
   journalctl --user -u numa-queue-daemon -f | grep lena-shift-memory
   ```
   Expect: `[lena-shift-memory] booted with N reconstructed events`
   then `[lena-shift-memory] notify healthy`.

**Rollback:** unset `LENA_SHIFT_MEMORY` in `/etc/numa/env`, restart
the daemon. Emitters in routes/lib stay (they're try/catched and a
no-op if no listener is subscribed). The migration is additive and
needs no rollback.

**Next phase:** Phase 2 ships the Producer + Writer split behind a
separate flag (`LENA_PRODUCER_AUTO`). Plan: TBD when Phase 1 is live.

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs: HANDOFF — Lena Producer Phase 1 deploy notes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass (the new tests + existing tests both green).

- [ ] **Step 2: Build the public site to confirm types are clean**

Run: `npm run build`
Expected: build completes without TS errors.

- [ ] **Step 3: Build the dashboard**

Run: `cd dashboard && npm run build`
Expected: build completes without TS errors.

- [ ] **Step 4: Push**

```bash
git push origin main
```

If your workflow uses a feature branch, push to the branch and open a PR linking the spec + plan paths in the description.

---

## What ships at end of Phase 1

✅ ShiftMemory singleton in the queue-daemon, behind a flag
✅ Event log + derived counters / mood / callback pool / show context
✅ DB reconstruction on daemon boot (last 4h)
✅ Postgres LISTEN/NOTIFY + 5s poll fallback with high-water dedup
✅ Three emitters wired (track_aired, shoutout_aired, youtube_mention)
✅ HTTP fallback endpoint
✅ `Chatter.producerVersion` migration
✅ Zero changes to Lena's spoken output — pure observability

🔜 Phase 2 builds the Producer + Writer on top of this.
