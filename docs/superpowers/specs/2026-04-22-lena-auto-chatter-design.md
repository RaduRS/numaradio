# Lena auto-chatter between tracks — design

**Status:** brainstormed 2026-04-22, awaiting implementation plan
**Owner:** queue-daemon (Orion)
**Supersedes:** none

## Why

Today the live stream is pure music until a listener submits a shoutout. There are long stretches with no Lena at all, which makes the station feel like a playlist rather than a radio. At the same time, listeners visiting the site don't always discover the two interactive features (shoutouts, song requests) — on-air call-to-action would close that loop.

We want Lena to step in between songs when a toggle is on, mixing back-announces of the track that just ended, call-to-actions for the site's features, and generic station-ID filler. Off by default — flipping the toggle is how this ships to production without any other change.

## What listeners hear when the toggle is on

After every two consecutive music tracks with no voice, Lena speaks for ~15 s over the beginning of the third track — music ducks to –6 dB via the existing `smooth_add` graph (identical to how shoutouts ride today), voice fades out, music returns. Tracks in the library range from ~1 to ~4 min, so at an average ~3 min that's roughly one chatter per 6 minutes, ~10 per hour — exact cadence tracks the actual rotation durations, not wall-clock time.

A shoutout aired in that 2-track window **replaces** Lena's slot: the counter resets to zero, and the next chatter opportunity is 2 music tracks later. So listeners always get at least 2 full music tracks between any two voice moments, whether the voice is from a shoutout or Lena's chatter.

## Content mix (deterministic, no random weighting)

The chatter's content type follows a hand-crafted 20-slot rotation so every cycle of ~2 hours delivers all variants in known proportions, with no same-type adjacency:

```
slot:  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19
type:  A SO  A  B  A SG  A  B  A SO  A SG  A  B  A SO  A  B  A SG
```

Zero-indexed so `slot = slotCounter % 20` maps directly.

Per 20 chatters:
- **10 × back-announce (`A`)** — *"That was [title] by [artist] — [one-line colour]. You're on Numa Radio, more ahead."* Uses `NowPlaying.currentTrackId` resolved to title + artist via Prisma.
- **6 × call-to-action** — 3 × shoutout-CTA (`SO`), 3 × song-request-CTA (`SG`). Split evenly by construction.
- **4 × generic filler (`B`)** — station-ID style, no track metadata.

All four variants go through the same pipeline — MiniMax-M2.7 script generation with a per-variant prompt template, Deepgram Aura-2-Andromeda TTS, B2 upload, `overlay_queue.push`. Only the prompt template differs by variant. Target voice duration ~15 s (~30–50 words).

Example scripts (human-written for length calibration; production scripts come from the LLM each time):

- **A:** *"That was 'Midnight Drive' by Russell Ross — warm mid-tempo, the kind of groove that eases you into the evening. You're tuned to Numa Radio, we're keeping it moving, more ahead."*
- **SO:** *"Got something to say? Head to numaradio dot com, hit the Requests tab, and drop me a shoutout — I'll read it out right here between songs. Numa Radio, stay close."*
- **SG:** *"If there's a mood or a genre rattling around your head, I can build you a song. Tell me what you want over at numaradio dot com on the Song Request tab, and in a few minutes it'll be airing right here. Keep it locked."*
- **B:** *"Numa Radio, always on. Whether you're working, winding down, or just letting the afternoon drift — we're right here with you."*

## Architecture

A new self-contained module `workers/queue-daemon/auto-host.ts` owned by the existing queue-daemon process. The daemon wires two hook calls into its current handlers; the module owns everything else (counter state, station-flag lookup, content generation, push).

```
Liquidsoap rotation.on_track / priority.on_track
       │
       ▼
daemon HTTP POST /on-track  ──►  onTrackHandler()
                                      │
                                      ├──► (existing) queue-item state transitions
                                      │
                                      └──► autoHost.onMusicTrackStart()
                                                │
                                                ▼
                                           tracksSinceVoice += 1
                                           if tracksSinceVoice >= 2
                                             AND stationFlagCache === true
                                             AND no generation in flight:
                                               trigger generation

dashboard /shoutouts toggle → POST → daemon HTTP POST /push (shoutout)
                                        │
                                        ├──► (existing) overlay_queue push
                                        │
                                        └──► autoHost.onVoicePushed()
                                                │
                                                ▼
                                           tracksSinceVoice = 0
                                           if chatter in flight → cancel

autoHost generation worker (async):
  1. pick variant by slotCounter % 20 → template lookup
  2. MiniMax-M2.7 → script (~15 s / 30–50 words)
  3. Deepgram Aura-2-Andromeda → MP3
  4. upload to B2 with Cache-Control: public, max-age=31536000, immutable
  5. sock.send("overlay_queue.push <cdn-url>")
  6. autoHost.onVoicePushed()   ← resets counter, advances slotCounter
```

Why in-daemon and not in the dashboard: the daemon already observes every track boundary and every shoutout push. Looping outward through HTTP to a Next.js route just to generate audio that ends up back in the daemon's `sock.send()` would be pointless indirection. The daemon already has Prisma; adding a fetch to MiniMax, a fetch to Deepgram, and `@aws-sdk/client-s3` is modest.

## Data model changes

One new column on `Station`:

```prisma
model Station {
  // ...
  autoHostEnabled Boolean @default(false)
  // ...
}
```

Default `false` means the feature is shipped dormant — no behaviour change until the operator flips the toggle. A Prisma migration adds the column with the default; no data backfill needed.

No new tables. No new enums. The chatter's lifecycle doesn't need a `Track` or `QueueItem` row because the daemon pushes to `overlay_queue` directly, just like shoutouts do via `generateShoutout` (which creates Track+Asset rows only because it wants persistence for dashboard auditing — auto-chatter does not need an audit trail of every station-ID Lena says).

## In-memory state on the daemon

```ts
interface AutoHostState {
  tracksSinceVoice: number;   // 0..2+
  slotCounter: number;        // 0..19 (mod 20)
  inFlight: boolean;          // generation currently running
  stationFlagCache: {
    enabled: boolean;
    fetchedAt: number;
  };
}
```

`stationFlagCache` is refreshed every 30 s (or on the next track-start event if stale). 30 s means turning the toggle on in the dashboard takes at most ~30 s to be honoured by the next chatter opportunity. `tracksSinceVoice` and `slotCounter` reset on daemon restart (see "Persistence" below).

## Failure handling

Each stage of the pipeline (MiniMax, Deepgram, B2, Liquidsoap push) can fail. Policy:

1. **Retry once** after a 2-second delay. Different transient failures (5xx, network hiccup) clear up quickly at the retry.
2. **Log each attempt** (both the failure and the retry's outcome) to the daemon's existing `lastFailures: RingBuffer` with reason codes `auto_chatter_script_failed`, `auto_chatter_tts_failed`, `auto_chatter_b2_failed`, `auto_chatter_push_failed`. The dashboard's "Recent failures" panel on `/` and `/library` already renders this buffer, so errors are visible without any new UI.
3. **Skip on second failure.** `tracksSinceVoice` resets to 0 (so the next opportunity is 2 tracks away, same as a successful chatter). `slotCounter` does **not** advance — the next successful chatter will be the same type that just failed, so the operator doesn't lose a CTA or back-announce from the rotation.
4. **Moderation not applied.** Unlike shoutouts, auto-chatter is station-owned content with a tightly scoped prompt template. A LLM guardrail in the prompt ("no profanity, no real-person name-drops beyond the track artist") is sufficient.

## Persistence

`slotCounter` is kept in memory only and reset to 0 on daemon restart. Rationale:

- The rotation is purely a listener-facing variety device. Daemon restarts are rare (systemd unit, stable for days), and over a day of normal operation a restart's skew is self-healing — 20 chatters later the distribution is back on pattern.
- Storing the counter in the DB adds a write every track boundary (or at least every successful chatter) for marginal value.

If the feature later grows to need long-run analytics ("which CTAs worked?"), we'd add a lightweight `AutoChatterEvent` table and write there at time of chatter completion. Out of scope for MVP.

## Dashboard UX — one toggle on `/shoutouts`

Add a compact toggle row at the top of the `/shoutouts` page, above the existing Compose / Held / Recent cards:

```
┌────────────────────────────────────────────────────────────┐
│ ⚡ Auto-chatter   Lena speaks between every 2 tracks       │
│                  when no shoutout airs in that window      │
│                                        [○   OFF ] ←toggle  │
└────────────────────────────────────────────────────────────┘
```

- **Wiring:** toggle calls `POST /api/shoutouts/auto-host` with `{ enabled: boolean }` → dashboard updates `Station.autoHostEnabled` via Prisma and returns the new state. Read on page load via a new `GET /api/shoutouts/auto-host`.
- **Auth:** Cloudflare Access already gates `/shoutouts`. No extra layer.
- **Latency from flip to effect:** up to 30 s (daemon's `stationFlagCache` TTL). Toggle UI shows a "changes take effect within 30 s" helper line the first time it's flipped.

The `/shoutouts` page also already renders the `lastFailures` ring buffer via the shoutouts list. Auto-chatter failures show up there with their `auto_chatter_*` reason codes — no new panel needed.

## Observability

Three sources of signal, all pre-existing:

1. **`lastFailures` ring buffer** on the daemon, surfaced by the dashboard's status panels. Picks up every failure with a clear reason code.
2. **`lastPushes` ring buffer** (same mechanism) shows every successful chatter push with `trackId` synthesized as `auto-chatter:<slotCounter>`. Operator can eyeball the rotation.
3. **journald** (`journalctl -u numa-queue-daemon -f`) gets one INFO line per chatter start (`auto-chatter slot=12 type=SO`) and one WARN line per failure. Already the standard operational surface.

## Cost

Per chatter, at the Medium length tier:
- **MiniMax-M2.7 script:** ~200 tokens prompt + ~80 tokens completion ≈ negligible per call, on order of fractions of a cent.
- **Deepgram Aura:** ~50 chars script → ~$0.001 per chatter at current rates.
- **B2 storage:** ~200 KB per chatter × 240/day = ~17 GB/year at $6/TB/month → cents per month.
- **B2 egress:** $0 via Cloudflare Bandwidth Alliance (already live — see `2026-04-22` CDN work).

Rough total: low double-digit dollars/month at 240 chatters/day. Dominated by Deepgram. If this grows uncomfortable, a follow-up adds a pool of pre-generated filler (`B`) MP3s to cache the 20% variant at zero marginal cost; deferred until measurable.

## Out of scope / deferred

- **Forward-announce** ("coming up, [title] by [artist]"). Rotation doesn't schedule the next track deterministically — Liquidsoap picks it at the boundary from a shuffled playlist file — so we'd be guessing. Generic filler covers the "coming up" vibe well enough. If we later want forward-announces, the queue-daemon can read the rotation playlist file (`/etc/numa/playlist.m3u`) and peek at line `N+1`, but that couples us to Liquidsoap's exact pick order. Not worth it for MVP.
- **Per-chatter database audit trail.** See Persistence.
- **Operator live-authored chatters** (beyond the existing `/shoutouts/compose` card, which already covers ad-hoc voice).
- **Pre-generated filler pool.** See Cost.
- **Persistent `slotCounter` across daemon restarts.** See Persistence.
- **Kill switch other than the toggle.** The toggle IS the kill switch. If it ever misbehaves badly in production, flipping it off via the dashboard stops new chatters within ~30 s, and the daemon has no backlog.

## Acceptance criteria

- With `Station.autoHostEnabled = false`: zero behavioural change from current production. No chatter audio generated, no MiniMax/Deepgram calls, no B2 writes. Verifiable by flipping the flag off and observing `journalctl -u numa-queue-daemon` for 30 minutes — no `auto-chatter` lines.
- With `Station.autoHostEnabled = true` and no shoutouts: a chatter airs every ~6 minutes (~2 tracks) indefinitely, rotating through the 20-slot pattern in order. Verifiable by reading successive `auto-chatter slot=N` INFO lines.
- With shoutouts mid-window: the chatter for that window is suppressed. Counter resets. Next chatter opportunity is 2 tracks after the shoutout. Verifiable by submitting a shoutout and observing the absence of the expected chatter at the 2-track mark.
- With MiniMax or Deepgram failing: two log lines in `lastFailures` (initial + retry), chatter skipped, `slotCounter` unchanged. Next successful chatter is the same variant type that just failed.
- Dashboard toggle flips the behaviour within 30 s. Verifiable by toggling and watching journalctl.
- No test suite failures (67/67 main, 38/38 dashboard) before or after implementation.

## Testing strategy (for the plan phase)

Unit tests around pure logic:
- `slotTypeFor(n)` returns `A|SO|SG|B` from the fixed 20-slot table.
- `autoHost` state machine: `onMusicTrackStart` → counter increment; at threshold → trigger; `onVoicePushed` → reset; station flag disabled → no trigger; chatter in flight → no double-trigger.
- Script-template selector emits the right prompt per variant.

Integration tests (deferred to live smoke on Orion, given the daemon's socket-heavy shape):
- Turn flag on; wait two track boundaries; confirm a chatter airs.
- Push a shoutout mid-window; confirm the chatter is suppressed; confirm the next chatter is 2 tracks after the shoutout.
- Simulate a MiniMax 500 by setting an invalid key briefly; confirm two `lastFailures` entries and a retry of the same variant on the next opportunity.

## Files the plan will touch

New:
- `workers/queue-daemon/auto-host.ts` — module (state + generation + push)
- `workers/queue-daemon/auto-host.test.ts` — unit tests
- `workers/queue-daemon/chatter-prompts.ts` — four prompt templates + rotation table
- `dashboard/app/api/shoutouts/auto-host/route.ts` — GET/POST for the toggle
- `prisma/migrations/YYYYMMDDHHMMSS_add_auto_host_enabled/migration.sql`

Modified:
- `prisma/schema.prisma` — add `autoHostEnabled` column
- `workers/queue-daemon/index.ts` — wire `onMusicTrackStart` + `onVoicePushed` hooks
- `dashboard/app/shoutouts/page.tsx` — render toggle card at the top
- `/etc/numa/env` on Orion — add `DEEPGRAM_API_KEY` + `MINIMAX_API_KEY` (user-side edit, same pattern as the CDN env flip)
- `docs/HANDOFF.md` — new Phase section
