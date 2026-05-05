# 2026-05-05 — Deep-dive audit findings (P0 / P1 / P2)

7 parallel `feature-dev:code-reviewer` agents covered: queue-daemon, song-worker + scripts, public Next.js API, dashboard, lib/ + Prisma schema, frontend pages/components, liquidsoap + deploy/systemd. ~74 findings total.

This doc is the canonical list. The post-mortem doc covers the deploy incident separately.

---

## Headline

| Severity | Count | Shipped | Deferred / Reverted |
|---|---|---|---|
| P0 | 14 | 14 | 0 |
| P1 | ~22 | 14 | 8 (incl. schema migration **reverted**) |
| P2 | ~30 | 6 | ~24 |

Shipped commits:
- `fa186b5` — P0 sweep
- `caf2ea0` — P0 hotfix (Liquidsoap recursive fn type error)
- `3b73f90` — P1 main (timeouts, leaks, indexes — schema enum **reverted in `e2a30e5`**)
- `4347381` — P1 ops hardening
- `e2a30e5` — revert of schema enum + index migration (see post-mortem)
- `db4b842` — post-mortem doc
- `8252db2` — MiniMax fetch timeout 30s → 90s (P1 follow-up)
- `2600008` — HSTS on both next.config.ts (P2)
- `1fa7a7b` — derive-genre regex tightened on ambiguous English words (P1 deferred → done)
- `4f1b14e` — hardcode operator=\"nanoclaw\" in internal-tool routes (P2)
- `3c413c8` — verify-audio-sig 4h ceiling on exp (P2)
- `4890334` — ListenerCount singleton (P2 — kill duplicate pollers)
- `31d68d3` — brand-aware global-error fallback (P2 — layout-throw gap)

---

## P0 — all shipped

1. **`/api/generate/shoutout` unauthenticated** (dashboard) — added `internalAuthOk` guard. NanoClaw briefings updated to send `x-internal-secret`.
2. **Song-worker B2 orphans on pipeline failure** — `pipeline.ts` now tracks uploaded keys + deletes on failure. `index.ts` error-path switched from `delete` to `update status='failed'`.
3. **Sweeper threshold (10 min) shorter than 6-min poll timeout** — `STALE_MINUTES = 20`.
4. **`purge-orphan-shoutouts` could nuke live shoutouts** — added `createdAt < NOW() - 24h` AND `no live QueueItem` filter.
5. **`announce.ts` stash leak** — 2h TTL on stash entries.
6. **`auto-host` permanently stuck `#inFlight` after listener-song interrupt** — call `markFailure()` before early-return on the `currentRun !== myRun` check at both points.
7. **Liquidsoap callbacks no retry** — recursive `post_with_retry` helper with wrapper, 3 attempts, retries on 5xx + network err. (Hotfix `caf2ea0` split into wrapper + recursive inner because `~attempts=3` optional default conflicted with rec-call inference.)
8. **`submissions/init` retry path drops `trackTitle` + `trackGenre`** — added them to retry-create data block.
9. **`sanitize-mp3-audio-only` false-success on truncated files** — `code !== 0 || stdout.length === 0` (was `&&`).
10. **`text-script.ts` Latin range excluded Vietnamese** — extended regex to include `Ḁ-ỿ` (U+1E00–U+1EFF Latin Extended Additional).
11. **`useBroadcast` hydration mismatch** — `useState(0)` then set in `useEffect`, mirrors `useNowPlaying` pattern.
12. **`privacy-sweep` cron `!==` token compare** — replaced with `timingSafeEqual` via `cronAuthOk()` helper. Error response now opaque (`'sweep_failed'`).
13. **Encoder shell `exec ffmpeg` killed cleanup trap** — replaced with run-and-wait + capture rc + explicit exit so the EXIT trap fires.
14. **`nextPositionIndex` TOCTOU race** — wrapped read+create in `prisma.$transaction` with `pg_advisory_xact_lock` keyed on `stationId:priority_request`.

---

## P1 — shipped

**Hangs / no-timeout fetches:**
- `workers/queue-daemon/minimax-script.ts` — `AbortSignal.timeout(30s)` on the MiniMax call.
- `dashboard/lib/openrouter.ts` — `AbortSignal.timeout(45s)` on Flux + 15s on the remote-image fetch.
- `dashboard/lib/humanize.ts` — `AbortSignal.timeout(20s)` on the humanize MiniMax call.
- `workers/queue-daemon/deepgram-tts.ts` — `await res.body?.cancel()` before fallback so undici keep-alive doesn't leak a socket per fallback.

**Polling / leaks:**
- `dashboard/app/library/SubmissionsPanel.tsx` — replaced raw `setInterval` with visibility-gated start/stop.
- `app/_components/RequestForm.tsx` — `cancelledRef` set on unmount; `pollModerationOutcome` bails after fetch instead of burning ~20 cycles.
- `app/_components/VoteButtons.tsx` — drop empty subscriber `Set`s + their `stateCache` entries when last subscriber leaves.

**Logic:**
- `lib/classify-shoutout-intent.ts` — fails closed (`category: "noise"`) when `MINIMAX_API_KEY` missing. Test updated.
- `app/api/presence/heartbeat/route.ts` — per-IP token bucket (6 per 60s window, in-memory, periodic sweep).

**Ops:**
- `deploy/systemd/numa-dashboard.service` — moved `StartLimitBurst` / `StartLimitIntervalSec` from `[Service]` to `[Unit]` (modern systemd only honours them in `[Unit]`).
- `deploy/systemd/numa-youtube-encoder.service` — added `After=icecast2.service` and `Wants=icecast2.service`. Added `chromium-browser` to the ExecStartPre / ExecStopPost pkill regex.
- `deploy/secure-numa-env.sh` — also locks `dashboard/.env.local` to `marku:marku 0600`.

---

## P1 — deferred

**1. `dashboard/app/api/chat/confirm/[confirmId]/route.ts:148` — HTTP loopback for tool invocation.**
The confirm-then-execute path does `fetch(internalUrl(req, route))` with `INTERNAL_API_SECRET` in the header. On Vercel that's a public CF round-trip. Cleaner: direct import + call the shared lib functions (mirroring how the other tool routes already work server-side). Deferred — bigger refactor than the audit window. **Why it's not urgent:** the secret is HMAC'd-equivalent (timing-safe compare), CF and Vercel access logs are private, and the call only happens on operator confirm of a yellow-light action. Not a runtime issue.

**2. `app/api/booth/song/route.ts:115` — moderation still synchronous.**
HANDOFF backlog item from before. The shoutout submit was moved into `after()` in 2026-05-03 audit; song submit wasn't. Each song request burns 2-15s of Vercel CPU on `moderateSongPrompt()` in the foreground. Pattern to follow: `dashboard/app/api/booth/shoutout/[id]/status/route.ts` + the `numa.shoutout.last` recovery flow.

**3. `lib/derive-genre.ts:28` — `\b(house|soul|country|folk|blues)\b` false-positives.** ✅ **SHIPPED `1fa7a7b`** — split into `STRICT_PATTERNS` and `AMBIGUOUS_PATTERNS`; the five overloaded English words now require a music-context noun (music/track/song/tune/beat/album/genre/playlist) before matching. +2 tests.

**4. `liquidsoap/numa.liq:42` — `overlay_queue` has no length cap.**
Liquidsoap 2.2.4's `request.queue` doesn't expose a `length` parameter. Per-source rate limits already prevent realistic runaway. If this ever becomes a problem, the right place is daemon-side: a pre-push depth check via the telnet `overlay_queue.queue` introspection. Documented in numa.liq.

**5. `numa-dashboard.service` reads from repo `dashboard/.env.local`.**
`secure-numa-env.sh` now locks it to `marku:marku 0600` — good enough for now. Long-term cleaner: move the dashboard secrets to a separate `/etc/numa/dashboard.env` at root:root 0600 with `marku` group read, point `EnvironmentFile=` there. Operator workflow change required.

**6. `Shoutout.deliveryStatus` enum + 5 hot-path indexes — REVERTED in `e2a30e5`.**
Migration path needs a bootstrap step first. See post-mortem for context. To re-introduce safely:
- First run `prisma migrate resolve --applied <name>` for each of the 18 historical migrations (the prod `_prisma_migrations` table doesn't reflect the schema's actual lineage).
- Then ship the new migration in a separate commit, with the schema change in a follow-up commit (or with a backwards-compatible cutover: add `deliveryStatusV2`, double-write, backfill, switch reads, drop old column).

**Indexes only (no enum) could ship safely as additive-only**, but still need the `_prisma_migrations` baseline first or `migrate deploy` won't know what to do.

**7. P0 noise: false-positive race finding.**
`approveShoutout` operator-vs-NanoClaw race was flagged in the audit. Verified safe — existing `UPDATE ... WHERE moderationStatus IN ('held','blocked')` is atomic; the second caller's `WHERE` doesn't match after the first commits. Test at `dashboard/lib/shoutouts-ops.test.ts:289` already covers this. No code change.

---

## P2 — all deferred (~30 items)

Lower priority. Group by theme:

### Code duplication / drift traps
- `lib/moderate.ts` and `dashboard/lib/humanize.ts` both maintain identical `PROFANITY_PATTERNS` regex lists. Tweaking one without the other is a foot-gun. Extract to a shared `lib/profanity-patterns.ts`.
- `lib/schedule.ts:73-86` and `dashboard/lib/humanize.ts:58-70` — `timeOfDayFor` / `formatLocalTime` duplicated. At minimum add a co-located test in `dashboard/lib` that pins outputs to match. Better: a shared package.

### Security headers
- ~~`next.config.ts` and `dashboard/next.config.ts` both missing `Strict-Transport-Security`.~~ ✅ **SHIPPED `2600008`** — `max-age=63072000; includeSubDomains`, no `preload`.

### Performance / memory
- `app/api/submissions/[id]/audio/route.ts:43` — buffers the full MP3 in Vercel function memory before streaming. Range requests still pull the whole file. Switch to a presigned redirect or Range-forwarding stream.
- `app/_components/ShoutoutWall.tsx` and `app/_components/OnAirFeed.tsx` independently poll `/api/station/shoutouts/recent` every 30s. With expanded player open on homepage that's two pollers. Extract a singleton hook.
- ~~`app/_components/ListenerCount.tsx` — Hero + Footer instances both poll independently~~ ✅ **SHIPPED `4890334`** — module-level singleton, all 5 mount sites (Hero, Footer, ExpandedPlayerMobile, About, BroadcastStage) share one poller.

### Schema / DB hygiene
- `Shoutout.deliveryStatus` is freeform `String` not enum (was the P1 attempt — now reverted). Typos like "AIRED" disappear from operator queue queries. Re-introduce after `_prisma_migrations` baseline.
- Missing indexes (in P1 deferred above): `Shoutout(ipHash, createdAt)`, `Shoutout(fingerprintHash)`, `PlayHistory(trackId)`, `QueueItem(trackId)`, `Track(stationId, title)`. All seq-scan today. Index-only migration is additive-safe once `_prisma_migrations` is bootstrapped.
- `NowPlaying`, `NowSpeaking` reference `trackId` as plain `String` (no FK). A track delete leaves stale pointers. The `shoutout-ended` callback should null-out `NowSpeaking` regardless.

### Operator surface
- ~~`dashboard/app/api/internal/tools/*` accept `body.operator` verbatim~~ ✅ **SHIPPED `4f1b14e`** — all 6 routes (service-restart, library-push, shoutout-approve, shoutout-reject, autochatter-toggle, song-generate) now hardcode `operator = "nanoclaw"` and ignore the body field. Body interfaces no longer accept `operator`.
- `dashboard/app/api/library/track/[id]/artwork/route.ts:80` — no `stationId` check on artwork regen. Single-tenant deploy makes this harmless today but it's a cross-station write surface for future.

### Frontend UX
- ~~`app/error.tsx` only catches client-component throws below the segment~~ ✅ **SHIPPED `31d68d3`** — `global-error.tsx` now has a brand-aware fallback (NUMA · RADIO wordmark, broadcast-theme copy, plain anchor that survives dead hydration). Layout-level throws still go to global-error (no way around that — the layout has failed) but the fallback no longer looks broken.
- `app/_components/SongTab.tsx:153` — `tick()` after 404 can land on unmounted component (lower-severity than RequestForm because the 404 path is rare).

### Scripts hygiene
- `scripts/scan-and-repair-multistream-tracks.ts` hardcodes B2 origin URL (doesn't read from env). Bucket move would silently 404.
- `scripts/scan-and-repair-multistream-tracks.ts` buffers full audio into RAM with no Content-Length guard. ~840MB peak on full catalogue scan.
- `scripts/backfill-track-durations.ts:112` — dead `diff_lt_1s` counter (unreachable due to early-return on line 108) and never printed.
- `scripts/backfill-titles.ts` — no dry-run mode, no `lib/load-env` import, will mutate intentionally all-caps titles on first invocation.
- `scripts/cleanup-test-submission.ts` — defaults to "most recent rejected submission" when no id passed. Sharp edge if run casually after a real artist reject. Require explicit `--id=`.

### Logic
- `lib/probe-duration.ts:54` — `Readable.fromWeb(res.body as never)` cast suppresses a Node 18-vs-20 compatibility gap. Pin Node ≥20 in `engines` or replace cast with `as ReadableStream<Uint8Array>`.
- ~~`lib/verify-audio-sig.ts` — no upper bound on `exp`.~~ ✅ **SHIPPED `3c413c8`** — `MAX_TTL_SECONDS = 4 * 60 * 60`. Rejects exp > now + 4h. Catches the millis-instead-of-seconds units bug. +3 tests.

---

## Process changes from this session

1. **Never ship a Prisma schema migration in the same commit as the code that depends on it.** Either keep it additive-only or split into 2 deploys with the migration first.
2. **Verify `_prisma_migrations` baseline exists before any `prisma migrate deploy`.** A `migrate status` showing "0 of N applied" against a populated DB is a sign the tracking table is missing — fix that before shipping anything else.
3. **For unknown-cause data wipes: Neon PITR is the recovery path.** Free tier keeps 24h. First move, not last.

---

## How to pick up on a fresh session

Read in this order:
1. This file (audit findings + current state).
2. `2026-05-05-incident-postmortem.md` (what happened mid-session).
3. `HANDOFF.md` (general project state).

To resume P1 work safely:
- Do NOT re-introduce the `DeliveryStatus` enum migration without first baselining `_prisma_migrations`.
- Index-only migration is the lowest-risk re-entry (additive, no app-code coupling) — but still needs the baseline.
- Dashboard P1 redeploy (`cd dashboard && npm run deploy`) is optional and safe — pure code, no schema. Brings openrouter + humanize timeouts and SubmissionsPanel visibility-gate live.

For P2: pick whichever item is most painful in practice. The duplicated profanity regex / `timeOfDay` are the highest "drift trap" risk; HSTS is the cheapest one-line win.
