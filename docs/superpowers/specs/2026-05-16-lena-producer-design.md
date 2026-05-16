# Lena Producer — design

**Date:** 2026-05-16
**Status:** Design — pending implementation plan
**Supersedes:** parts of `2026-04-22-lena-auto-chatter-design.md`, `2026-04-26-lena-context-lines-design.md`, `2026-04-26-lena-world-aside-design.md`

## Problem

Lena's current responses feel repetitive and reactive. Listeners notice:

- Recurring catchphrases ("we'll let it ride", "we'll take that one") — traced to a literal example in `dashboard/lib/humanize.ts:~130` that MiniMax pattern-matches into output
- Formulaic openers ("Going out to X tonight…") on ~80% of shoutouts
- No memory across the shift — every line is generated independently with last-3-artists context only
- No agenda — she describes the music instead of having opinions, callbacks, or non-music asides with intent
- Three separate generation paths (`auto-host.ts`, `lena-reply.ts`, `humanize.ts`) each prompt MiniMax with their own ad-hoc prompts, drifting independently
- The same LLM is asked to do editorial judgment *and* line writing in one call — defaults to safe, generic output

A TTS-side artifact (`,.` punctuation glitches in aired shoutouts) compounds the "not quite human" feel.

## Goals

1. Variety: kill recurring catchphrases; vary sentence shape, length, and form per break
2. Proactivity: opinions, callbacks across the shift, agenda-driven asides (weather, time, station vibe, listener threads)
3. Awareness: when Lena addresses a listener, she knows who, what they said, whether she's said something similar recently, and what's happened in the shift
4. Queue autonomy: Lena can pick the next track, accept listener requests, and decline requests with specific reasons — within taste/quality guardrails
5. Single entry point: all "Lena speaks" paths route through one function with one unified state model

## Non-goals

- TTS swap (Deepgram Aura-2 Helena stays; voice quality is a separate workstream)
- Suno on-demand for listener requests — Suno lives in the separate `numaradio-suno` repo and Marku curates manually; the on-air catalog is fixed-at-runtime
- Mid-track skip — tracks always play to completion
- Long-horizon memory (across days/listeners) — current-shift only for v1
- Quotas on Lena's behavior — when autoChatter is ON, she's fully alive; when OFF, silent

## Architecture

```
                        ┌─────────────────────────────┐
                        │   ShiftMemory (in-daemon)   │
                        │   - event log               │
                        │   - derived views           │
                        │   - callback pool           │
                        └──────┬──────────────────────┘
                               │ (reads + records)
                               ▼
trigger sources ──→  lenaSpeak(trigger)  ──→  Producer  ──→  Writer  ──→  TTS  ──→  queue
  ├ auto_track_boundary             │            │            │
  ├ youtube_chat_mention            │            │            │
  ├ youtube_chat_shoutout           │            │ {mode,     │
  ├ youtube_chat_request (new)      │            │  focus,    │
  └ operator_force                  │            │  tone,     │
                                    │            │  queue_    │
                                    │            │  action}   │
                                    │            ▼
                                    │     QueueDirector
                                    │     (safety bounds,
                                    │      pg_advisory_xact_lock
                                    │      → createQueueItemAtomically)
```

### Module layout

New code lives in `workers/queue-daemon/lena-producer/`. Dashboard callers reach it via HTTP; in-daemon callers call directly.

```
workers/queue-daemon/lena-producer/
├── index.ts                  # lenaSpeak(trigger) public API
├── producer.ts               # Producer LLM call + JSON parse/validate/retry
├── producer-prompt.ts
├── producer-context.ts       # builds ProducerContext from ShiftMemory + live
├── writer.ts                 # dispatcher: routes to per-mode writer
├── writers/
│   ├── opinion.ts
│   ├── callback.ts
│   ├── aside.ts
│   ├── answer.ts
│   ├── shoutout-read.ts
│   ├── queue-pick.ts
│   ├── accept-request.ts
│   ├── accept-request-deferred.ts
│   └── decline-request.ts
├── modes.ts                  # type definitions: ProducerMode, QueueAction
├── shift-memory.ts           # in-memory singleton, derived view computation
├── shift-event.ts            # ShiftEvent union types
├── callback-summarizer.ts    # async event → human-readable description
├── queue-director.ts         # safety bounds + createQueueItemAtomically wrapper
└── reconstruction.ts         # rebuild ShiftMemory from DB on daemon boot
```

## ShiftMemory

In-memory singleton in the queue-daemon. The single source of truth for Producer context.

### Raw event log (rolling cap 50)

```ts
type ShiftEvent =
  | { type: 'track_aired';     id; title; artist; genre; bpm; key; airedAt }
  | { type: 'lena_line_aired'; id; mode; targetFocus; text; airedAt; trigger; addressedListener?: string }
  | { type: 'shoutout_aired';  id; handle; originalText; airedAt }
  | { type: 'youtube_mention'; id; handle; text; intent; airedAt }
  | { type: 'operator_force';  hint; forcedAt }
```

### Derived views (recomputed per Producer call from log)

```ts
interface ShiftMemoryView {
  counters: {
    msSinceLastLine: number
    msSinceLastWeatherMention: number
    msSinceLastTimeCheck: number
    msSinceLastStationDrop: number
    tracksSinceLastShoutout: number
  }
  mood: {
    currentRun: { genre: string|null; count: number; startedAt: number }
    tempoTrend: 'rising' | 'steady' | 'falling'
    avgBpmLast5: number | null
    topGenreThisHour: string | null
  }
  callbackPool: {
    id: string                  // refs source event
    description: string         // pre-summarized
    minsAgo: number
    used: boolean
  }[]
  recentLines: { text; mode; airedAt }[]   // last 10
  recentModes: ProducerMode[]               // last 10
  show: { name; startedAt; minutesIn; minutesUntilNext }
}
```

### Shift boundary semantics

Reset at show-block boundaries (00:00 / 05:00 / 10:00 / 17:00, inherited from existing `workers/queue-daemon/context-line.ts:437` `shiftStart()`), **with a 30-minute overlap window**. After a show transition, Producer continues to see events from the previous show's last 30 min, so callbacks can bridge the boundary ("we just rolled into Prime Hours but earlier when we played…"). The `show` context field updates immediately; only the event-log eviction window is delayed.

### Callback pool curation

A separate `callback-summarizer.ts` runs async on each event ingestion. Writes the human-readable `description` field once per event. Producer never sees raw events in `callbackPool` — only summaries. Marked `used: true` after Producer references it, so the same callback can't be reused. Eviction follows shift-boundary rules.

### Reconstruction on daemon restart

`reconstruction.ts` runs once on daemon boot. Walks existing DB tables with a time-window SELECT:

- `PlayHistory` → `track_aired` events (JOIN to `Track` for artist)
- `Chatter` filtered by `producerVersion >= 1` → `lena_line_aired` events
- `Shoutout` JOINed to `Track` via `Track.provenanceJson.shoutoutRowId` → `shoutout_aired` events
- YouTube mentions: best-effort only — no existing table records every mention. Reconstruction skips this category; first 5-10 min after restart, Producer has weaker context for `@lena` replies. Acceptable degradation.

Until reconstruction completes, Producer uses deterministic defaults (see Cold start below).

### Cross-process event ingestion

Some events originate in the Next.js dashboard process (shoutouts dispatched via `dashboard/lib/shoutout.ts`, YouTube mentions classified server-side). The daemon must learn about them.

**Transport: Postgres LISTEN/NOTIFY on a `lena_event` channel.** Daemon subscribes once at boot. Dashboard's `NOTIFY` payload is the event JSON. Reliable, ordered per-connection, no Vercel cold-start drops. Falls back to a 5-second DB poll if the NOTIFY connection drops.

## Producer

One LLM call (MiniMax-2.7, existing `chatter.ts` client). Strict JSON output.

### Producer prompt (sketch)

```
You are the producer for Lena, a radio DJ on Numa Radio.
Your job: decide HOW she responds right now. You do NOT write her words.

INPUTS:
  trigger: { source, intent, payload }
  now: { localTime, bucket }
  show: { name, minutesIn, minutesUntilNext }
  recentTracksSummary: <pre-built string>
  recentLinesSummary: <pre-built string>
  recentShoutouts: [...]
  callbackPool: [{ id, description, minsAgo }, ...]
  counters: { ... }
  mood: { ... }
  upcomingQueue: {
    next5: [...],
    recentlyAired: [...],   // last 60 min
    showBlock: { current, next, minsUntilTransition },
    recentLenaPicks: [...]
  }
  catalogResolution: { candidates: Track[] | [] }  // populated only for youtube_chat_request

OUTPUT (strict JSON, no prose):
{
  "mode": "opinion" | "callback" | "aside" | "answer" | "shoutout_read"
        | "queue_pick" | "accept_request" | "accept_request_deferred"
        | "decline_request" | "silence",
  "target_focus": "<one short phrase>",
  "callback_to": "<event id from callbackPool, or null>",
  "length_hint": "short" | "medium" | "long",
  "tone": "dry" | "warm" | "playful" | "low-key",
  "address_listener": "<handle, or null>",
  "queue_action": null | {
    "kind": "pick" | "accept_request",
    "track_id": "<catalog ref>",
    "reason": "<short string>"
  },
  "decline_reason": null | "recently_aired" | "not_in_catalog" | "wrong_show_block" | "same_artist_too_soon" | "queue_full"
}

RULES:
- For trigger.source in {youtube_chat_mention, youtube_chat_shoutout, youtube_chat_request, operator_force}:
  mode "silence" is NEVER valid.
- For auto_track_boundary: "silence" is valid and often correct.
- Do not repeat a mode that appears 3+ times in recentLinesSummary.
- "callback" only if a callbackPool entry truly fits this moment.
- length_hint: short=4-12 words, medium=25-45, long=50-80.
- Tone should track mood.
- For youtube_chat_request with no catalog candidates → mode=decline_request, decline_reason=not_in_catalog.
- For youtube_chat_request where candidate.trackId appears in recentlyAired (last 60 min)
  → mode=decline_request, decline_reason=recently_aired.
- For youtube_chat_request accepted but upcomingQueue.next5 has ≥2 priority_request items already
  → mode=accept_request_deferred (not accept_request).
```

### Validation + retry

1. Parse JSON. If fails → retry once with `"Output strict JSON only."` reinforcement.
2. Validate against schema. If `silence` returned for a listener-addressed trigger → reject, retry once.
3. Validate `queue_action.track_id` exists in `catalogResolution.candidates` (Producer can't hallucinate track IDs).
4. On second failure → fall back to safe defaults: `{ mode: 'aside', tone: 'low-key', length_hint: 'short', queue_action: null }` for auto-breaks; `{ mode: 'answer', tone: 'warm', length_hint: 'short' }` for listener-addressed.

## Writer

One LLM call per turn, after Producer. Picks the prompt file by `mode`.

### Common Writer rules (all prompts inherit)

- Spoken English. Contractions. No poetry.
- Banned phrase list: `["let it ride", "we'll let it ride", "we'll take that one", "hope this reaches them"]` (extensible).
- Anti-echo: do not use any 4+ word substring that appears in `recentLines`.
- No show-name unless it serves the line.

### Per-mode shape

Each writer prompt gets only Producer's decision + the minimum context it needs. Example for `opinion`:

```
Mode: opinion. React to a track with taste.
INPUT: target_focus, next_track, tone, length, recently_aired_lines
OUTPUT: one spoken line.
```

The `accept_request_deferred` writer additionally receives `queue_depth_estimate_min` (computed from `upcomingQueue.next5` durations) so the line can be accurate: *"queued you up behind Jane's pick — about six minutes out."*

The `decline_request` writer has a per-reason phrasebook (≥5 variants each for `recently_aired` / `not_in_catalog` / `wrong_show_block` / `same_artist_too_soon` / `queue_full`). No generic "sorry can't do that."

### Writer fallback

Writer call fails → fall back to a per-mode evergreen pool (extend `patterns/lena-quotes/*.json` with `mode` keys, or add `patterns/lena-fallbacks/{mode}.json`).

## QueueDirector

Wraps `workers/queue-daemon/index.ts:382-401` `createQueueItemAtomically`. Enforces guardrails in code, not in the prompt.

### Guardrails (qualitative, not quotas)

| Guardrail | Implementation |
|---|---|
| Same track requested within last 60 min → decline | Check `ShiftMemoryView.events` of type `track_aired` |
| Genre fits current show-block | NEW helper `lib/show-genre-fit.ts` (does not exist today — must build). Maps genre string → compatible show blocks. |
| No back-to-back same artist (unless deliberate "double feature" justified in `queue_action.reason`) | Check `recentLenaPicks` + last `track_aired` event |
| Request not in catalog → decline with `not_in_catalog` | Catalog lookup runs in classifier *before* Producer; empty → Producer routes to `decline_request` |
| autoChatter OFF → no Producer call at all | Existing gate at `AutoHostStateMachine` |

### Queue surface: `priority_request` band, FIFO

Lena's `queue_pick` and `accept_request` inserts go to the end of the existing `priority_request` band via `createQueueItemAtomically` (same code path as listener song-requests and operator pushes). The `pg_advisory_xact_lock` keyed on `stationId + ":priority_request"` is reused. **No new queue band.**

When `upcomingQueue.next5` already contains ≥2 `priority_request` items, Producer is required to choose `accept_request_deferred` (not `accept_request`) so the Writer's line is accurate.

### Failure path: queue_action rejected

If QueueDirector rejects Producer's `queue_action` (e.g., race — track aired between Producer call and insert), the Writer is **re-invoked** with `queue_action: null` and Producer's `mode` downgraded to the closest no-action variant (`accept_request` → `aside` saying "actually scratch that, let's keep going with what's already up"). Spoken line never lies about what's playing.

## Triggers + unified entry

```ts
type TriggerPayload =
  | { source: 'auto_track_boundary',    nextTrack, mood }
  | { source: 'youtube_chat_mention',   handle, text, classifiedIntent: 'reply' }
  | { source: 'youtube_chat_shoutout',  handle, text }
  | { source: 'youtube_chat_request',   handle, text, candidateTracks: Track[] }  // NEW
  | { source: 'operator_force',         hint }

export async function lenaSpeak(trigger: TriggerPayload): Promise<LenaResult | null>
// returns null only when Producer picks mode=silence (auto_track_boundary only)
```

Surfaces:
1. In-process call from `workers/queue-daemon/auto-host.ts`
2. `POST /api/lena/speak` HTTP for Next.js callers (chat handler, dashboard operator-force)

### Classifier change

`lib/classify-shoutout-intent.ts` (existing tri-state: `shoutout | reply | noise`) extends to four states: `shoutout | reply | request | noise`. Classifier output `request` triggers a catalog lookup; resolved candidate tracks are attached to the trigger payload before Producer call. **Classifier extension ships as its own gated step (Phase 2.5 below).**

### YouTube `@lena` mention rule

All triggers from YouTube chat require the literal `@lena` mention (existing `DEFAULT_TRIGGER = /@lena\b/i` at `workers/queue-daemon/youtube-chat-loop.ts:49`). Listeners writing "play X" without the mention will not reach Lena. This is acceptable for v1.

### `operator_force` bypasses Producer

Operator-forced lines bypass Producer entirely — they're direct Writer calls with operator's `hint` as the seed. Producer would just re-derive what the operator already decided.

## Integration points

| File | Change |
|---|---|
| `workers/queue-daemon/auto-host.ts` | Replace inline prompt building (~L407-570) with `await lenaSpeak({source:'auto_track_boundary', ...})`. Pre-existing `runChatter()` timing wraps the call. |
| `workers/queue-daemon/chatter-prompts.ts` | Deprecate. Keep file during migration as fallback when Producer call fails. Delete in Phase 6. |
| `workers/queue-daemon/context-line.ts` | Subsumed by Producer's `aside` mode. Delete in Phase 6. |
| `workers/queue-daemon/index.ts` | `createQueueItemAtomically` reused by QueueDirector — no signature change, but QueueDirector becomes a third writer alongside song-worker and YouTube-chat-shoutout. |
| `workers/queue-daemon/youtube-chat-loop.ts` | No change to trigger regex. Classifier extension is upstream. |
| `lib/lena-reply.ts` | Replace MiniMax prompt with `await lenaSpeak({source:'youtube_chat_mention', ...})`. Classifier pre-filter stays. |
| `lib/classify-shoutout-intent.ts` | Add `request` intent. Add catalog-lookup hand-off (returns candidates to trigger payload). |
| `dashboard/lib/humanize.ts` | Replace rewrite logic with `lenaSpeak({source:'youtube_chat_shoutout', ...})` via HTTP to `/api/lena/speak`. **Scrub "let it ride" / "we'll take that one" examples from the existing prompt at ~L130.** |
| `dashboard/lib/radio-host.ts` | Bug fix: existing regex at L113-119 catches `.,` but not `,.`. Add `.replace(/[,;]\./g, '.')`. Verify `"Numa Radio"` quoting still works. |
| `dashboard/lib/shoutout.ts` | Calls `/api/lena/speak` for shoutout narration. `radioHostTransform()` continues to wrap Writer output. |
| `app/api/lena/speak/route.ts` | NEW. Thin wrapper proxying to daemon's `lenaSpeak()`. |
| `app/api/lena/event/route.ts` | NEW. Receives ShiftMemory events from Next.js side; daemon either subscribes via NOTIFY (preferred) or polls this endpoint. |
| `app/api/station/lena-line/route.ts` | No change in Phase 2-5. Phase 6 cleanup may simplify the 3-tier logic since context-lines go away. |
| `prisma/schema.prisma` | NEW migration: `Chatter.producerVersion Int?` (null for legacy rows, ≥1 for Producer-era). Optionally `Chatter.producerMode String?` for richer reconstruction. |
| `patterns/lena-quotes/*.json` | Retained as Writer fallback pool. |

### New code surface (summary)

- `workers/queue-daemon/lena-producer/` (the new module — file list above)
- `lib/show-genre-fit.ts` — genre → compatible show-block helper
- `app/api/lena/speak/route.ts`
- `app/api/lena/event/route.ts`
- Postgres `lena_event` NOTIFY channel + subscriber in daemon

## Latency budget

Generation budget = current track duration − `PUSH_OFFSET_BEFORE_END_SECONDS` (15s) − queue-pipeline overhead.

Today's worst-case (single MiniMax + retry + Deepgram + B2 upload): ~30s. Producer adds a second MiniMax call (~3-8s typical, 16s if retried once).

**Target p95: Producer + Writer ≤ 12s combined.**

**Fallback:** if Producer takes > 20s wall-clock, the auto-host orchestrator demotes to the existing single-call path (Phase 6 cleanup is deferred until this fallback rarely fires). Listener-addressed triggers do not demote — they wait for the Producer/Writer chain because correctness matters more than latency.

## Cold start

On daemon boot, ShiftMemory is empty until `reconstruction.ts` completes (~1-3s, single SELECT pass). Until then:

- `auto_track_boundary` triggers skip the LLM call entirely and use deterministic defaults: `mode=aside`, `tone=low-key`, `length=short`, drawn from a static seed pool
- Listener-addressed triggers wait up to 5s for reconstruction, then proceed with whatever memory is loaded

## Phased rollout

| Phase | Ships | Behind flag | Risk |
|---|---|---|---|
| **1** | ShiftMemory + event recording + NOTIFY channel + `producerVersion` migration. No behavior change. | `LENA_SHIFT_MEMORY=on` (read-only) | None |
| **2** | Producer + Writer for `auto_track_boundary` only | `LENA_PRODUCER_AUTO=on` | Per-flow flag; auto-break only |
| **2.5** | Classifier extension (`request` intent + catalog lookup) | `LENA_CLASSIFIER_REQUEST=on` | Unused until Phase 3+5 turn on |
| **3** | Route `youtube_chat_mention` (reply intent) through Producer | `LENA_PRODUCER_REPLY=on` | Per-flow |
| **4** | Route shoutout narration through Producer; scrub humanize.ts examples; fix radio-host.ts regex | `LENA_PRODUCER_SHOUTOUT=on` | Per-flow |
| **5** | QueueDirector enabled: `accept_request` / `accept_request_deferred` / `decline_request` / `queue_pick` modes | `LENA_QUEUE_AUTONOMY=on` | Per-flow; can be flipped off independently |
| **6** | Delete deprecated paths (`chatter-prompts.ts`, `context-line.ts`, old `lena-reply.ts` prompt, old `humanize.ts` rewrite) | none — cleanup | Low |

All flags read at runtime from a single config table; operator can flip without redeploy.

## Error handling

| Failure | Handling |
|---|---|
| Producer returns invalid JSON | Retry once with reinforcement; on second fail → safe defaults |
| Producer returns `silence` for listener-addressed trigger | Reject, retry once; on second fail → force `mode=answer` with safe defaults |
| Producer hallucinates `queue_action.track_id` not in candidates | Strip `queue_action`, proceed with words only |
| Writer call fails | Per-mode evergreen fallback from `patterns/lena-fallbacks/{mode}.json` |
| TTS fails | Existing Helena → Asteria fallback unchanged |
| QueueDirector rejects `queue_action` (race, guardrail) | Re-invoke Writer with `queue_action: null` and downgraded mode; spoken line never lies about queue state |
| ShiftMemory event lost via NOTIFY drop | 5s DB-poll fallback reads any events newer than last-known-id |
| Daemon restart mid-shift | Reconstruction from DB; degraded YouTube-mention awareness for ~10 min |
| `lena_event` NOTIFY connection dies | Auto-reconnect with exponential backoff; poll fallback active during gap |

## Testing

- **Unit** — `ShiftMemory.record()` ingestion + derived view computation (each counter, mood, callbackPool curation)
- **Unit** — `QueueDirector` guardrails (one test per guardrail, including race-condition simulation)
- **Unit** — Producer JSON schema validation + retry behavior
- **Unit** — `lib/show-genre-fit.ts` mapping correctness
- **Unit** — `radio-host.ts` `,.` fix without regressing `"Numa Radio"` quoting
- **Golden** — Producer JSON shape from fixture ProducerContexts (assert shape only, not exact `target_focus` text)
- **Integration** — end-to-end `@lena play X` flow with fake LLM, real catalog, real `priority_request` band insert
- **Integration** — concurrent `@lena play X` from two listeners → first gets `accept_request`, second gets `accept_request_deferred`
- **Integration** — show-boundary crossover at 17:00 → callback pool from 16:30-17:00 still visible until 17:30
- **Integration** — daemon restart mid-shift → reconstruction completes; counters/callbacks present
- **Live A/B** — flag-flip one trigger at a time; 24h aired-line variety metric: phrase-shingle uniqueness, "let it ride" frequency, opener-template diversity

## Open decisions (parked for follow-up)

These are explicitly **not** in scope but worth recording so future work doesn't re-debate them:

- TTS upgrade (Sesame CSM, Hume EVI 3, ElevenLabs v3) — separate workstream; Lena's words can be made human within current TTS first
- Long-horizon memory (cross-shift, per-listener identity threads) — current-shift only for v1
- Lena triggers Suno generation for missing catalog tracks — never; Suno stays in `numaradio-suno` and Marku curates manually
- Listener requests without `@lena` mention (free-form "play X" pattern) — v1 requires the mention
- Persistent listener identity (recognizing returning handles across shifts/days) — v1 doesn't remember listeners beyond current shift

## Related docs

- `2026-04-22-lena-auto-chatter-design.md` — auto-chatter origin design
- `2026-04-26-lena-context-lines-design.md` — context-line generator (subsumed)
- `2026-04-26-lena-world-aside-design.md` — world-aside generator (subsumed)
- `2026-04-23-submit-feedback-lena-human-design.md` — prior "make Lena human" attempt (prompt-only)
- `2026-04-24-song-request-demo-day-in-numa-design.md` — earlier song-request thinking
