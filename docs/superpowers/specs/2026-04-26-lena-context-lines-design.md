# Lena context lines — design

Date: 2026-04-26

## Problem

The dynamic Lena quote system has two of its three tiers shipping:

- **Tier 1 — auto-chatter** (≤ 5 min): real Lena script from the queue
  daemon's broadcast pipeline. Already live (Apr 26, 4f0ab49).
- **Tier 3 — pool fallback** (always): 600 evergreen Lena lines (~150
  per show), Claude Opus 4.7. Already live (f537ecd).

The middle tier is missing: lines that *would* sound like Lena
referencing **real station state right now** ("Three of you wrote in
the last ten minutes." / "Forty-seven songs since midnight here.")
but generated periodically rather than on every page render. This
spec defines that tier.

## Goal

Background-generate 1 context-aware Lena line every ~10 minutes that
references **truthful** station state, write it to Neon, and have
the public API surface it as the second-priority tier when no fresh
auto-chatter is available. Total cost: ~144 MiniMax calls/day,
trivial against the available 1500/5h capacity.

## Non-goals

- Replacing the pool — it stays the floor
- Real-time line generation per page request (too expensive, too
  slow for SSR)
- Generating audio for context lines (text only — these are written
  display, not on-air content)
- Cross-shift carry-over (lines stale at 30 min)

## Architecture (additive on top of existing Chatter table)

```
queue-daemon (Orion) ─ every 10 min ──┐
                                       ▼
                            gather station state from Neon
                            (shoutout count last 10/30 min,
                             song requests last hour + this shift,
                             tracks aired this shift,
                             fresh ingests last 24h, top genre last hour,
                             votes up/down last 30 min,
                             listener count incl. floor,
                             time-of-shift, recent shoutout samples)
                                       │
                                       ▼
                            build prompt with truthful JSON state
                                       │
                                       ▼
                            MiniMax (existing minimax-script.ts)
                                       │
                                       ▼
                            validate (banned phrases, no false counts)
                                       │
                                       ▼
                            INSERT INTO Chatter
                              chatterType = "context_line"
                              audioUrl = null
                              script = generated text
                              airedAt = now()
                                       │
                                       ▼
                ┌──────────── Public API: /api/station/lena-line ────┐
                │                                                     │
                │  1. Chatter where airedAt > now-5min                 │
                │     AND chatterType != "context_line"                │
                │     → return as "live"                               │
                │                                                     │
                │  2. Chatter where airedAt > now-30min                │
                │     AND chatterType = "context_line"                 │
                │     → return as "context"                            │
                │                                                     │
                │  3. Pool fallback                                    │
                │     → return as "pool"                               │
                └──────────────────────────────────────────────────────┘
```

## Schema

**No change.** Reuse the existing `Chatter` table from
`2026-04-26-lena-quote-dynamic-design.md`. The `chatterType` column
already takes free-form strings — context-line rows simply use
`chatterType = "context_line"` and leave `audioUrl` null.

This keeps the public API single-table and avoids a migration.

## Background tick (in queue-daemon)

New file: `workers/queue-daemon/context-line.ts`

Public API of the module:

```ts
export interface ContextLineDeps {
  fetchStationState: () => Promise<StationState>;
  generateLine: (state: StationState) => Promise<string>;
  persistLine: (script: string) => Promise<void>;
  logSuccess: (script: string) => void;
  logFailure: (reason: string, detail?: string) => void;
}

export class ContextLineOrchestrator {
  constructor(private deps: ContextLineDeps) {}
  async runOnce(): Promise<void> { … }
}
```

`StationState` shape:

```ts
interface StationState {
  show: ShowBlock;                    // current show enum
  hourOfShift: number;                // 0..6 — how deep into the show window
  shoutoutsLast10Min: number;         // count
  shoutoutsLast30Min: number;         // count
  songRequestsLastHour: number;       // count
  songRequestsThisShift: number;      // listener-generated tracks queued this shift
  tracksAiredThisShift: number;       // count since shift boundary
  freshTracksLast24h: number;         // ingest count last 24h (Track.createdAt)
  topGenreLastHour: string | null;    // derived from PlayHistory + Track.genre
  votesUpLast30Min: number;           // count
  votesDownLast30Min: number;         // count
  listenersWithFloor: number | null;  // current listener count or null
  // Sample of up to 3 recent shoutout TEXTS so the model can pick
  // a thematic line if there's a pattern. Truncated to 60 chars
  // each. Never quoted verbatim by the model.
  recentShoutoutSamples: string[];
}
```

`runOnce()` is called by `setInterval` in `index.ts` every 10 min.
On each tick:

1. Gather state via Prisma queries (small, indexed)
2. Pass to MiniMax with the system prompt below
3. Validate the result (see Validation below)
4. If valid: persist as Chatter row, log success
5. If invalid or fail: log failure (don't throw), wait for next tick

## MiniMax prompt

System prompt (~600 tokens):

```
You are Lena, the AI host of Numa Radio's <show name>.

Voice: <show-specific vibe — copied from generate-lena-quote-pool.ts>

You are about to drop ONE short on-the-air aside that references the
station's REAL current state. The state is provided as JSON below.
Pick ONE fact from the state and build a single Lena line around it.

Your line MUST:
- Be 1-2 sentences, max 200 characters
- Stay in Lena's voice (AI-aware OK, no fake-human-physical events)
- Reference the chosen fact ACCURATELY using the exact number or
  category given. If you say "three of you", the state must show
  shoutoutsLast10Min=3. If you say "many", the count is >10. If
  the state shows 0 of something, do NOT claim activity.
- Never make up a fact that isn't in the JSON
- Never reference specific clock times ("4:13 AM" — bad)
- Never name real or fake artists/tracks (the catalogue is OK to
  reference generically: "the rotation", "tonight's stretch")

Banned phrases (same as the pool):
<paste UNIVERSAL_CONTEXT bans from generate-lena-quote-pool.ts>

Output ONLY the line. No prefix, no commentary, no quotes.
```

User message:

```
Station state right now:
{
  "show": "night_shift",
  "hourOfShift": 2,
  "shoutoutsLast10Min": 3,
  "shoutoutsLast30Min": 7,
  "songRequestsLastHour": 1,
  "songRequestsThisShift": 4,
  "tracksAiredThisShift": 24,
  "freshTracksLast24h": 12,
  "topGenreLastHour": "ambient",
  "votesUpLast30Min": 8,
  "votesDownLast30Min": 1,
  "listenersWithFloor": 18,
  "recentShoutoutSamples": ["happy birthday to my mum…", "rainy lisbon vibe", "play something slow"]
}

Generate one Lena line.
```

## Validation

Before persisting, every generated line passes:

1. **Length**: 1–200 chars, has at least one alphabetic character
2. **Banned phrase check**: same regex as pool generator
   (`BANNED_REGEX` from generate-lena-quote-pool.ts)
3. **Numerical-claim check**: extract any number-words ("three",
   "five", "many"…) and digits from the line; verify they are
   consistent with the state. If the line says "three of you wrote",
   `shoutoutsLast10Min` or `shoutoutsLast30Min` must equal 3
4. **No clock-time references**: regex catches "X:YY AM/PM" patterns
5. **No real artists/tracks**: simple deny-list over the catalogue

If any check fails, log + skip. Next tick (10 min later) will
retry.

## Public API change

`/api/station/lena-line/route.ts` — extend the existing query path
to look at two windows in priority order:

```ts
// Tier 1 — real auto-chatter (audio-bearing types)
const live = await prisma.chatter.findFirst({
  where: {
    stationId,
    airedAt: { gt: cutoffLive },
    chatterType: { not: "context_line" },
  },
  orderBy: { airedAt: "desc" },
});
if (live) return { source: "live", … };

// Tier 2 — context line
const context = await prisma.chatter.findFirst({
  where: {
    stationId,
    airedAt: { gt: cutoffContext },
    chatterType: "context_line",
  },
  orderBy: { airedAt: "desc" },
});
if (context) return { source: "context", … };

// Tier 3 — pool
…
```

Frontend type union:

```ts
type LenaLine =
  | { source: "live"; script; atIso; type; show }
  | { source: "context"; script; atIso; show }   // NEW
  | { source: "pool"; script; show }
  | null;
```

The `<LenaLine />` component shows the same "Host · Live · just now"
pill formatting for both `live` and `context` sources.

## Tick scheduling (in queue-daemon/index.ts)

Add to the existing daemon `index.ts`:

```ts
const contextLine = new ContextLineOrchestrator({
  fetchStationState: () => buildStationState(prisma, stationId),
  generateLine: (state) =>
    generateContextLine(state, { apiKey: process.env.MINIMAX_API_KEY ?? "" }),
  persistLine: async (script) => {
    await prisma.chatter.create({
      data: {
        stationId,
        chatterType: "context_line",
        slot: 0,
        script,
        audioUrl: null,
      },
    });
  },
  logSuccess: (s) => console.log(`[context-line] ${s.slice(0, 80)}`),
  logFailure: (r, d) => console.warn(`[context-line] fail ${r}: ${d ?? ""}`),
});

setInterval(() => contextLine.runOnce().catch(() => {}), 10 * 60_000);
contextLine.runOnce().catch(() => {}); // first tick now (~30s after boot)
```

## Cost & rate

- 1 call every 10 min → ~144 calls/day
- ~500 input tokens + ~50 output tokens per call
- Total: ~80k tokens/day
- Against the user's 1500 calls / 5 hours budget: ~2 % utilisation
- Cost: trivial (MiniMax pricing puts this at well under $0.10/day)

## Edge cases

- **Daemon restart kills in-flight tick**: next tick fires 10 min
  later, no harm
- **Neon outage**: state-gather throws → tick logs + skips, retries
  in 10 min
- **MiniMax outage / rate limit**: same — log + skip
- **Validation fails (model breaks rules)**: drop + skip; pool serves
  in the meantime
- **State is "uninteresting" (zero shoutouts, low count)**: prompt
  steers model toward general AI-aware lines (e.g., "wall's been
  quiet — I don't mind"), still grounded in `shoutoutsLast30Min: 0`
- **Listener count is null** (Icecast unreachable): omit the field
  from JSON; model adapts

## Frontend impact

Minimal. `<LenaLine />` already handles `live` source with a
"just now / X min ago" pill. Add `context` to the union type and
render the same pill — listener doesn't need to know whether the
line is real audio or generated context, just that it's *fresh*.

## Tests

- **buildStationState**: pure function over a mock Prisma — assert
  shape with various recent-row scenarios (zero, one, many)
- **validate**: every banned-phrase + numerical-claim case
- **ContextLineOrchestrator.runOnce**: deps fully injectable, run
  through happy path + each failure mode, assert correct logs

## Build sequence

1. **Spec** (this doc) ✓
2. `workers/queue-daemon/context-line.ts` — orchestrator class +
   state gatherer
3. MiniMax prompt + adapter (reuses existing minimax-script.ts
   shape — small per-call max_tokens)
4. Validator
5. Wire into `queue-daemon/index.ts` setInterval, run first tick
   shortly after boot
6. Update `/api/station/lena-line/route.ts` to layer tier 2
7. Update frontend `useLenaLine` types + `<LenaLine />` to handle
   `source: "context"` (cosmetic only — same pill)
8. Daemon restart on Orion to pick up the new tick
9. Watch first 3 ticks via journalctl; expect "[context-line] …"
   lines with sensible truthful claims

## Out of scope (deferred)

- Operator-side curation of context lines (manual approval queue)
- Per-show tick frequency (e.g., faster during Prime Hours when wall
  is busiest) — start uniform 10 min everywhere
- Surfacing context-line history on the dashboard — small follow-up
  if useful
- Telemetry on which sources show most often — basic logs cover it
