# Listener song generation — Phase A

**Date:** 2026-04-21
**Status:** Approved, ready for implementation plan
**Scope:** Public listener can submit a prompt + artist name, get a fully
generated song (music + artwork), hear it aired on the stream within
~3-4 min, and the song enters the permanent library.

Phases B (shareable pages, user accounts, email notifications) and C
(dashboard curation UI, post-airing moderation) are explicitly deferred.

## Problem

The product is a music-creation website with a live radio front.
Listeners should be able to describe a song in plain English, get it
made, and hear it on the air. Today the station only plays operator-
curated library tracks and operator/listener shoutouts. The music-
generation pipeline the station was built around has not been wired
up yet.

## Constraints

- **Generation cap: 20 songs / hour site-wide.** The MiniMax
  music subscription allows 100 songs per 5-hour window. One job at a
  time, processed serially, bounds spend and matches airing rate
  (one ~3 min song ≈ one 3 min track slot).
- **Per-IP limit: 1 / hour, 3 / day** against an ip-hash column.
  Tight enough to stop one listener eating the whole subscription,
  generous enough that a motivated listener can drop three in a day.
- **Async UX (3-4 min wait).** Submit returns immediately with a
  request id; the browser polls for status.
- **All generated songs belong to the station.** Listener types an
  artist name which is shown as the credit, but the station owns the
  audio. Policy note will be added to the site's legal/about copy.
- **Generation is public, so moderation is load-bearing.** Listener
  prompts run through the same `moderateShoutout()` pipeline that
  booth shoutouts already use (profanity prefilter + MiniMax moderator).
- **The operator dashboard is not in this phase.** No operator curation
  UI, no "reject this generated song" path. Moderation is at the
  prompt level only.

## Architecture

```
Listener                   Vercel (app/api/booth/song*)        Neon
   │                             │
   │ 1 POST /api/booth/song      │
   │ ──────────────────────────▶ │
   │    {prompt, artistName}     │ rate-limit (ip_hash, last 1h & 24h)
   │                             │ moderate prompt (profanity prefilter + MiniMax)
   │                             │ sanitize artistName (prefilter only)
   │                             │ INSERT SongRequest (status=queued)   ─▶ SongRequest row
   │ ◀─────────────────────────  │
   │   {requestId, queuePos,     │
   │    estWaitSec}              │
   │                             │
   │ 2 GET  /api/booth/song/:id  │ SELECT SongRequest, compute live queuePos
   │    /status (poll every 5s)  │
   │ ◀─────────────────────────  │
   │   {status, queuePos?,       │
   │    trackId?, title?,        │
   │    artworkUrl?, error?}     │
   │                             │

                      numa-song-worker.service (Orion, separate Node process)
                        │
                        │ loop (every 3 s):
                        │   claim next queued row (UPDATE ... RETURNING)
                        │
                        │ Step 1: LLM derives title + artwork prompt (MiniMax M2.7, ~3 s)
                        │ Step 2 (parallel):
                        │    a) POST MiniMax music_generation → task_id
                        │       poll every 10 s until status=done (~2-3 min)
                        │    b) POST OpenRouter flux.2-pro for artwork
                        │       (~30-60 s, shorter than music)
                        │ Step 3: download audio from MiniMax
                        │         upload audio + artwork to B2 at
                        │         stations/numaradio/tracks/{trackId}/...
                        │ Step 4: INSERT Track + TrackAsset rows
                        │         (sourceType=internal_generated,
                        │          airingPolicy=library, safetyStatus=approved,
                        │          trackStatus=ready)
                        │ Step 5: POST localhost:4000/push → queue-daemon
                        │         → Liquidsoap priority queue → Lena airs it next
                        │ Step 6: UPDATE SongRequest (status=done, trackId, completedAt)
                        │
                        │ Crash recovery: on startup + every 5 min, reset any
                        │ status=processing older than 10 min back to queued.
```

Budget per song: ~3-4 min wall clock, <$0.05 marginal (artwork) + one
slot of the MiniMax music subscription.

## Components

### 1. Data model — one new table, one migration

```prisma
model SongRequest {
  id                 String    @id @default(cuid())
  stationId          String
  ipHash             String
  prompt             String    @db.Text
  artistName         String
  originalArtistName String?
  moderationStatus   String
  moderationReason   String?
  status             String    @default("queued")
  errorMessage       String?
  miniMaxTaskId      String?
  titleGenerated     String?
  artworkPrompt      String?
  trackId            String?
  createdAt          DateTime  @default(now())
  startedAt          DateTime?
  completedAt        DateTime?

  station Station @relation(fields: [stationId], references: [id])
  track   Track?  @relation(fields: [trackId], references: [id])

  @@index([status, createdAt])
  @@index([ipHash, createdAt])
}
```

Status values: `queued` → `processing` → `finalizing` → `done` or
`failed`. `failed` rows keep `errorMessage` for debugging.

The existing `Track` / `TrackAsset` hold the completed song — same
shape as booth shoutouts and seed-ingest tracks.
`sourceType='internal_generated'` is the new discriminator.

### 2. Public API (Vercel, `app/api/booth/*`)

**`POST /api/booth/song`**
- Body: `{ prompt: string (4-240 chars), artistName: string (2-40 chars) }`.
- IP-hash rate-limit (1/hr, 3/day) counted from `SongRequest` where
  `ipHash=… AND createdAt > now() - interval`. Reject with 429 +
  `retryAfterSeconds`.
- Moderate prompt via existing `moderateShoutout()`:
  - `allowed` → continue.
  - `rewritten` → use the rewritten text as the prompt (moderator
    already cleaned it), but remember the original for audit.
  - `held` or `blocked` → reject with 422 and the moderator's reason.
- Sanitize artistName via `profanityPrefilter()` only (no LLM call).
  On match, store `originalArtistName = what the user typed` and set
  `artistName = "Numa Radio"`. Still continue.
- INSERT `SongRequest` with `status='queued'`.
- Return `{ ok: true, requestId, queuePosition, estWaitSeconds,
  finalArtistName, artistNameSubstituted }`.
  - `queuePosition` = count of rows with `status='queued'` ordered by
    `createdAt` up to and including this row.
  - `estWaitSeconds` = `queuePosition * 210` (3.5 min average).

**`GET /api/booth/song/:id/status`**
- Path id is a cuid — effectively unguessable, so no additional auth.
- Return `{ ok, status, queuePosition?, estWaitSeconds?,
  finalArtistName, title?, artworkUrl?, streamScheduled?,
  errorMessage? }`.
- `status='done'` includes the resolved Track's title + artwork URL.
- Response sets `Cache-Control: no-store`.

**`GET /api/booth/song/queue-stats`**
- Public. Lightweight cached 5 s.
- Return `{ queueDepth: N queued, inProgress: bool, estWaitSeconds }`.
- Powers the "N requests in front of you" live counter on the form
  even before the listener hits submit.

### 3. Worker — `numa-song-worker.service` (new systemd unit on Orion)

New top-level module at `workers/song-worker/`:

```
workers/song-worker/
  index.ts          # entry: init DB, start loop, start crash-recovery sweeper
  claim.ts          # SELECT ... FOR UPDATE SKIP LOCKED; UPDATE to processing
  pipeline.ts       # the 6-step generation pipeline (LLM → music+art → B2 → DB → queue)
  minimax.ts        # /v1/music_generation client (POST start, poll status)
  openrouter.ts     # flux.2-pro image client (single POST, await)
  title-from-prompt.ts  # LLM helper: prompt → {title, artworkPrompt}
  sweeper.ts        # reset processing > 10 min back to queued
  pipeline.test.ts
  claim.test.ts
  title-from-prompt.test.ts
```

Runs as a standalone Node process: `tsx workers/song-worker/index.ts`.
Systemd unit at `deploy/systemd/numa-song-worker.service`. Loop cadence
every 3 s when idle; immediately after finishing a job checks for more.

Concurrency: 1 job at a time (MVP). If the queue grows and the 20/hr
cap is never approached, we can raise this in a later commit.

Crash recovery: on process start, and every 5 min after, run
`UPDATE SongRequest SET status='queued', startedAt=null WHERE
status='processing' AND startedAt < now() - interval '10 minutes'`.

### 4. LLM helpers

**`workers/song-worker/title-from-prompt.ts`** — single MiniMax M2.7
call with a small classifier-style prompt that returns strict JSON:

```json
{
  "title": "Rainy Morning Coffee",
  "artworkPrompt": "Moody ink-wash painting of steaming coffee cup on rainy windowsill, muted palette, tasteful album cover composition"
}
```

Title ≤ 50 chars, artworkPrompt ≤ 280 chars. Falls back to
`{ title: prompt.slice(0, 50), artworkPrompt: prompt }` if the LLM
output is un-parseable.

**`workers/song-worker/minimax.ts`** — wraps MiniMax music API.
- `startMusicGeneration({ prompt }): Promise<{ taskId }>`
- `pollMusicGeneration(taskId): Promise<{ status, audioUrl?,
  durationSeconds?, failureReason? }>`
- Always sends `is_instrumental: false`, `lyrics_optimizer: true`,
  `output_format: "url"`. Model is `music-02` (MiniMax's production
  music model name per reference implementation — see
  `~/examples/make-noise/app/api/music/route.ts`). If the API returns
  a different production model name we pin it via env
  `MINIMAX_MUSIC_MODEL`.
- Handles the duration normalization quirks the reference code shows
  (can be returned in ns / µs / ms / samples).

**`workers/song-worker/openrouter.ts`** — wraps OpenRouter image
generation.
- `generateArtwork(prompt): Promise<{ pngBytes: Buffer }>`
- Reads `OPEN_ROUTER_API` env var (the name the operator already set
  in Vercel and /etc/numa/env).
- Model: `black-forest-labs/flux.2-pro`.
- Endpoint: OpenRouter's image-generation route per their docs. If
  OpenRouter's image API returns a URL instead of raw bytes, fetch
  it in this helper so the caller gets bytes either way.
- Returns 1024×1024 PNG.

### 5. UI — new `Create` tab on `numaradio.com`

A new tab alongside the existing `Listen` and `Requests` (shoutouts)
tabs. Uses the same homepage tab framework.

Form fields:
- **Your artist name** — text input, 2-40 chars, required. Label
  subcopy: "shown as the credit — will fall back to Numa Radio if
  the name can't be aired".
- **Describe the song** — textarea, 4-240 chars, required. Label
  subcopy: "style, mood, vibe, subject — whatever you like. We'll
  write the lyrics for you".
- **Submit** button.
- Below the button, live counter: "~3 min · N requests in front of
  you" (polls `queue-stats` every 10 s while the form is idle).

After submit:
- Shows a pending card with a spinner, the LLM-generated title
  placeholder, rotating status captions ("thinking about the vibe" →
  "composing" → "painting the cover" → "putting on the air").
- Polls `/status` every 5 s.
- On `done`: artwork fades in, title displayed, artist displayed,
  "Airing on the stream now — tune in." Plays the live stream
  inline if not already playing.
- On `failed`: friendly error + "your slot has been refunded — try
  again in a minute". (Implementation detail: we DELETE the
  SongRequest row on generation failure so it doesn't count toward
  rate limit. Moderation rejections still count toward rate limit
  — those are the listener's doing, not the system's.)

### 6. Rate limit

Extend `lib/rate-limit.ts` with a second helper
`checkSongRateLimit(ipHash): Promise<RateLimitResult>` that counts
`SongRequest` rows matching ipHash in the last hour / day against
`SONG_LIMITS = { HOUR_LIMIT: 1, DAY_LIMIT: 3 }`. Same return shape
as the shoutout limit: `{ ok: true }` or `{ ok: false, reason:
"hour_limit" | "day_limit", retryAfterSeconds }`.

`retryAfterSeconds` is the wall-clock seconds until the oldest
counted row falls out of the window.

### 7. Env vars

Already set by the operator:
- `MINIMAX_API_KEY` (Vercel + `/etc/numa/env`)
- `OPEN_ROUTER_API` (root `.env.local`, needs copying to Vercel + to
  Orion's `/etc/numa/env` for the worker)

New (optional, defaults in code):
- `MINIMAX_MUSIC_MODEL` (default `music-02`)
- `MINIMAX_MODERATION_MODEL` (already in code default `MiniMax-M2.7`)
- `OPENROUTER_IMAGE_MODEL` (default `black-forest-labs/flux.2-pro`)

The worker runs on Orion, so `OPEN_ROUTER_API` must be added to
`/etc/numa/env` (already the canonical server-side secrets file).

## Error handling & edge cases

- **MiniMax music generation fails** (timeout > 6 min, API error,
  `status=failed`): set `status='failed'`, `errorMessage`, DELETE
  the SongRequest row after 1 s so the IP's rate limit isn't
  consumed by a system-side failure. Return the error to the poller.
- **OpenRouter artwork fails**: log, continue without artwork. Track
  is still created with a known default SVG as the primary artwork
  asset. Don't fail the whole song over missing art.
- **B2 upload fails**: `status='failed'` with the underlying error.
  This is rare; no refund (the audio was generated successfully,
  which is the expensive part).
- **Queue-daemon push fails** (e.g. daemon restarting): the Track
  is already in the library with `airingPolicy='library'`, so it'll
  air in normal rotation eventually. Log the push failure as a
  warning. `status='done'`, no error shown to listener.
- **Worker crash mid-job**: sweeper finds the stale `processing`
  row after 10 min, resets to `queued`. Job restarts from scratch.
  (The MiniMax task_id is kept in the row; a future optimisation
  could resume polling rather than restarting, but not in MVP.)
- **Moderation held/blocked**: returns 422 with moderator's reason
  in response body. The rate-limit slot IS consumed (the listener
  caused the bad submission). Front-end explains this.
- **Sanitized artist name**: not an error — listener is told in the
  response and the pending card that their chosen name wasn't used.
  Generation proceeds.
- **Submit while previous request of theirs is still queued**:
  rejected by rate limit (1/hour per IP). Front-end shows their
  pending request's status instead of an empty form.
- **Listener closes the tab then returns**: no persistence of
  requestId locally for MVP. They've lost the ability to poll.
  That's OK — the song will still generate and air. When they
  come back and hear it, the tab will show whatever's currently
  playing via the existing now-playing path. (Phase B adds a
  localStorage `recentRequestIds` list and a "your recent songs"
  drawer.)

## Testing

Unit (`node --test` harness, matches existing pattern):
- `lib/rate-limit.test.ts` — add cases for `checkSongRateLimit` at
  the hour and day boundaries.
- `workers/song-worker/claim.test.ts` — claim mutex against a faked
  pool: only one of two concurrent calls returns a row.
- `workers/song-worker/pipeline.test.ts` — happy path and each
  failure branch against mocked MiniMax / OpenRouter / B2 / queue
  clients.
- `workers/song-worker/title-from-prompt.test.ts` — parses the LLM
  JSON reply, falls back gracefully on malformed output.

Integration (manual, on the live stack once deployed):
1. Submit a prompt from numaradio.com as an anonymous browser. Watch
   the form cycle through pending → done in 3-4 min. Verify the
   song airs within 30 s of "done" state.
2. Submit a prompt with profanity → 422 with moderator reason.
   Rate-limit slot consumed.
3. Submit a clean prompt with "fuck" as the artist name → generation
   proceeds, final artist displayed as "Numa Radio".
4. Submit a fourth request in the same day from the same IP → 429
   with `retryAfterSeconds` until midnight UTC.
5. Submit two requests from different IPs within seconds of each
   other; verify the second one says "1 request in front of you".

## Rollout

1. Prisma migration for `SongRequest` table (one migration, no data
   changes to existing tables).
2. Add `OPEN_ROUTER_API` to `/etc/numa/env` on Orion.
3. Deploy `numa-song-worker.service` (build the worker, install unit,
   `systemctl --user enable --now numa-song-worker`).
4. Ship the Vercel routes + UI tab in one Vercel deploy.
5. Smoke-test with one private request (the operator submitting
   once from their own browser).
6. Link the feature from the homepage tabs; announce.

## Rollback

Feature flag: `NEXT_PUBLIC_SONG_CREATION_ENABLED` env var (default
`false`). When `false`, the Create tab is hidden and the API routes
return 503 "feature disabled". Lets us disable end-user access
without redeploying.

To roll back fully: feature-flag off, disable the worker
(`systemctl --user disable --now numa-song-worker`), leave the
migrated `SongRequest` table (empty table costs nothing).

## Out of scope for this phase

- Email or shareable link for "listen to your song again".
- User accounts or login.
- Per-user gallery, "recent creations by me".
- Listener upvote/downvote on generated songs.
- Variations / regenerate button.
- Structured form fields (genre dropdown, tempo slider, instrumental
  toggle, explicit lyrics input).
- Output moderation (scanning MiniMax-generated lyrics before
  airing).
- Dashboard operator curation UI (which generated songs rotate vs.
  stay library-only, deleting tracks, analytics).
- Payment / monetization.
