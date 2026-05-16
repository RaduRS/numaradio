# Lena Producer — Phase 5 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development.

**Goal:** Daemon-side QueueDirector + `queue_pick` Producer mode. During auto-breaks, when `LENA_QUEUE_AUTONOMY=on`, the Producer can choose to insert a specific catalog track into the `priority_request` band — Lena's spoken line then references the pick honestly ("pulling up X next"). Listener-request handling (`accept_request` for YouTube `@lena play X`) is parked as Phase 5b — that needs Vercel→daemon plumbing for cross-process queue inserts and is genuinely bigger.

**Architecture:** New module `workers/queue-daemon/lena-producer/queue-director.ts` wraps `createQueueItemAtomically` with guardrails (60-min recent-play check, same-artist guard, show-genre fit). New helper `lib/show-genre-fit.ts` maps a genre string to compatible `ShowBlock` values. Producer (Phase 2 module) extends to emit optional `queueAction`. Auto-host pre-fetches ~10 catalog candidates and passes them to the Producer for picking. When Producer emits queueAction, QueueDirector validates + inserts. Writer's queue_pick mode produces the announcement line.

**Tech Stack:** TypeScript, Prisma (daemon-side has full client), node:test.

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`

---

## File Structure

### Created
```
lib/show-genre-fit.ts                                    # genre → ShowBlock[] mapping
lib/show-genre-fit.test.ts
workers/queue-daemon/lena-producer/queue-director.ts     # guardrail wrapper around createQueueItemAtomically
workers/queue-daemon/lena-producer/queue-director.test.ts
workers/queue-daemon/lena-producer/catalog-candidates.ts # fetches eligible catalog tracks
workers/queue-daemon/lena-producer/catalog-candidates.test.ts
workers/queue-daemon/lena-producer/writers/queue-pick.ts # Writer prompt for queue_pick mode
workers/queue-daemon/lena-producer/writers/queue-pick.test.ts
```

### Modified

| File | What |
|---|---|
| `workers/queue-daemon/lena-producer/feature-flag.ts` | Add `isQueueAutonomyEnabled()` |
| `workers/queue-daemon/lena-producer/modes.ts` | Add `queue_pick` to PHASE_2_MODES; extend ProducerDecision with optional `queueAction` |
| `workers/queue-daemon/lena-producer/producer-context.ts` | Add optional `catalogCandidates` to ProducerContext |
| `workers/queue-daemon/lena-producer/producer-prompt.ts` | Teach queue_pick mode + how to pick a track_id |
| `workers/queue-daemon/lena-producer/producer.ts` | Validate queueAction.track_id is in candidates |
| `workers/queue-daemon/lena-producer/writer.ts` | Dispatch queue_pick mode |
| `workers/queue-daemon/lena-producer/index.ts` | lenaSpeak signature gains optional `queueDirector` dep; call after Writer returns queueAction |
| `workers/queue-daemon/auto-host.ts` | When flag on, pre-fetch candidates + inject queueDirector closure |
| `workers/queue-daemon/index.ts` | Wire isQueueAutonomyEnabled + fetchCatalogCandidates + queueDirector instance |
| `docs/HANDOFF.md` | Phase 5 MVP deploy notes |

---

## Task 1: Feature flag + show-genre-fit helper + queue_pick mode addition

**Files:**
- Modify: `workers/queue-daemon/lena-producer/feature-flag.ts` + `.test.ts`
- Create: `lib/show-genre-fit.ts` + `lib/show-genre-fit.test.ts`
- Modify: `workers/queue-daemon/lena-producer/modes.ts`

- [ ] **Step 1: feature flag**

Append to `workers/queue-daemon/lena-producer/feature-flag.ts`:

```typescript
export function isQueueAutonomyEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  const v = (env.LENA_QUEUE_AUTONOMY ?? "").toLowerCase();
  return v === "on" || v === "true" || v === "1";
}
```

Append to `workers/queue-daemon/lena-producer/feature-flag.test.ts` (and add the import):

```typescript
test("isQueueAutonomyEnabled returns true when env='on'", () => assert.equal(isQueueAutonomyEnabled({ LENA_QUEUE_AUTONOMY: "on" }), true));
test("isQueueAutonomyEnabled returns false when unset", () => assert.equal(isQueueAutonomyEnabled({}), false));
test("isQueueAutonomyEnabled returns false when env='off'", () => assert.equal(isQueueAutonomyEnabled({ LENA_QUEUE_AUTONOMY: "off" }), false));
```

Update the import at top: `import { isShiftMemoryEnabled, isProducerAutoEnabled, isQueueAutonomyEnabled } from "./feature-flag.ts";`

- [ ] **Step 2: show-genre-fit helper**

Create `lib/show-genre-fit.ts`:

```typescript
// lib/show-genre-fit.ts

/**
 * Maps a track's genre string to the ShowBlock values it's compatible
 * with. Used by QueueDirector to reject picks that don't fit the current
 * show-block (e.g. "ambient" doesn't fit Prime Hours; "synthwave" doesn't
 * fit Morning Room).
 *
 * Returns the set of ShowBlock names where this genre is welcome. An
 * unknown genre returns ALL blocks (be permissive, not strict).
 */

export type ShowBlockName = "Night Shift" | "Morning Room" | "Daylight Channel" | "Prime Hours";

const ALL_BLOCKS: ShowBlockName[] = ["Night Shift", "Morning Room", "Daylight Channel", "Prime Hours"];

const GENRE_MAP: Record<string, ShowBlockName[]> = {
  // Late-night moody
  ambient: ["Night Shift"],
  drone: ["Night Shift"],
  "dark ambient": ["Night Shift"],
  // Bright morning
  acoustic: ["Morning Room", "Daylight Channel"],
  folk: ["Morning Room", "Daylight Channel"],
  "indie folk": ["Morning Room", "Daylight Channel"],
  // Daylight/general
  pop: ["Morning Room", "Daylight Channel", "Prime Hours"],
  rock: ["Daylight Channel", "Prime Hours"],
  "indie rock": ["Daylight Channel", "Prime Hours"],
  "pop punk": ["Daylight Channel", "Prime Hours"],
  // Prime hours up-tempo
  electronic: ["Prime Hours", "Night Shift"],
  synth: ["Prime Hours", "Night Shift"],
  synthwave: ["Prime Hours", "Night Shift"],
  house: ["Prime Hours"],
  techno: ["Prime Hours", "Night Shift"],
  // Universal
  jazz: ["Night Shift", "Morning Room", "Daylight Channel"],
  soul: ["Morning Room", "Daylight Channel", "Prime Hours"],
};

export function showsForGenre(genre: string | null | undefined): readonly ShowBlockName[] {
  if (!genre) return ALL_BLOCKS;
  const normalized = genre.toLowerCase().trim();
  // Exact match
  if (GENRE_MAP[normalized]) return GENRE_MAP[normalized];
  // Substring match (e.g. "indie synth-pop" → tries "synth", "pop")
  for (const [key, blocks] of Object.entries(GENRE_MAP)) {
    if (normalized.includes(key)) return blocks;
  }
  // Unknown → permissive
  return ALL_BLOCKS;
}

export function genreFitsShow(genre: string | null | undefined, currentShow: ShowBlockName): boolean {
  return showsForGenre(genre).includes(currentShow);
}
```

Tests:

```typescript
// lib/show-genre-fit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { showsForGenre, genreFitsShow } from "./show-genre-fit.ts";

test("showsForGenre: ambient maps to Night Shift only", () => {
  assert.deepEqual([...showsForGenre("ambient")], ["Night Shift"]);
});

test("showsForGenre: unknown genre is permissive (returns all blocks)", () => {
  const r = showsForGenre("unidentified noise");
  assert.equal(r.length, 4);
});

test("showsForGenre: null/undefined → all blocks", () => {
  assert.equal(showsForGenre(null).length, 4);
  assert.equal(showsForGenre(undefined).length, 4);
});

test("showsForGenre: substring match (indie synth-pop hits 'synth')", () => {
  const r = showsForGenre("indie synth-pop");
  assert.ok(r.includes("Prime Hours") || r.includes("Night Shift"));
});

test("genreFitsShow: ambient fits Night Shift", () => {
  assert.equal(genreFitsShow("ambient", "Night Shift"), true);
});

test("genreFitsShow: ambient does NOT fit Prime Hours", () => {
  assert.equal(genreFitsShow("ambient", "Prime Hours"), false);
});
```

Run: `npx tsx --test lib/show-genre-fit.test.ts` → 6/6 PASS.

- [ ] **Step 3: Extend modes.ts**

In `workers/queue-daemon/lena-producer/modes.ts`:

- Change `PHASE_2_MODES` to a renamed `PRODUCER_MODES_AVAILABLE` with the new value:

```typescript
export const PRODUCER_MODES_AVAILABLE: ReadonlyArray<ProducerMode> = [
  "opinion",
  "callback",
  "aside",
  "queue_pick",  // NEW Phase 5 mode
  "silence",
];

// Backwards compat — keep the old name as an alias so producer.ts doesn't break
export const PHASE_2_MODES = PRODUCER_MODES_AVAILABLE;
```

- Extend `ProducerDecision` with optional `queueAction`:

```typescript
export interface ProducerDecision {
  mode: ProducerMode;
  targetFocus: string;
  callbackTo: string | null;
  lengthHint: "short" | "medium" | "long";
  tone: "dry" | "warm" | "playful" | "low-key";
  addressListener: string | null;
  /** Phase 5: when mode='queue_pick', the track Producer wants to insert. */
  queueAction: { kind: "pick"; trackId: string; reason: string } | null;
}
```

- [ ] **Step 4: Commit**

```bash
git add workers/queue-daemon/lena-producer/feature-flag.ts workers/queue-daemon/lena-producer/feature-flag.test.ts workers/queue-daemon/lena-producer/modes.ts lib/show-genre-fit.ts lib/show-genre-fit.test.ts
git commit -m "$(cat <<'EOF'
lena-producer: Phase 5 foundation — LENA_QUEUE_AUTONOMY + queue_pick mode + show-genre-fit

Adds the env flag, extends ProducerDecision with optional queueAction
field, expands PRODUCER_MODES_AVAILABLE to include queue_pick.
lib/show-genre-fit.ts maps genre strings to compatible show-blocks
(used as a QueueDirector guardrail). Permissive by default — unknown
genres pass all blocks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: catalog-candidates.ts — fetch eligible tracks for Producer to pick from

**Files:**
- Create: `workers/queue-daemon/lena-producer/catalog-candidates.ts` + `.test.ts`

- [ ] **Step 1: Tests**

```typescript
// workers/queue-daemon/lena-producer/catalog-candidates.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCatalogCandidates } from "./catalog-candidates.ts";

const T0 = new Date("2026-05-16T23:15:00").getTime();

test("fetchCatalogCandidates returns tracks NOT recently played and matching show genre", async () => {
  const fakePrisma = {
    track: {
      findMany: async (args: { where: { stationId: string; trackStatus: string; airingPolicy: string; id: { notIn: string[] } } }) => {
        // Pretend the catalog has 5 tracks; recently-aired list excludes some.
        const allTracks = [
          { id: "t1", title: "A", artistDisplay: "X", genre: "synth", bpm: 120 },
          { id: "t2", title: "B", artistDisplay: "Y", genre: "ambient", bpm: 80 },
          { id: "t3", title: "C", artistDisplay: "Z", genre: "rock", bpm: 130 },
          { id: "t4", title: "D", artistDisplay: "W", genre: "synth", bpm: 110 },
          { id: "t5", title: "E", artistDisplay: "V", genre: "pop", bpm: 100 },
        ];
        return allTracks.filter((t) => !args.where.id.notIn.includes(t.id)).slice(0, 10);
      },
    },
    playHistory: {
      findMany: async () => [
        { trackId: "t1", startedAt: new Date(T0 - 15 * 60_000) },  // 15min ago — exclude
        { trackId: "t3", startedAt: new Date(T0 - 50 * 60_000) },  // 50min ago — exclude
      ],
    },
  };
  const candidates = await fetchCatalogCandidates({
    prisma: fakePrisma as never,
    stationId: "s1",
    currentShow: "Prime Hours",
    nowMs: T0,
  });
  // t1 (synth, recently played), t3 (rock, recently played) excluded.
  // t2 (ambient) — does NOT fit Prime Hours.
  // t4 (synth) fits Prime Hours, not recently played → IN
  // t5 (pop) fits Prime Hours → IN
  const ids = candidates.map((c) => c.id);
  assert.ok(ids.includes("t4"));
  assert.ok(ids.includes("t5"));
  assert.ok(!ids.includes("t1"));  // recently played
  assert.ok(!ids.includes("t2"));  // wrong show-block
});

test("fetchCatalogCandidates caps at 10 candidates", async () => {
  const manyTracks = Array.from({ length: 50 }, (_, i) => ({
    id: `t${i}`,
    title: `T${i}`,
    artistDisplay: `A${i}`,
    genre: "synth",
    bpm: 120,
  }));
  const fakePrisma = {
    track: { findMany: async () => manyTracks.slice(0, 30) },  // returns more than 10
    playHistory: { findMany: async () => [] },
  };
  const candidates = await fetchCatalogCandidates({
    prisma: fakePrisma as never,
    stationId: "s1",
    currentShow: "Prime Hours",
    nowMs: T0,
  });
  assert.ok(candidates.length <= 10);
});
```

- [ ] **Step 2: Implement**

```typescript
// workers/queue-daemon/lena-producer/catalog-candidates.ts

import type { PrismaClient } from "@prisma/client";
import { genreFitsShow, type ShowBlockName } from "../../../lib/show-genre-fit.ts";

export interface CatalogCandidate {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  bpm: number | null;
}

type PrismaSlice = Pick<PrismaClient, "track" | "playHistory">;

const SIXTY_MIN_MS = 60 * 60 * 1000;
const CANDIDATE_CAP = 10;

export async function fetchCatalogCandidates(args: {
  prisma: PrismaSlice;
  stationId: string;
  currentShow: ShowBlockName;
  nowMs: number;
}): Promise<CatalogCandidate[]> {
  // 1. Find tracks aired in the last 60 min — exclude these
  const recent = await args.prisma.playHistory.findMany({
    where: {
      stationId: args.stationId,
      startedAt: { gte: new Date(args.nowMs - SIXTY_MIN_MS) },
    },
    select: { trackId: true },
  });
  const excludeIds = recent.map((r) => r.trackId).filter((id): id is string => id != null);

  // 2. Fetch up to 30 station-eligible library tracks NOT in the excluded set
  const tracks = await args.prisma.track.findMany({
    where: {
      stationId: args.stationId,
      trackStatus: "ready",
      airingPolicy: "library",
      id: { notIn: excludeIds.length > 0 ? excludeIds : ["__never__"] },
    },
    take: 30,
    select: { id: true, title: true, artistDisplay: true, genre: true, bpm: true },
  });

  // 3. Filter by show-block genre fit, cap at CANDIDATE_CAP
  const eligible = tracks
    .filter((t) => genreFitsShow(t.genre, args.currentShow))
    .slice(0, CANDIDATE_CAP)
    .map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artistDisplay,
      genre: t.genre,
      bpm: t.bpm,
    }));

  return eligible;
}
```

Run tests → 2/2 PASS.

- [ ] **Step 3: Commit**

```bash
git add workers/queue-daemon/lena-producer/catalog-candidates.ts workers/queue-daemon/lena-producer/catalog-candidates.test.ts
git commit -m "$(cat <<'EOF'
lena-producer: catalog-candidates (fetch eligible tracks for Producer pick)

Returns up to 10 library tracks for the current station that:
1. Were NOT aired in the last 60 min (anti-repeat)
2. Match the current show-block via genre-fit
The Producer picks one (or none) when it chooses queue_pick mode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: QueueDirector module

The safety wrapper around `createQueueItemAtomically`. Guardrails:
1. Same song aired within last 60 min → reject
2. Same artist as the currently playing track → reject (unless reason contains "double feature")
3. Genre fits current show-block → reject if not

**Files:**
- Create: `workers/queue-daemon/lena-producer/queue-director.ts` + `.test.ts`

- [ ] **Step 1: Tests**

```typescript
// workers/queue-daemon/lena-producer/queue-director.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { queueDirectorDecide } from "./queue-director.ts";

const T0 = new Date("2026-05-16T23:15:00").getTime();

function track(id: string, artist: string, genre: string) {
  return { id, title: id, artist, genre, bpm: 120 };
}

test("queueDirectorDecide rejects when track aired within last 60 min", () => {
  const r = queueDirectorDecide({
    proposedTrack: track("t1", "Anna", "synth"),
    currentTrack: { id: "t99", title: "X", artist: "Z", genre: "synth", bpm: 120 },
    recentTrackIds: ["t1"],
    currentShow: "Prime Hours",
    reason: "mood_shift",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /recently_aired/);
});

test("queueDirectorDecide rejects same artist back-to-back unless reason mentions 'double feature'", () => {
  const r1 = queueDirectorDecide({
    proposedTrack: track("t1", "Anna", "synth"),
    currentTrack: { id: "t99", title: "X", artist: "Anna", genre: "synth", bpm: 120 },
    recentTrackIds: [],
    currentShow: "Prime Hours",
    reason: "mood_shift",
  });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.match(r1.reason, /same_artist/);

  // Deliberate double feature exception
  const r2 = queueDirectorDecide({
    proposedTrack: track("t1", "Anna", "synth"),
    currentTrack: { id: "t99", title: "X", artist: "Anna", genre: "synth", bpm: 120 },
    recentTrackIds: [],
    currentShow: "Prime Hours",
    reason: "double feature — Anna spotlight",
  });
  assert.equal(r2.ok, true);
});

test("queueDirectorDecide rejects when genre doesn't fit current show", () => {
  const r = queueDirectorDecide({
    proposedTrack: track("t1", "Anna", "ambient"),
    currentTrack: { id: "t99", title: "X", artist: "Z", genre: "synth", bpm: 120 },
    recentTrackIds: [],
    currentShow: "Prime Hours",
    reason: "vibe",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /wrong_show_block/);
});

test("queueDirectorDecide accepts a valid pick", () => {
  const r = queueDirectorDecide({
    proposedTrack: track("t1", "Anna", "synth"),
    currentTrack: { id: "t99", title: "X", artist: "Z", genre: "rock", bpm: 120 },
    recentTrackIds: ["t5", "t6"],
    currentShow: "Prime Hours",
    reason: "mood_shift",
  });
  assert.equal(r.ok, true);
});

test("queueDirectorDecide accepts when currentTrack is null (cold-start, no current playing)", () => {
  const r = queueDirectorDecide({
    proposedTrack: track("t1", "Anna", "synth"),
    currentTrack: null,
    recentTrackIds: [],
    currentShow: "Prime Hours",
    reason: "first pick",
  });
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Implement**

```typescript
// workers/queue-daemon/lena-producer/queue-director.ts

import { genreFitsShow, type ShowBlockName } from "../../../lib/show-genre-fit.ts";

export interface ProposedTrack {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  bpm: number | null;
}

export interface CurrentTrack {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  bpm: number | null;
}

export type QueueDirectorResult =
  | { ok: true }
  | { ok: false; reason: "recently_aired" | "same_artist_too_soon" | "wrong_show_block" };

const DOUBLE_FEATURE_HINT = /\b(double[- ]?feature|spotlight)\b/i;

export function queueDirectorDecide(args: {
  proposedTrack: ProposedTrack;
  currentTrack: CurrentTrack | null;
  /** Track ids aired in the last 60 minutes. */
  recentTrackIds: readonly string[];
  currentShow: ShowBlockName;
  /** Producer's stated reason — used to allow deliberate "double feature" exceptions. */
  reason: string;
}): QueueDirectorResult {
  // 1. Recently aired check
  if (args.recentTrackIds.includes(args.proposedTrack.id)) {
    return { ok: false, reason: "recently_aired" };
  }

  // 2. Same artist as currently playing — unless deliberate double feature
  if (
    args.currentTrack &&
    args.currentTrack.artist &&
    args.proposedTrack.artist &&
    args.currentTrack.artist.toLowerCase() === args.proposedTrack.artist.toLowerCase() &&
    !DOUBLE_FEATURE_HINT.test(args.reason)
  ) {
    return { ok: false, reason: "same_artist_too_soon" };
  }

  // 3. Genre must fit current show
  if (!genreFitsShow(args.proposedTrack.genre, args.currentShow)) {
    return { ok: false, reason: "wrong_show_block" };
  }

  return { ok: true };
}
```

Run tests → 5/5 PASS.

- [ ] **Step 3: Commit**

```bash
git add workers/queue-daemon/lena-producer/queue-director.ts workers/queue-daemon/lena-producer/queue-director.test.ts
git commit -m "$(cat <<'EOF'
lena-producer: queue-director (guardrails for queue_pick)

Pure decision function: validates a Producer's proposed queue_pick
against three guardrails — recently-aired (60min), same-artist
back-to-back (with double-feature exception via reason text), and
show-genre fit. The actual queue insert (createQueueItemAtomically)
runs in workers/queue-daemon/index.ts only when decide returns ok=true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extend Producer + Writer to handle queue_pick mode

**Files:**
- Modify: `workers/queue-daemon/lena-producer/producer-context.ts` (add `catalogCandidates`)
- Modify: `workers/queue-daemon/lena-producer/producer-prompt.ts` (teach queue_pick + how to pick)
- Modify: `workers/queue-daemon/lena-producer/producer.ts` (validate queueAction.trackId is in candidates)
- Create: `workers/queue-daemon/lena-producer/writers/queue-pick.ts` + `.test.ts`
- Modify: `workers/queue-daemon/lena-producer/writer.ts` (dispatch queue_pick)

- [ ] **Step 1: Extend ProducerContext**

In `producer-context.ts`:

- Add optional field to `ProducerContext`:

```typescript
  /** Phase 5: tracks the Producer can pick from when emitting queue_pick. Empty array if queue autonomy is off. */
  catalogCandidates: Array<{ id: string; title: string; artist: string | null; genre: string | null; bpm: number | null }>;
```

- Update `buildProducerContext`'s return to include `catalogCandidates`:

```typescript
  catalogCandidates: args.memoryView ... // wait — the candidates come from the trigger payload, not memoryView
```

Actually catalogCandidates should be passed in via `buildProducerContext` args (it comes from auto-host's pre-fetch, not from ShiftMemory):

```typescript
export function buildProducerContext(deps: {
  memoryView: ShiftMemoryView;
  trigger: AutoTrackBoundaryTrigger;
  nowMs: number;
  catalogCandidates?: ProducerContext["catalogCandidates"];
}): ProducerContext {
  ...
  return {
    ...existing fields,
    catalogCandidates: deps.catalogCandidates ?? [],
  };
}
```

Update the existing producer-context.test.ts to confirm `catalogCandidates` defaults to `[]`. Add one new test:

```typescript
test("buildProducerContext exposes catalogCandidates when passed", () => {
  const mem = new ShiftMemory();
  const trigger: AutoTrackBoundaryTrigger = {
    source: "auto_track_boundary",
    nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null },
  };
  const ctx = buildProducerContext({
    memoryView: mem.view(T0),
    trigger,
    nowMs: T0,
    catalogCandidates: [{ id: "c1", title: "C", artist: "A", genre: "synth", bpm: 120 }],
  });
  assert.equal(ctx.catalogCandidates.length, 1);
  assert.equal(ctx.catalogCandidates[0].id, "c1");
});
```

- [ ] **Step 2: Update producer-prompt**

In `producer-prompt.ts`:

- Add `queue_pick` to the mode allowlist in the SYSTEM string. Mode list becomes: `"opinion" | "callback" | "aside" | "queue_pick" | "silence"`.
- Add a queueAction field to the JSON output spec:

```
{
  "mode": "opinion" | "callback" | "aside" | "queue_pick" | "silence",
  "target_focus": "...",
  "callback_to": null,
  "length_hint": "short" | "medium" | "long",
  "tone": "dry" | "warm" | "playful" | "low-key",
  "address_listener": null,
  "queue_action": null | { "kind": "pick", "track_id": "<id from catalog>", "reason": "<short why>" }
}
```

- Add a RULE: `queue_pick mode REQUIRES a queue_action with kind="pick" and a track_id from catalogCandidates. Pick only when there's a genuine reason (mood shift, genre rotation). reason='double feature' is the only way to repeat the current artist.`

- Add a USER-block section for the catalog when candidates exist:

```typescript
if (ctx.catalogCandidates.length > 0) {
  lines.push(`Catalog candidates (pick one for queue_pick mode, or skip queue_pick if none fit):`);
  for (const c of ctx.catalogCandidates.slice(0, 10)) {
    lines.push(`  - id=${c.id}: "${c.title}" by ${c.artist ?? "?"} (${c.genre ?? "?"}, ${c.bpm ?? "?"} BPM)`);
  }
}
```

- [ ] **Step 3: Update producer.ts validation**

Extend `parseDecision` to handle `queue_action` field:

```typescript
function parseDecision(
  raw: string,
  validCallbackIds: ReadonlySet<string>,
  validCatalogIds: ReadonlySet<string>,
): ProducerDecision | null {
  // ... existing validation ...
  
  // queue_action validation
  let queueAction: ProducerDecision["queueAction"] = null;
  const qa = o.queue_action;
  if (qa && typeof qa === "object" && !Array.isArray(qa)) {
    const qaO = qa as Record<string, unknown>;
    if (qaO.kind === "pick" && typeof qaO.track_id === "string" && typeof qaO.reason === "string") {
      if (validCatalogIds.has(qaO.track_id)) {
        queueAction = { kind: "pick", trackId: qaO.track_id, reason: qaO.reason };
      }
      // unknown track_id → strip silently, just like callback_to
    }
  }
  
  // If mode=queue_pick but no valid queueAction, reject (force retry/fallback)
  if (o.mode === "queue_pick" && !queueAction) return null;
  
  return {
    mode: o.mode as ProducerDecision["mode"],
    targetFocus: o.target_focus,
    callbackTo,
    lengthHint: o.length_hint as ProducerDecision["lengthHint"],
    tone: o.tone as ProducerDecision["tone"],
    addressListener: null,
    queueAction,
  };
}
```

Update the call site in `runProducer` to pass `validCatalogIds`:

```typescript
const validCatalogIds = new Set(ctx.catalogCandidates.map((c) => c.id));
// pass to parseDecision in both attempts
```

- [ ] **Step 4: Create queue-pick writer**

`writers/queue-pick.ts`:

```typescript
import type { ProducerDecision } from "../modes.ts";
import { LENGTH_WORDS } from "../modes.ts";
import type { ProducerContext } from "../producer-context.ts";

const SYSTEM = `You write ONE spoken line for Lena, a calm slightly-studio-slang DJ on Numa Radio.
Mode: queue_pick. You're announcing a track YOU just chose to play next.

RULES:
- Contractions. Spoken English. No poetry.
- Tease the pick — name the artist + title naturally, give a brief reason ("breaking up the synth run", "pulling something quieter for the hour", "this one's been on my mind tonight").
- Do not use any 4+ word substring from recently_aired_lines.
- BANNED phrases: "let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them", "going out to".
- The track WILL play after this — be honest. Don't promise something else.

OUTPUT: one line. No quotes. No stage directions.`;

export function buildQueuePickPrompt(
  decision: ProducerDecision,
  ctx: ProducerContext,
  recentAiredLines: readonly string[],
): { system: string; user: string } {
  const w = LENGTH_WORDS[decision.lengthHint];
  const action = decision.queueAction;
  const picked = action ? ctx.catalogCandidates.find((c) => c.id === action.trackId) : null;
  const lines: string[] = [];
  lines.push(`target_focus: ${decision.targetFocus}`);
  lines.push(
    `picked_track: ${picked ? `"${picked.title}" by ${picked.artist ?? "?"} (${picked.genre ?? "?"})` : "(unresolved — write a generic next-track tease)"}`,
  );
  lines.push(`pick_reason: ${action?.reason ?? "(unspecified)"}`);
  lines.push(`tone: ${decision.tone}`);
  lines.push(`length: ${w.min}-${w.max} words`);
  if (recentAiredLines.length > 0) {
    lines.push(`recently_aired_lines (DO NOT echo):`);
    for (const l of recentAiredLines) lines.push(`  - ${l}`);
  }
  lines.push("");
  lines.push("Write the announcement now.");
  return { system: SYSTEM, user: lines.join("\n") };
}
```

Tests:

```typescript
// workers/queue-daemon/lena-producer/writers/queue-pick.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueuePickPrompt } from "./queue-pick.ts";

const ctx = {
  trigger: { source: "auto_track_boundary" as const, nextTrack: { id: "x", title: "X", artist: null, genre: null, bpm: null } },
  now: { localTime: "23:15", bucket: "night" },
  show: { name: "Prime Hours", minutesIn: 60, minutesUntilNext: 360 },
  recentTracksSummary: "(none)",
  recentLinesSummary: "(none)",
  callbackPool: [],
  counters: { msSinceLastLine: Infinity, msSinceLastWeatherMention: Infinity, msSinceLastStationDrop: Infinity, tracksSinceLastShoutout: 0 },
  mood: { currentRun: { genre: null, count: 0 }, tempoTrend: "steady" as const, avgBpmLast5: null, topGenreThisHour: null },
  catalogCandidates: [{ id: "c1", title: "Dusk", artist: "Anna", genre: "synth", bpm: 112 }],
};

test("buildQueuePickPrompt includes picked track title/artist", () => {
  const decision = {
    mode: "queue_pick" as const,
    targetFocus: "mood shift",
    callbackTo: null,
    lengthHint: "short" as const,
    tone: "warm" as const,
    addressListener: null,
    queueAction: { kind: "pick" as const, trackId: "c1", reason: "mood_shift" },
  };
  const p = buildQueuePickPrompt(decision, ctx, []);
  assert.match(p.user, /Dusk/);
  assert.match(p.user, /Anna/);
});

test("buildQueuePickPrompt bans 'let it ride'", () => {
  const decision = {
    mode: "queue_pick" as const,
    targetFocus: "x",
    callbackTo: null,
    lengthHint: "short" as const,
    tone: "warm" as const,
    addressListener: null,
    queueAction: { kind: "pick" as const, trackId: "c1", reason: "x" },
  };
  const p = buildQueuePickPrompt(decision, ctx, []);
  assert.match(p.system, /let it ride/i);
});
```

- [ ] **Step 5: Update writer.ts dispatcher**

Add a case for `queue_pick`:

```typescript
import { buildQueuePickPrompt } from "./writers/queue-pick.ts";

// inside runWriter, add:
else if (decision.mode === "queue_pick") prompts = buildQueuePickPrompt(decision, ctx, recentAiredLines);
```

- [ ] **Step 6: Run all affected tests + Commit**

Run: `npx tsx --test workers/queue-daemon/lena-producer/producer-context.test.ts workers/queue-daemon/lena-producer/producer.test.ts workers/queue-daemon/lena-producer/writer.test.ts workers/queue-daemon/lena-producer/writers/queue-pick.test.ts`

If existing producer.test.ts breaks because of the new queueAction field, add it as `queueAction: null` to existing test expectations.

```bash
git add workers/queue-daemon/lena-producer/producer-context.ts workers/queue-daemon/lena-producer/producer-prompt.ts workers/queue-daemon/lena-producer/producer.ts workers/queue-daemon/lena-producer/writer.ts workers/queue-daemon/lena-producer/writers/queue-pick.ts workers/queue-daemon/lena-producer/writers/queue-pick.test.ts workers/queue-daemon/lena-producer/producer.test.ts workers/queue-daemon/lena-producer/producer-context.test.ts
git commit -m "$(cat <<'EOF'
lena-producer: queue_pick mode end-to-end (Producer + Writer + types)

- ProducerContext gains catalogCandidates (passed in by auto-host)
- producer-prompt teaches queue_pick mode + picks from catalog
- producer.ts validates queue_action.track_id is in candidates;
  rejects mode=queue_pick without a valid queue_action (force fallback)
- New writers/queue-pick.ts builds the announcement line
- writer.ts dispatcher routes the new mode

ProducerDecision.queueAction is null for all other modes — only
queue_pick populates it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire QueueDirector into auto-host.ts + daemon boot

**Files:**
- Modify: `workers/queue-daemon/lena-producer/index.ts` (lenaSpeak gains optional queueDirector dep + catalogCandidates plumbing)
- Modify: `workers/queue-daemon/auto-host.ts` (pre-fetch candidates, inject director)
- Modify: `workers/queue-daemon/index.ts` (wire isQueueAutonomyEnabled + fetchCatalogCandidates + queueDirector closure)

- [ ] **Step 1: Update lenaSpeak signature**

In `workers/queue-daemon/lena-producer/index.ts`, extend `LenaSpeakArgs` and `LenaResult`:

```typescript
export interface LenaResult {
  text: string;
  mode: ProducerMode;
  targetFocus: string;
  /** Phase 5: the queue action Producer emitted, after QueueDirector validation.
   *  null when not a queue_pick OR when QueueDirector rejected. */
  queueActionPersisted: { trackId: string; reason: string } | null;
}

export interface LenaSpeakArgs {
  trigger: AutoTrackBoundaryTrigger;
  memory: ShiftMemory;
  llm: (prompts: { system: string; user: string }) => Promise<string>;
  nowMs: number;
  /** Phase 5: when present, Producer can emit queue_pick and director will insert. */
  catalogCandidates?: { id: string; title: string; artist: string | null; genre: string | null; bpm: number | null }[];
  /** Phase 5: validates + commits a queue insert. Returns true if inserted. */
  queueDirector?: (action: { trackId: string; reason: string }) => Promise<boolean>;
}
```

Update `lenaSpeak`:

```typescript
export async function lenaSpeak(args: LenaSpeakArgs): Promise<LenaResult | null> {
  const view = args.memory.view(args.nowMs);
  const ctx = buildProducerContext({
    memoryView: view,
    trigger: args.trigger,
    nowMs: args.nowMs,
    catalogCandidates: args.catalogCandidates ?? [],
  });

  const decision = await runProducer(ctx, { llm: args.llm });
  if (decision.mode === "silence") return null;

  // Phase 5: if Producer emitted queue_pick, ask QueueDirector to insert.
  // If director rejects, downgrade the line so it doesn't lie ("pulling up X" with no insert = bad).
  let queueActionPersisted: LenaResult["queueActionPersisted"] = null;
  if (decision.mode === "queue_pick" && decision.queueAction && args.queueDirector) {
    const ok = await args.queueDirector({ trackId: decision.queueAction.trackId, reason: decision.queueAction.reason });
    if (ok) {
      queueActionPersisted = { trackId: decision.queueAction.trackId, reason: decision.queueAction.reason };
    } else {
      // Director rejected. Strip queue_action from decision so the Writer
      // produces a non-pick line, AND change mode to aside to avoid the
      // queue_pick writer trying to announce a phantom track.
      decision.queueAction = null;
      decision.mode = "aside";
      decision.targetFocus = "general moment";
    }
  }

  const recentAiredLines = view.recentLines.slice(0, 5).map((l) => l.text);
  try {
    const text = await runWriter(decision, ctx, recentAiredLines, { llm: args.llm });
    if (!text) return null;
    return { text, mode: decision.mode, targetFocus: decision.targetFocus, queueActionPersisted };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Update auto-host.ts**

In `workers/queue-daemon/auto-host.ts`:

- Extend `AutoHostDeps.lenaSpeak` signature to include the new optional fields:

```typescript
  lenaSpeak?: (trigger: {
    source: "auto_track_boundary";
    nextTrack: { id: string; title: string; artist: string | null; genre: string | null; bpm: number | null };
  }) => Promise<{ text: string; mode: string; targetFocus: string; queueActionPersisted: { trackId: string; reason: string } | null } | null>;
```

(Add `queueActionPersisted` to the return shape so the auto-host can log it.)

NOTE: For Phase 5 MVP, the catalogCandidates + queueDirector wiring goes through the daemon-boot wiring of `lenaSpeak` (Task 5 Step 3 below). The auto-host doesn't fetch candidates itself — the daemon-boot's `lenaSpeak` closure does.

That said, optionally log when a queue action was persisted:

```typescript
const r = await this.deps.lenaSpeak({...});
if (r) {
  script = r.text;
  producerVersion = 1;
  producerMode = r.mode;
  if (r.queueActionPersisted) {
    this.deps.logFailure({  // logFailure exists as a generic logger
      reason: "producer_queue_pick_persisted",
      detail: `track=${r.queueActionPersisted.trackId} reason=${r.queueActionPersisted.reason}`,
    });
  }
}
```

- [ ] **Step 3: Update daemon boot**

In `workers/queue-daemon/index.ts`:

- Add imports:

```typescript
import { queueDirectorDecide } from "./lena-producer/queue-director.ts";
import { fetchCatalogCandidates } from "./lena-producer/catalog-candidates.ts";
import { isQueueAutonomyEnabled } from "./lena-producer/feature-flag.ts";
import { showForHour } from "@/lib/schedule";  // if this exists, otherwise import from auto-host
```

Check `lib/schedule.ts` for the helper that maps hour → ShowBlock — adjust import as needed.

- Modify the existing `lenaSpeak: async (trigger) => {...}` closure in the autoHost dep block:

```typescript
lenaSpeak: async (trigger) => {
  if (!shiftMemory) return null;
  const sid = await stationId();
  const queueAutonomyOn = isQueueAutonomyEnabled(process.env);

  // Phase 5: pre-fetch catalog candidates + provide a QueueDirector
  // closure ONLY when LENA_QUEUE_AUTONOMY is on. Without it, Producer
  // can't emit queue_pick (no candidates, no director).
  let catalogCandidates: Array<{ id: string; title: string; artist: string | null; genre: string | null; bpm: number | null }> = [];
  let queueDirector: ((action: { trackId: string; reason: string }) => Promise<boolean>) | undefined;

  if (queueAutonomyOn) {
    const nowHour = new Date().getHours();
    const currentShow = showForHour(nowHour).name as "Night Shift" | "Morning Room" | "Daylight Channel" | "Prime Hours";
    try {
      catalogCandidates = await fetchCatalogCandidates({
        prisma,
        stationId: sid,
        currentShow,
        nowMs: Date.now(),
      });
    } catch (err) {
      console.warn("[queue-director] fetchCatalogCandidates failed:", err);
    }

    queueDirector = async (action) => {
      // Fetch the proposed track + current playing track + recently aired
      const [proposed, np, recent] = await Promise.all([
        prisma.track.findUnique({ where: { id: action.trackId }, select: { id: true, title: true, artistDisplay: true, genre: true, bpm: true } }),
        prisma.nowPlaying.findUnique({ where: { stationId: sid }, select: { currentTrackId: true } }),
        prisma.playHistory.findMany({
          where: { stationId: sid, startedAt: { gte: new Date(Date.now() - 60 * 60_000) } },
          select: { trackId: true },
        }),
      ]);
      if (!proposed) return false;
      const currentTrack = np?.currentTrackId
        ? await prisma.track.findUnique({ where: { id: np.currentTrackId }, select: { id: true, title: true, artistDisplay: true, genre: true, bpm: true } })
        : null;

      const decision = queueDirectorDecide({
        proposedTrack: { id: proposed.id, title: proposed.title, artist: proposed.artistDisplay, genre: proposed.genre, bpm: proposed.bpm },
        currentTrack: currentTrack
          ? { id: currentTrack.id, title: currentTrack.title, artist: currentTrack.artistDisplay, genre: currentTrack.genre, bpm: currentTrack.bpm }
          : null,
        recentTrackIds: recent.map((r) => r.trackId).filter((id): id is string => id != null),
        currentShow,
        reason: action.reason,
      });

      if (!decision.ok) {
        console.warn(`[queue-director] rejected pick ${action.trackId}: ${decision.reason}`);
        return false;
      }

      // Accepted — insert into priority_request band via the existing atomic helper
      try {
        await createQueueItemAtomically(sid, {
          stationId: sid,
          queueType: "music",
          sourceObjectType: "track",
          sourceObjectId: action.trackId,
          trackId: action.trackId,
          priorityBand: "priority_request",
          queueStatus: "planned",
          reasonCode: `lena_pick:${action.reason.slice(0, 50)}`,
          insertedBy: "lena_producer",
        });
        console.log(`[queue-director] inserted ${action.trackId} (reason: ${action.reason})`);
        return true;
      } catch (err) {
        console.warn(`[queue-director] insert failed for ${action.trackId}:`, err);
        return false;
      }
    };
  }

  return runLenaSpeak({
    trigger,
    memory: shiftMemory,
    nowMs: Date.now(),
    llm: async (prompts) => generateChatterScript(prompts, { apiKey: process.env.MINIMAX_API_KEY ?? "" }),
    catalogCandidates,
    queueDirector,
  });
},
```

> NOTE on `showForHour`: check if it exists in `lib/schedule.ts` (auto-host.ts already imports it). If yes, import it. If the helper has a different name, adjust.

> NOTE on `createQueueItemAtomically`: it's already defined in `workers/queue-daemon/index.ts` (line 432). The closure has access to it since it's in the same file.

> NOTE on the QueueItem create `data`: the exact field names + values must match the existing schema. Check `prisma/schema.prisma:386-411` and `workers/queue-daemon/index.ts` for the existing `createQueueItemAtomically` calls — match their shape exactly.

- [ ] **Step 4: Type-check + tests + builds**

```bash
cd /home/marku/saas/numaradio
npx tsc --noEmit 2>&1 | grep "lena-producer\|auto-host\|queue-daemon/index" | head -10
npm test 2>&1 | grep -E "^(ℹ|# )" | tail -8
npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -3
```

- [ ] **Step 5: Commit**

```bash
git add workers/queue-daemon/lena-producer/index.ts workers/queue-daemon/auto-host.ts workers/queue-daemon/index.ts
git commit -m "$(cat <<'EOF'
queue-daemon: wire QueueDirector + catalog candidates for queue_pick

Daemon-boot's lenaSpeak closure now fetches catalog candidates (when
LENA_QUEUE_AUTONOMY=on) and provides a queueDirector closure that
runs guardrails (recently_aired / same_artist / show_genre_fit) and
inserts into priority_request via the existing
createQueueItemAtomically.

When QueueDirector rejects a Producer's queue_pick, lenaSpeak
downgrades the decision to mode=aside so the line doesn't lie to
listeners about a phantom track insert.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: HANDOFF.md + park Phase 5b in TODO.md

**Files:**
- Modify: `docs/HANDOFF.md` (prepend section)
- Modify: `TODO.md` (add Phase 5b parked work)

- [ ] **Step 1: HANDOFF section**

Prepend to `docs/HANDOFF.md`:

```markdown
## 2026-05-16 — Lena Producer Phase 5 MVP: queue_pick (Lena programs her booth) — CODE READY, NEEDS ENV

Lena can now insert tracks into the queue during auto-breaks. Behind
`LENA_QUEUE_AUTONOMY` flag, default off. Requires `LENA_SHIFT_MEMORY`
+ `LENA_PRODUCER_AUTO` to also be on (queue_pick is a Producer mode).

**Spec:** `docs/superpowers/specs/2026-05-16-lena-producer-design.md`
**Plan:** `docs/superpowers/plans/2026-05-16-lena-producer-phase-5-mvp.md`

**What ships:**
- `lib/show-genre-fit.ts` — genre → ShowBlock compatibility mapping
- `workers/queue-daemon/lena-producer/queue-director.ts` — guardrails
- `workers/queue-daemon/lena-producer/catalog-candidates.ts` — fetches
  up to 10 eligible tracks (not aired in last 60min, genre fits current show)
- Producer/Writer extended with `queue_pick` mode + `queueAction` field
- Daemon boot wires catalog fetch + QueueDirector closure when flag on
- Inserts go through existing `createQueueItemAtomically` (same path as
  shoutouts) — priority_request band, generated music rotation still
  takes priority

**Guardrails (enforced in code, not prompt):**
- Recently aired (≤60 min) → reject
- Same artist as currently playing → reject (unless reason contains "double feature")
- Genre doesn't fit current show-block → reject
On reject, Producer's line is downgraded to a non-pick aside so Lena
doesn't lie to listeners about a phantom track.

**Deploy:**
1. `cd /home/marku/saas/numaradio && git pull` on Orion
2. Add to `/etc/numa/env`:
   ```
   sudo nano /etc/numa/env
   # add: LENA_QUEUE_AUTONOMY=on
   # (Phase 2's LENA_PRODUCER_AUTO + Phase 1's LENA_SHIFT_MEMORY must also be on)
   ```
3. `sudo systemctl restart numa-queue-daemon`
4. Watch: `journalctl --user -u numa-queue-daemon -f | grep -E "queue-director|producer_queue_pick"`
   - `[queue-director] inserted <trackId>` → Lena picked + insert succeeded
   - `[queue-director] rejected pick <trackId>: <reason>` → guardrail caught it
   - `[auto-chatter] fail producer_queue_pick_persisted ...` → audit trail of accepted picks

**Rollback:** unset `LENA_QUEUE_AUTONOMY` in `/etc/numa/env`, restart
daemon. Producer can't emit queue_pick (no candidates, no director),
behavior returns to Phase 2.

**Phase 5b (listener `@lena play X` requests) is PARKED in TODO.md.**
That needs Vercel→daemon plumbing for cross-process queue inserts.

---
```

- [ ] **Step 2: TODO.md entry for Phase 5b**

Add to `TODO.md` (under the existing "Lena Producer — Phases 2 through 6" section, or as a new sibling section):

```markdown
## Lena Producer Phase 5b — Listener song requests

**Status:** parked 2026-05-16. Phase 5 MVP (daemon-side queue_pick) is
shipped locally; Phase 5b extends the queue-autonomy story to listener
requests via YouTube `@lena play X` messages.

**Why it's not in Phase 5 MVP:** the listener-request dispatch route
runs on Vercel (`app/api/internal/youtube-chat-shoutout/route.ts`),
but the queue insert (`createQueueItemAtomically`) runs in the daemon.
Cross-process queue insert requires either:
1. A new HTTP endpoint on the daemon (exposed via cloudflared) that
   Vercel POSTs to with the desired trackId + reason. Daemon validates
   via QueueDirector + inserts.
2. Vercel-side QueueDirector that writes directly to `QueueItem` via
   Prisma — but needs careful pg_advisory_xact_lock coordination with
   the daemon's createQueueItemAtomically. Risky.

**Recommended approach:** option 1 (HTTP endpoint on daemon). The
daemon already has an HTTP server on loopback :4000; expose
`POST /lena-queue-action` via cloudflared at `api.numaradio.com/...`
with the existing `INTERNAL_API_SECRET` auth.

**What ships in 5b:**
- New `POST /lena-queue-action` on daemon HTTP server
- Cloudflared route for it
- Vercel-side classifier + Producer-lite for chat request intents
  (`request` + `shoutout_with_request`) — extend `lib/lena-producer-chat/`
  with new modes: `accept_request`, `accept_request_deferred`, `decline_request`
- Catalog candidate lookup on Vercel side (Prisma fuzzy match on Track
  title/artist against listener's request text)
- Dispatch route gates request-intent handling behind `LENA_REQUEST_AUTONOMY`
- Lena's reply line is consistent with what's queued ("Pulling Aphex up
  for you, Anna — coming after this one")

**Estimated size:** ~12-15 tasks. Bigger than Phase 5 MVP because of the
cross-process plumbing + auth + Vercel-side catalog lookup.

**When to ship:** after Phase 5 MVP has been live + observed for a few
days. Verify the QueueDirector guardrails work as expected before adding
listener-driven queue inserts on top.
```

- [ ] **Step 3: Commit both**

```bash
git add docs/HANDOFF.md TODO.md
git commit -m "$(cat <<'EOF'
docs: Phase 5 MVP HANDOFF notes + park Phase 5b (listener requests) in TODO

Phase 5 MVP ships daemon-side queue_pick (Lena picks her own tracks
during auto-breaks). Phase 5b — listener @lena play X requests — needs
cross-process Vercel→daemon plumbing and is genuinely bigger; parked
with a clear resume recipe in TODO.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- `npm test 2>&1 | grep -E "^(ℹ|# )" | tail -8` — expect ~625+ pass
- `npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -3` — ✓
- `cd dashboard && npm run build 2>&1 | grep -E "(error|✓ Compiled)" | head -3` — ✓
- DO NOT push

---

## What ships

✅ `lib/show-genre-fit.ts` — pure function genre → ShowBlock[]
✅ `workers/queue-daemon/lena-producer/queue-director.ts` — guardrails
✅ `workers/queue-daemon/lena-producer/catalog-candidates.ts` — track fetcher
✅ Producer/Writer extended with queue_pick mode
✅ `LENA_QUEUE_AUTONOMY` flag (default off)
✅ Daemon-boot wires catalog fetch + QueueDirector closure
✅ Inserts go through existing `createQueueItemAtomically`
✅ Phase 5b (listener requests) explicitly parked in TODO.md

🔜 Phase 5b — listener requests (separate plan, after observation)
🔜 Phase 6 — delete deprecated paths (after Phases 2-5 deployed + observed)
