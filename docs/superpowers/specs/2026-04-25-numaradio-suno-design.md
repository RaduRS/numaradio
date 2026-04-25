# numaradio-suno — Suno-driven library generator

**Date:** 2026-04-25
**Status:** Approved design — ready for implementation plan
**Author:** Brainstormed with Claude

---

## Goal

Build a local-only operator app at `~/saas/numaradio-suno` that uses
Suno's private API to generate radio-quality music for the four Numa
Radio shows, presents an approve/reject queue, and writes approved
tracks straight into the main Postgres library. The library gains a
`show` enum so the rotation can later air "morning music between
05–10 only", and the existing seed pipeline gains the same tagging.

This is the supply side of the station: keeps each show's library at
target capacity (Night Shift 5h, Morning Room 5h, Daylight Channel 7h,
Prime Hours 7h) without manual seed drops.

---

## Hard rules

- **Single source of truth for ingest.** Both the seed CLI and the
  new Suno app go through one `lib/ingest.ts` function. No duplicated
  B2-upload + DB-write logic.
- **Show is non-optional for new tracks.** Seed fails loud on a
  missing hashtag/sidecar; song-worker tags by current-hour show;
  Suno app passes `show` through `ingestTrack()` directly.
- **Rate limits are conservative.** Suno is a moving target; a
  blocked account costs more than a slow queue.
- **Provider abstraction for the lyrics writer.** Swapping Claude for
  MiniMax (or anything else) is one env-var change, never a code edit.
- **Local-only.** numaradio-suno never deploys. Cookies and SQLite
  stay on the operator's machine.
- **Frontend implementation goes through the `frontend-design`
  skill** — same standard as every other Numa UI.

---

## Architecture overview

Two repos. One new sibling.

### `numaradio` — main repo changes

- **Schema migration**: nullable `show ShowBlock` enum on `Track`,
  composite index `(stationId, show, trackStatus, airingPolicy)`,
  heuristic backfill for every existing row.
- **`lib/ingest.ts` (new)**: extracted from `scripts/ingest-seed.ts`.
  One `ingestTrack(input)` function — pure logic, no fs reads.
- **`lib/show-mapping.ts` (new)**: `inferShowFromMetadata({ bpm,
  genre, mood })`. Same heuristic the migration uses, exported so
  the dashboard editor can suggest a show when re-tagging.
- **`scripts/ingest-seed.ts`**: thin wrapper. Parses ID3 hashtag
  (`#NightShift` / `#MorningRoom` / `#DaylightChannel` /
  `#PrimeHours`); falls back to `<file>.show` sidecar; **fails loud**
  if neither is present.
- **`workers/song-worker/*`**: at Track creation, set
  `show: showForHour(now.getHours()).name`.
- **`dashboard/app/library/*`**: per-row Show dropdown editor backed
  by a new `PATCH /api/library/track/[id]` route. Bulk re-tag is
  v1.1.

### `~/saas/numaradio-suno` — new sibling Next.js app

- Local-only on `localhost:3100`. Never deployed.
- Imports Prisma client + `lib/ingest.ts` from the sibling
  `numaradio` directory via `tsconfig` path alias `@numa/* →
  ../numaradio/*`. Same Postgres URL in `.env.local`. No published
  packages.
- Single page UI: capacity dashboard + in-flight queue + pending
  review.
- Local SQLite (`./data/jobs.db`) for operator-only job state. Avoids
  polluting main Postgres.

### Integration shape

```
~/saas/
  numaradio/                 (existing — main app + dashboard + workers)
    lib/ingest.ts            (NEW — shared)
    lib/show-mapping.ts      (NEW)
    prisma/schema.prisma     (Track gains `show`)
    scripts/ingest-seed.ts   (refactored thin wrapper)
    workers/song-worker/...  (one-line show tagging)
    dashboard/app/library/.. (Show dropdown editor)

  numaradio-suno/            (NEW sibling — operator-only)
    package.json             (own deps; @prisma/client comes from @numa/*)
    tsconfig.json            (path alias @numa/* → ../numaradio/*)
    app/                     (Next.js App Router UI + API routes)
    lib/                     (lyrics-writer, suno client, jobs repo, ...)
    patterns/                (diamond-standard.md + 4 show files)
    data/                    (gitignored — SQLite)
    pending/                 (gitignored — MP3 holding pen)
    .cookies.json            (gitignored — Suno session)
```

---

## Show-tagging schema

```prisma
enum ShowBlock {
  night_shift
  morning_room
  daylight_channel
  prime_hours
}

model Track {
  // ... existing fields
  show ShowBlock?

  @@index([stationId, show, trackStatus, airingPolicy])
}
```

`show` is nullable at the DB level so the migration is
non-destructive. Application code (seed CLI, song-worker, Suno app)
treats it as required at write time. The dashboard editor lets the
operator fix mis-tagged rows.

### Heuristic backfill

Runs as raw SQL inside the same migration that adds the column.
Every existing row gets a value — wrong tags are corrected later in
the dashboard, but nothing stays NULL.

```
bpm < 95  AND mood IN ('Calm','Dreamy','Mellow','Dark')      → 'night_shift'
bpm 95–115 AND mood IN ('Bright','Summer','Uplifting','Romantic')
                                                              → 'morning_room'
bpm 105–125 AND genre IN ('NuDisco','Disco','Funk','House','Lofi')
                                                              → 'daylight_channel'
bpm > 115 AND mood IN ('Energetic','Hype','Groovy')          → 'prime_hours'
ELSE genre-only fallback table
ELSE 'daylight_channel' (largest, most generic block)
```

`lib/show-mapping.ts` exports the same logic in TypeScript so the
dashboard editor can offer the same suggestion when re-tagging.

---

## Ingest contract

```ts
// lib/ingest.ts
export type IngestInput = {
  stationId: string;
  audioBuffer: Buffer;
  show: ShowBlock;          // required
  title: string;
  artistDisplay?: string;
  lyrics?: string;
  caption?: string;         // → promptSummary
  styleTags?: string[];     // → provenance + genre/mood promotion
  styleSummary?: string;    // → provenance.styleSummary
  gender?: 'male' | 'female' | 'duo' | 'instrumental';
  weirdness?: number;
  styleInfluence?: number;
  model?: 'v5' | 'v5.5';
  sunoId?: string;          // for dedupe
  bpm?: number;
  musicalKey?: string;
  durationSeconds?: number;
  artwork?: { buffer: Buffer; mimeType: string };
  rawComment?: string;      // for provenanceJson
};

export type IngestResult =
  | { status: 'ingested'; trackId: string }
  | { status: 'skipped'; trackId: string; reason: 'duplicate_suno_id' };

export async function ingestTrack(input: IngestInput): Promise<IngestResult>;
```

Behavior:
- Idempotency check on `sourceReference = sunoId` first; returns
  `skipped` if already present.
- B2 upload audio → if successful, B2 upload artwork (if provided).
- Single Prisma transaction creates Track + TrackAsset(s) + marks
  ready.
- On Prisma failure, deletes the orphan B2 objects before throwing.
- No filesystem reads, no ID3 parsing — pure logic.

The seed CLI keeps doing fs reads + ID3 parsing + Suno page scraping,
then calls `ingestTrack`. The Suno app skips fs entirely (the buffer
came from the CDN download) and passes typed metadata directly.

---

## Suno app — file layout

```
~/saas/numaradio-suno/
├── package.json
├── tsconfig.json
├── next.config.ts                     (transpilePackages: ['@numa/lib'],
│                                       resolve.symlinks: false)
├── instrumentation.ts                 (boots the Suno poller)
├── .env.local                         (DATABASE_URL, LYRICS_WRITER_*,
│                                       SUNO_MAX_INFLIGHT,
│                                       SUNO_MAX_STARTS_PER_MIN,
│                                       SUNO_MAX_PER_DAY)
├── .gitignore                         (.cookies.json, data/, pending/)
│
├── app/
│   ├── layout.tsx
│   ├── page.tsx                       (single-page capacity dashboard)
│   ├── components/
│   │   ├── header-bar.tsx             (cookies status + daily budget meter)
│   │   ├── capacity-bar.tsx
│   │   ├── show-card.tsx
│   │   ├── generate-modal.tsx
│   │   ├── draft-review.tsx
│   │   ├── inflight-queue.tsx
│   │   ├── pending-review-list.tsx
│   │   ├── pending-review-card.tsx
│   │   ├── audio-player.tsx
│   │   ├── cookie-paste-modal.tsx
│   │   └── rate-limit-banner.tsx
│   └── api/
│       ├── draft/route.ts
│       ├── generate/route.ts
│       ├── jobs/route.ts              (SSE stream)
│       ├── approve/[jobId]/route.ts
│       ├── reject/[jobId]/route.ts
│       ├── pending/[jobId]/route.ts   (streams local MP3 to <audio>)
│       ├── capacity/route.ts
│       ├── cookies/route.ts
│       └── budget/route.ts
│
├── lib/
│   ├── prisma.ts                      (re-exports @numa/lib/db prisma)
│   ├── capacity.ts
│   ├── lyrics-writer/
│   │   ├── index.ts                   (interface + composeSystemPrompt)
│   │   ├── claude.ts                  (Anthropic SDK, with prompt caching)
│   │   └── minimax.ts
│   ├── suno/
│   │   ├── client.ts                  (forge HTTP against studio-api.suno.com)
│   │   ├── cookies.ts                 (load/save .cookies.json + JWT refresh)
│   │   ├── rate-limit.ts              (concurrency, burst, daily — pure)
│   │   ├── poller.ts                  (background loop)
│   │   └── download.ts                (CDN URL → ./pending/<jobId>.mp3)
│   └── jobs/
│       ├── db.ts                      (better-sqlite3, ./data/jobs.db)
│       ├── repo.ts                    (typed CRUD, state-machine guard)
│       └── stream.ts                  (SSE broadcaster)
│
├── patterns/
│   ├── diamond-standard.md            (the formula — verbatim)
│   ├── night-shift.md
│   ├── morning-room.md
│   ├── daylight-channel.md
│   └── prime-hours.md
│
├── scripts/
│   ├── seed-jobs-db.ts
│   ├── validate-cookies.ts
│   └── preview-draft.ts               (CLI smoke test, ~4 LLM calls)
│
├── data/                              (gitignored)
└── pending/                           (gitignored)
```

### Per-show pattern files

Each `patterns/<show>.md` only specializes the global Diamond
Standard. Defaults below; operator tunes during pattern review.

| Show | BPM | Vocal character | Genre tags | Intro ad-lib | Theme starters |
|---|---|---|---|---|---|
| Night Shift | 70–95 | Breathy, hypnotic, intimate | ambient, downtempo, lofi, dark RnB | `(Ooh...)` | confessional/intimate |
| Morning Room | 95–115 | Warm, honest, conversational | indie pop, folk, soft house, field-recording-flavoured | `(Hmm...)` | hopeful, observational |
| Daylight Channel | 105–125 | Polished, composed | deep house, nu-disco, groove pop, focus electronic | `(Mmm... yeah...)` | longer-form cohesive grooves (3:30–4:00) |
| Prime Hours | 115–130 | Full-chested controlled | dance pop, tropical house, funky house, euphoric | `(Hey... uh...)` | characterful late-night |

Diamond Standard's 10 hard rules + slider defaults (15–20%) + style
formula + song-structure skeleton + writing rules + caption formula
live in `patterns/diamond-standard.md` verbatim from the brief.

### Lyrics-writer interface

```ts
// lib/lyrics-writer/index.ts
export type DraftInput = {
  show: ShowBlock;
  concept?: string;        // optional one-liner from operator;
                           // when blank, LLM drafts purely from the show pattern
};

export type Validation = {
  field: keyof DraftedSong;
  severity: 'warning';     // soft; never blocks submit
  message: string;         // e.g. "style: 1142 chars (max 1000)"
};

export type DraftedSong = {
  title: string;
  lyrics: string;
  styleTags: string;       // the comma-tag style prompt
  weirdness: number;
  styleInfluence: number;
  model: 'v5' | 'v5.5';
  gender: 'male' | 'female' | 'duo' | 'instrumental';
  caption: string;
  coverPrompt: string;
  validations: Validation[];  // soft warnings (e.g. style >1000 chars)
};

export async function draftSong(input: DraftInput): Promise<DraftedSong>;
```

Index module composes the system prompt from `diamond-standard.md` +
`patterns/<show>.md` + concept; adapters never see the user's input
directly. Adapters get a `{ system, user }` pair — that's the
swappable surface.

`LYRICS_WRITER_PROVIDER=claude|minimax` picks the adapter at startup.
Per-provider env vars (`LYRICS_WRITER_CLAUDE_API_KEY`,
`LYRICS_WRITER_CLAUDE_MODEL`, `LYRICS_WRITER_MINIMAX_API_KEY`,
`LYRICS_WRITER_MINIMAX_MODEL`) keep secrets isolated.

Default: Claude Sonnet 4.6 (cheaper than Opus, format-faithful enough
for the Diamond Standard).

### Suno client

`lib/suno/client.ts` only knows how to forge HTTP requests against
`studio-api.suno.com` and parse responses. It reads cookies via the
cookie module, doesn't manage rate limits or jobs. Pure adapter.

Recorded request/response fixtures in
`numaradio-suno/fixtures/suno-generate-v2.json` so the unit test
catches *us* breaking. Suno breaking *us* surfaces as 4xx in the
UI banner.

### Rate-limit gates (pure logic)

`lib/suno/rate-limit.ts`:
```ts
checkAllowed(jobsState: JobsState, clock: Clock): RateLimitDecision
```
- `SUNO_MAX_INFLIGHT=3` — total in-flight cap.
- `SUNO_MAX_STARTS_PER_MIN=2` — rolling 60s burst guard.
- `SUNO_MAX_PER_DAY=30` — counted by submit attempts (not successes),
  resets at 02:00 Europe/London.
- On 429/403 from Suno: halt queue, set `rate_limit_halted_until =
  now + 10min`, surface red banner with manual `[Resume now]`.

Header surfaces **`today: 12 / 30 · resets 02:14`** with bar in
amber at 80%, red at 95%. Generate stays clickable at 100% (operator
discretion) but the API rejects with a 429-like response.

### Job state machine (SQLite)

```
drafting       (LLM call in progress)
   │
   ▼
drafted        (modal showing draft to operator)
   │
   ▼
sending        (POSTing to Suno)
   │
   ▼
queued         (rate-limited; waits for slot)
   │
   ▼
inflight       (Suno generating; we poll every 30s)
   │
   ▼
downloading    (Suno marked complete; pulling MP3)
   │
   ▼
pending_review (MP3 on disk; <audio> in UI)
   │
   ├──► approving ──► approved   (ingestTrack succeeded; MP3 deleted)
   │
   ├──► rejected                  (MP3 deleted; row kept for history)
   │
   ├──► failed                    (Suno or LLM error; reason stored)
   │
   └──► download_failed           (CDN unreachable after 3 retries)
```

`lib/jobs/repo.ts` enforces legal transitions; illegal ones throw.
On boot, `instrumentation.ts` reverts any stuck `approving > 60s` to
`pending_review` (process restart recovery).

---

## Data flow — generate-and-approve happy path

```
[User] clicks "Generate for Morning Room"
   │
   ▼
[Modal] concept input (optional) + pre-filled show pattern preview
   │     If concept blank, LLM drafts purely from the show pattern.
   │
   ▼ POST /api/draft
   Job row INSERT (status='drafting')
[lyrics-writer] composes diamond-standard.md + morning-room.md + concept
   │     └── via swappable provider (default Claude Sonnet 4.6)
   ▼
   returns DraftedSong with soft validations
   UPDATE Job SET status='drafted', draftJson=...
   │
   ▼
[Modal] shows draft, "Edit" toggle, "Send to Suno" button
   │
   ▼ POST /api/generate
   UPDATE Job SET status='sending'
   rate-limit gate check:
     allowed       → continue
     concurrency   → UPDATE Job SET status='queued'  (poller promotes later)
     burst         → UPDATE Job SET status='queued'
     daily ceiling → 429 to client, Job stays 'drafted'
[Suno client] forge POST to studio-api.suno.com/api/generate/v2
   │   └── on 429/403: halt queue, surface red banner
   ▼
   UPDATE Job SET status='inflight', sunoTaskId=...
   │
   ▼  (every 30s)
[Poller] GET studio-api.suno.com/api/feed/<sunoTaskId>
   │   when status='complete':
   │     download MP3 + cover from CDN URL
   │     save to ./pending/<jobId>.mp3
   │     UPDATE Job SET status='pending_review', mp3Path=...
   ▼
[UI] new card appears in "Pending review"
[User] plays MP3 in browser <audio src="/api/pending/<jobId>">
   │
   ├──► [Approve] POST /api/approve/<jobId>
   │      → import { ingestTrack } from '@numa/lib/ingest'
   │      → ingestTrack({ buffer: readFile(mp3Path), show, ...draftJson })
   │      → Track + TrackAsset rows in main Postgres
   │      → delete pending MP3
   │      → UPDATE Job SET status='approved'
   │
   └──► [Reject] POST /api/reject/<jobId>
          → delete pending MP3
          → UPDATE Job SET status='rejected'
```

User-generated songs (listener booth) get tagged at song-worker
Track creation:
```ts
show: showForHour(new Date().getHours()).name
```
One line. Matches the "play this now" UX.

Capacity readout (every 30s on the dashboard):
```sql
SELECT show, SUM(durationSeconds) AS aired_seconds, COUNT(*) AS tracks
FROM "Track"
WHERE stationId = <numa> AND trackStatus = 'ready' AND airingPolicy = 'library'
GROUP BY show;
```
Compared to target (Night 5h, Morning 5h, Daylight 7h, Prime 7h).
`deficitTracks = ceil(deficitSeconds / avgTrackDurationForShow)`.

---

## UI layout (single page)

```
NUMA STUDIO        cookies: ✓ valid · 14d left   today: 12 / 30  · resets 02:14
                                                  ████████░░░░░░░░░░░░░░░

┌──────────────────────────────────────────────────────────────────────┐
│  NIGHT SHIFT  ·  00 – 05  ·  target 5h                                │
│  ████████░░░░░░░░░░░░░░░  3h 12m / 5h   (need ~32m more · 9 tracks)   │
│  [ Generate for Night Shift ]                                         │
├──────────────────────────────────────────────────────────────────────┤
│  MORNING ROOM  ·  05 – 10  ·  target 5h                               │
│  █████████████████░░░░░  4h 48m / 5h   (need ~12m more · 3 tracks)    │
│  [ Generate for Morning Room ]                                        │
├──────────────────────────────────────────────────────────────────────┤
│  DAYLIGHT CHANNEL  ·  10 – 17  ·  target 7h                           │
│  ███████████████████████  7h 22m / 7h   ✓ full                        │
│  [ Generate for Daylight Channel ]                                    │
├──────────────────────────────────────────────────────────────────────┤
│  PRIME HOURS  ·  17 – 24  ·  target 7h                                │
│  ██████████████░░░░░░░░  4h 04m / 7h   (need ~3h · 50 tracks)         │
│  [ Generate for Prime Hours ]                                         │
└──────────────────────────────────────────────────────────────────────┘

In flight (2 of 3 slots used)
  • Morning Room — "the steam off the cup" — generating · 02:14 elapsed
  • Prime Hours  — "a phone in the dark"   — downloading

Pending review (3)
  • Night Shift  — "rooftop nicotine"   ▶ 3:14    [Approve] [Reject]
  • Prime Hours  — "neon nope"          ▶ 2:58    [Approve] [Reject]
  • Daylight Ch. — "library mornings"   ▶ 3:31    [Approve] [Reject]
```

Generate button is **always clickable**, even at >100% capacity
(softer color when full). Capacity bar is informational only.

Implementation goes through the `frontend-design` skill.

---

## Error handling matrix

### Suno auth & cookies
| Failure | Behavior | User signal |
|---|---|---|
| Cookies missing on startup | API 412; poller idle | Header `cookies: ✗ missing`; modal opens. Generate disabled. |
| Cookie expired (401) | Halt queue; jobs preserved | Red banner; `cookies: ✗ expired` |
| Clerk JWT 1h expiry mid-job | Auto-refresh via tokens endpoint | Silent on success; same banner on failure |
| Cookie file corrupt | Treat as missing | Same as missing |

### Rate limits
| Failure | Behavior | User signal |
|---|---|---|
| Concurrency cap | Job → `queued` until slot frees | "queue: 2 generating · 3 queued" |
| Burst cap | Hold at `queued` until rolling window opens | Same |
| Daily ceiling | API rejects new submits | Generate tooltip: `daily cap reached — resets at 02:14` |
| Suno 429 | Halt; downloads continue; auto-resume +10min | Red banner + `[Resume now]` |

### Generation failures
| Failure | Behavior | User signal |
|---|---|---|
| Suno task `failed` | Job → `failed`; no retry | Red card, `[Dismiss]` |
| MP3 download timeout/5xx | Retry 3× (30s/60s/120s); then `download_failed` | `download failed — retry / dismiss` |
| MP3 implausibly small (<200 KB) | `download_failed` | Same |
| LLM malformed JSON | Retry once; on 2nd failure, surface to modal | Modal: `lyrics-writer error: <msg>` |
| LLM violates Diamond Standard hard rules | Soft validation; flag in modal, don't block | Inline yellow markers |

### Approve / reject
| Failure | Behavior | User signal |
|---|---|---|
| B2 upload fails mid-approve | Roll back; MP3 stays in `./pending/`; Job stays `pending_review` | Toast: retry |
| Prisma write fails after B2 | Delete orphan B2 object before throw (existing seed pattern) | Toast: retry |
| Approve clicked twice | State machine blocks: `pending_review → approving → approved` | Button disabled in flight |
| MP3 manually deleted | Approve fails `mp3_missing` | Card: `mp3 missing — dismiss only` |
| Reject with file gone | Idempotent; mark rejected | Card vanishes |
| `ingestTrack` returns `skipped` (dedupe) | Mark Job approved; delete pending | Toast: `already in library — pending file cleared` |

### Crash / restart recovery
| Scenario | Behavior |
|---|---|
| `inflight` jobs on boot | Poller resumes; Suno keeps generating regardless |
| `pending_review` MP3s on boot | Show on next page load — pure DB state |
| Mid-download crash | Job stays `inflight`; poller retries |
| Mid-approve crash | `approving > 60s` → revert to `pending_review`; retry is idempotent on suno-id |

### Heuristic-backfill edge cases
| Track condition | Tag |
|---|---|
| All metadata null | `daylight_channel` (catch-all) |
| BPM null + genre matches | Use genre rule |
| Slow track with "ambient" mood at 110 BPM | Mood/genre rule wins (→ `night_shift`) |
| Existing user-generated request track | Same heuristic |

### Cross-repo Prisma client
| Concern | Approach |
|---|---|
| Two `@prisma/client` instances drifting | Suno app does **not** install `@prisma/client`; re-exports from `@numa/lib/db` |
| Schema regen propagation | `npx prisma generate` in numaradio; Suno picks up types via path alias |
| Runtime resolution | `next.config.ts`: `transpilePackages: ['@numa/lib']`, `resolve.symlinks: false` |

---

## Testing strategy

| Unit | Test type | Coverage |
|---|---|---|
| `lib/show-mapping.ts` (numaradio) | Unit | Every BPM × genre × mood combo; null fallback; boundaries |
| `lib/ingest.ts` (numaradio) | Unit + mocked B2/Prisma | Happy path; dedupe-skipped; missing-show throws; B2 failure rolls back DB; tx failure deletes orphan B2 |
| `scripts/ingest-seed.ts` | Unit | All 4 hashtags; sidecar fallback; loud-fail; existing parsing untouched |
| `lib/lyrics-writer/index.ts` | Unit | System-prompt composition; soft-validation; adapter routing |
| `lib/lyrics-writer/{claude,minimax}.ts` | Unit + mocked SDK | Request shape; one-retry-then-fail |
| `lib/suno/rate-limit.ts` | Unit | Concurrency, burst, daily, midnight rollover, 429 halt |
| `lib/suno/cookies.ts` | Unit | Round-trip; corrupt file; expiry check |
| `lib/suno/client.ts` | Unit + mocked fetch | Recorded fixture; 401/429/5xx classification |
| `lib/suno/poller.ts` | Integration + real SQLite | State transitions; download retry; restart recovery |
| `lib/jobs/repo.ts` | Unit + in-memory SQLite | All transitions; illegal transitions throw |
| `app/api/approve/[jobId]` | Integration | ingestTrack call; MP3 delete; idempotent approve; stuck-`approving` recovery |
| `dashboard/app/library` editor | Manual smoke | Re-tag a track; rotation respects new tag next refresh |

Smoke script `scripts/preview-draft.ts` mirrors numaradio's
`preview-chatter.ts` — burns ~4 LLM calls, prints draft samples.
Not in CI.

No automated test for Suno's private API itself — moving target.
Fixture catches *us* breaking; Suno breaking us surfaces as 4xx in
the UI banner.

---

## Scope

### Ships in this plan (v1)

- Schema migration + heuristic backfill
- `lib/ingest.ts` extraction; seed CLI refactor; show-hashtag parsing
- `numa-song-worker` show tagging
- Dashboard `/library` per-row show editor + PATCH route
- New `numaradio-suno` app: capacity dashboard, generate modal,
  draft review, in-flight queue, pending review with audio +
  approve/reject
- Lyrics-writer abstraction + Claude adapter + MiniMax adapter
- Suno private-API forge + cookie management + rate limits + poller
- Daily budget meter + cookie status in header
- Local SQLite for jobs

### Deferred to v1.1

- Bulk re-tag in dashboard (`/library` shift-click multi-select +
  apply-show)
- **Per-show airing rule in `refresh-rotation.ts`** — filter library
  by current-hour show, with safety fallback to a no-show pool. This
  is the *payoff* of the show field; should ship within a session of
  v1 or the column is unused. Separable change with its own design
  questions (cross-show fade rules at boundary, empty-show fallback)
  so it gets its own spec.
- Re-generate from rejected job (concept + sliders preserved)
- Cover-image regen (separate Flux call if Suno-baked cover ever
  falls short)
- Telegram NanoClaw push when daily budget at 80%
- Auto-trim — when a show goes >150% of capacity, suggest
  oldest/lowest-rotation tracks for archive

---

## Open questions for the implementation plan

- **Pattern file content** — operator should provide an exemplar
  song per show (similar to "Same Mistake") so the per-show pattern
  files start with a real reference. Could be done during
  implementation or before.
- **Cookie-extraction recipe** — document exactly which cookies
  Suno's web client sends, where to grab them in DevTools, and the
  Clerk JWT refresh endpoint shape. To be captured during the Suno
  client implementation.
- **Default Claude model** — Sonnet 4.6 is the v1 starting point;
  if format adherence proves shaky, bump to Opus 4.7 (the 1M-context
  variant the user is on now).
