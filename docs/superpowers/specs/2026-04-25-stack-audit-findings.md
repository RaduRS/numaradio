# Numa Radio Stack Audit — Findings

Date: 2026-04-25
Consolidates 7 parallel agent audits run per
`2026-04-25-stack-audit-plan.md`.

## Executive summary

- **Stack is in solid shape.** Codebase was built from scratch by one
  person and it shows: consistent patterns, no TODO debt, clean recent
  commits, no high/critical CVEs.
- **True P0s: 2** (both security, both 1-line fixes).
- **P1s: ~48** spread across all 7 areas.
- **P2s: ~50** backlog.
- **Most-touched pillar:** security (present across backend, NanoClaw,
  infra, cross-cutting). The pattern is the same — inconsistent
  timing-safe compare + rate-limit spoofing + a few missing timeouts.

### By-area counts (post-sanity-check, post-retraction)

| Area | P0 | P1 | P2 | Total |
|---|---|---|---|---|
| Public site | 0 | 7 | 10 | 17 |
| Dashboard UI | 0 | 8 | 4 | 12 |
| Backend + workers | **2** | 12 | 4 | 18 |
| Broadcast infra | 0 | 12 | 13 | 25 |
| Videos repo | 0 | 1 | 6 | 7 |
| NanoClaw integration | 0 | 5 | 9 | 14 |
| Cross-cutting | 0 | 10 | 8 | 18 |
| **Total** | **2** | **55** | **54** | **111** |

(P0 reclassifications: F-infra-1 and F-crosscut-1 downgraded to P1
after sanity-checking — see "Sanity-check notes" at end.)

## Cross-cutting themes

Findings that look separate in agent reports but share a single root
cause or share a single-PR fix:

### Theme A — Non-timing-safe secret comparison (9 routes)

**Related findings:** F-backend-1 (P0), F-crosscut-2 (P1),
F-crosscut-6 (P1).

Pattern: `secret !== expected` instead of `crypto.timingSafeEqual`.
Dashboard's tools routes already use `internalAuthOk` from
`dashboard/lib/internal-auth.ts`; the following 9 routes don't:

- `dashboard/app/api/internal/shoutout/route.ts:20` (P0 — the public
  booth-submit endpoint)
- `dashboard/app/api/internal/shoutouts/held/route.ts`
- `dashboard/app/api/internal/shoutouts/held-notify/route.ts`
- `dashboard/app/api/internal/shoutouts/[id]/approve/route.ts`
- `dashboard/app/api/internal/shoutouts/[id]/reject/route.ts`
- `app/api/internal/track-started/route.ts:30-33`
- `app/api/internal/shoutout-started/route.ts:35-38`
- `app/api/internal/shoutout-ended/route.ts:20-22`

**Single-PR fix:** (a) Extract a `lib/internal-auth.ts` in the main
repo mirroring `dashboard/lib/internal-auth.ts`. (b) Replace the 9
raw compares with `internalAuthOk(req)`.

### Theme B — External-call timeouts missing

**Related findings:** F-backend-6, F-backend-7, F-backend-17,
F-backend-8 (+ SSRF), F-infra-4, F-infra-17.

Several `fetch()` calls have no `AbortSignal.timeout()`. On MiniMax /
Deepgram / B2 / OpenRouter slowness, these can hang forever:

- `lib/moderate.ts:158` — MiniMax moderation (blocks booth submit)
- `workers/song-worker/pipeline.ts:107` — queue-daemon push (song
  pipeline hangs after all expensive steps done)
- `workers/song-worker/pipeline.ts:181` — MiniMax audio download
  (blocks all subsequent song jobs, single-worker queue)
- `workers/song-worker/openrouter.ts:79-85` — remote-URL fetch (also
  SSRF — see Theme F)
- `liquidsoap/numa.liq:106, 150, 172` — Liquidsoap's `http.post()` to
  Vercel/daemon (blocks track boundary)
- `liquidsoap/numa.liq:262` — Icecast connect validated lazily

**Single-PR fix per file:** add `signal: AbortSignal.timeout(Nms)`
(5s for daemon pushes, 15s for LLM calls, 30s for MP3 download).

### Theme C — Security headers missing on both Next apps

**Related findings:** F-public-1, F-crosscut-10.

Neither `next.config.ts` sets any security headers. Single fix =
add `headers()` block to both configs with CSP (Report-Only first,
then enforce), `X-Frame-Options: DENY` on dashboard,
`Referrer-Policy`, `Permissions-Policy`.

### Theme D — Webhook callback idempotency

**Related findings:** F-backend-9 (shoutout-ended double-fire loses
cleanup), F-backend-10 (PlayHistory `completedNormally` always
`true`), F-infra-25 (Liquidsoap double-notify), F-crosscut-12 (no
tests for any of these).

The Liquidsoap → Vercel callbacks assume single-delivery but
Liquidsoap has no exactly-once guarantee. The safety guard in
`delete-aired-shoutout.ts` (refuses anything that isn't
`external_import + request_only`) protects from the worst outcome,
but PlayHistory data is silently wrong and B2 cleanup can be
skipped on double-fire.

**Fix cluster:**
1. Add trackId to Liquidsoap's `shoutout-ended` POST body so cleanup
   is independent of `NowSpeaking` state (F-backend-9).
2. Invert PlayHistory contract: create with `completedNormally:false`,
   add a `track-ended` callback to flip it (F-backend-10).
3. Add unique constraint or idempotency key (F-infra-25).
4. Add webhook idempotency tests (F-crosscut-12).

### Theme E — Observability gaps on silent failures

**Related findings:** F-dash-8 (auto-host toggle swallow), F-dash-9
(initial auto-host load swallow), F-infra-13 (Neon read failures in
daemon), F-infra-20 (hydration failures).

Several error paths are caught-and-silenced with no user-facing
signal or operator-facing metric. Operator sees "Loading…" or silence
and doesn't know anything's wrong.

### Theme F — SSRF + URL handling

**Related findings:** F-backend-8, F-backend-12, F-infra-23.

- `workers/song-worker/openrouter.ts` fetches URLs from OpenRouter's
  response without allowlist. Low-likelihood (trusted source) but
  cheap to harden.
- Queue-daemon `/push` accepts arbitrary `sourceUrl` with no newline
  validation — telnet-injection risk into Liquidsoap.

---

## P0 findings (ship same-session)

### P-1: Rate-limit IP can be spoofed via X-Forwarded-For

**Source:** F-backend-2
**Category:** sec
**File:** `lib/rate-limit.ts:22-29`
**Problem:** `clientIpFromRequest` takes the FIRST comma-split value
of `x-forwarded-for`. On Vercel behind Cloudflare, the first value is
attacker-controlled. Any client can send
`X-Forwarded-For: 1.2.3.4, <real-ip>` and hash `1.2.3.4` as the
rate-limit key. This bypasses booth shoutout (3/hr, 10/day) and song
(1/hr, 3/day) limits entirely.
**Fix:** Use `x-vercel-proxied-for` first (single value, not
user-settable), else LAST comma-split value of `x-forwarded-for`.
**Effort:** S. **Risk:** low. **Ship:** same session.

### P-2: `dashboard/api/internal/shoutout` uses non-timing-safe compare

**Source:** F-backend-1 (theme A)
**Category:** sec
**File:** `dashboard/app/api/internal/shoutout/route.ts:20`
**Problem:** `secret !== expected` is a direct string compare. Every
other internal route in the dashboard uses `internalAuthOk`
(timing-safe). This is the public booth-pipeline entry point.
**Fix:** Replace with `internalAuthOk(req)` import. Ship as part of
Theme A (9 routes × same fix).
**Effort:** S. **Risk:** low. **Ship:** same session.

---

## P1 findings (ship within a week)

### Public site — 7 P1s

- **F-public-1** (sec-headers) — Theme C. `next.config.ts` has no
  `headers()` function at all. S, low.
- **F-public-2** (seo) — `app/layout.tsx:121` JSON-LD uses
  `strategy="afterInteractive"`, invisible to SSR-only crawlers.
  Inline in `<head>` instead. S, low.
- **F-public-4** (reliability) — `app/add-to-home-screen/page.tsx:18`
  hardcodes a specific B2 track ID for mock artwork. If that track
  gets purged, every phone mockup breaks. Swap to a static asset. S,
  low.
- **F-public-5** (a11y) — No `prefers-reduced-motion` guard on EQ
  bars, marquee ticker, pulseDot, slowGlow keyframes. Can trigger
  vestibular symptoms. Add `@media (prefers-reduced-motion: reduce)`
  block in `_design-base.css`. S, low.
- **F-public-6** (a11y) — ExpandedPlayer's dialog doesn't restore
  focus to the triggering element on close. Screen-reader users lose
  position. Store `document.activeElement` on expand, restore on
  collapse. S, low.
- **F-public-7** (a11y) — `role="tab"` buttons in RequestForm and
  add-to-home-screen lack `aria-controls` + `role="tabpanel"` linkage.
  S, low.
- **F-public-16** (seo) — `add-to-home-screen/page.tsx` has no
  `metadata` export. Inherits wrong canonical + title. S, low.

### Dashboard UI — 8 P1s

- **F-dash-1** (perf) — `shoutouts/page.tsx:183-197` uses manual
  `setInterval` for listener poll; bypasses `usePolling`'s
  visibility-pause. Move to `usePolling`. S, low.
- **F-dash-2** (dry) — `fmtRelative` duplicated in 3 files with
  subtle divergence (library version has extra hours bucket). Extract
  to `dashboard/lib/fmt.ts`. S, low.
- **F-dash-4** (a11y) — Auto-chatter `role="radiogroup"` has broken
  keyboard nav (arrow keys don't cycle focus). Either switch to
  `<input type="radio">` or add onKeyDown + roving tabindex. M, low.
- **F-dash-5** (a11y) — Filter chip buttons (library + shoutouts)
  missing `aria-pressed` on active state. S, low.
- **F-dash-6** (a11y) — Compose `<textarea>` has no label/aria-label.
  S, low.
- **F-dash-7** (a11y) — Library search `<input>` has no
  label/aria-label. S, low.
- **F-dash-8** (observability) — Auto-host toggle silently swallows
  API errors. Operator sees spinner disappear with no mode change and
  no explanation. Add `toast.error()`. S, low.
- **F-dash-9** (observability) — Initial auto-host GET silently fails
  → UI stuck at "Loading…", all mode buttons disabled. Add fallback
  + warning toast. S, low.
- **F-dash-11** (dx) — `service-row.tsx:42-46` toast string drops
  closing paren when `state` present but `durationMs` absent. Output:
  `"restarted numa-liquidsoap (active"`. Rebuild the parenthetical
  from a filter-boolean array. S, low.

### Backend + workers — 12 P1s

- **F-backend-3** (sec) — `workers/song-worker/claim.ts:28` uses
  `$queryRawUnsafe`. No current injection (SQL is hardcoded) but the
  API signals danger. Switch to `$queryRaw` tagged template. S, low.
- **F-backend-4** (sec) — `dashboard/lib/ipc-writer.ts:29` joins
  operator-controlled path without asserting `dir` is absolute.
  Defense-in-depth. S, low.
- **F-backend-5** (sec) — Dashboard `shoutouts/[id]/approve|reject`
  routes trust `cf-access-authenticated-user-email` header without
  verification. Relies on CF Access edge being the sole auth. Add a
  format check + document assumption. S, low.
- **F-backend-6** (reliability) — Theme B. `lib/moderate.ts:158`
  MiniMax fetch has no timeout. Booth submit hangs until Vercel's
  function timeout. S, low.
- **F-backend-7** (reliability) — Theme B.
  `workers/song-worker/pipeline.ts:107` `pushToQueueDaemon` no
  timeout. S, low.
- **F-backend-8** (sec) — Theme F. `openrouter.ts:79-85` fetches
  response-supplied URL with no allowlist (SSRF path) + no timeout. S,
  low.
- **F-backend-9** (reliability) — Theme D. `shoutout-ended` not
  idempotent; double-fire loses B2 cleanup. Pass trackId in callback
  body. M, medium (needs Liquidsoap config change).
- **F-backend-10** (reliability) — Theme D. PlayHistory
  `completedNormally` always `true` even on skip/crash. Invert
  contract. M, low.
- **F-backend-11** (reliability) — `approveShoutout` status-update
  can leave rows stuck in `'pending'` after successful queue push if
  the final UPDATE fails. Wrap in `'processing'` sentinel. M, low.
- **F-backend-12** (sec) — Theme F. Queue-daemon `/push` accepts
  arbitrary `sourceUrl` with no newline validation → telnet-injection
  into Liquidsoap. Validate characters. Also consider adding a shared
  secret. S (validation) / M (secret), low.
- **F-backend-14** (reliability) — `checkShoutoutRateLimit` has TOCTOU
  window — concurrent requests can both pass the check and both insert,
  overflowing the limit by concurrency factor. Advisory lock or
  document as acceptable. M, low.
- **F-backend-17** (reliability) — Theme B.
  `workers/song-worker/pipeline.ts:181` MiniMax MP3 download no
  timeout. 30s signal. S, low.

### Broadcast infra — 12 P1s

- **F-infra-1** (reliability) — `deploy/systemd/numa-liquidsoap.service`
  missing from repo (lives only on live server). Config drift.
  Copy from `/etc/systemd/system/` and commit. S, low.
- **F-infra-2** (observability) — Queue-daemon's `/push` returns 200
  when socket send fails during reconnect window. Return 503. M,
  medium.
- **F-infra-4** (reliability) — Theme B. Liquidsoap `http.post()` no
  timeout. Add `timeout=5.0`. S, low.
- **F-infra-5** (reliability) — If `/etc/numa/playlist.m3u` disappears
  between reloads, Liquidsoap falls through to `blank()` silently.
  Wrap in `fallback([playlist, blank_safe])` or add readability probe
  in refresh-rotation. M, medium.
- **F-infra-6** (reliability) — `numa-queue-daemon.service` has no
  `StartLimitBurst`/`StartLimitIntervalSec`. Crash loops forever. Add
  rate-limit. S, low.
- **F-infra-7** (reliability) — `numa-song-worker.service` same issue
  + reads `.env.local` as `EnvironmentFile` before `/etc/numa/env`.
  Remove `.env.local` dep + add StartLimitBurst. S, low.
- **F-infra-8** (observability) — Rotation-refresher timer has no
  failure visibility. 3 consecutive failures should alert. M, low.
- **F-infra-9** (sec) — `/etc/numa/env` mode 0644 (world-readable)
  contains `ICECAST_SOURCE_PASSWORD` and `INTERNAL_API_SECRET`. Fix
  to `0600 root:root`. Document in SERVER_SETUP. S, low.
- **F-infra-13** (observability) — Queue-daemon Neon errors silently
  logged; listener hears 15s silence instead of Lena. Expose
  `lastNeonError` in `/status`. M, low.
- **F-infra-17** (reliability) — Theme B. Icecast password validated
  lazily at first connect. Wrong password = silent loop forever. Add
  early connect check. M, medium.
- **F-infra-20** (observability) — `hydrate()` failure leaves daemon
  accepting pushes with stale state. Add `lastHydrationError` +
  degraded mode. M, low.
- **F-infra-25** (reliability) — Theme D. Liquidsoap track boundary
  callbacks aren't explicitly idempotent server-side. Add unique
  constraint. M, medium.

### Videos repo — 1 P1

- **F-videos-1** (dry) — `PayoffBeat` duplicated 5× with **silent
  divergence**: ListenNow uses flex-centered underline; others use
  `marginLeft:50%` + translateX trick; ShoutoutFlagship has different
  URL color/size; DayInNuma adds tagline. Extract
  `src/primitives/PayoffSection.tsx` with props for the variants. M,
  low.

### NanoClaw integration — 5 P1s

- **F-nanoclaw-2** (wiring-correctness) — Confirm route accepts
  arbitrary `action` string; should validate against `ACTION_ROUTES`
  allowlist before injecting into system message. S, low.
- **F-nanoclaw-3** (wiring-correctness) — Confirm route's `args`
  validated only as `typeof === "object"`. Add per-action schema.
  M, low.
- **F-nanoclaw-7** (reliability) — Zero test coverage for chat routes
  + 12 tool endpoints. Add tests for auth failure, malformed JSON,
  confirm races, tool failures. L, low.
- **F-nanoclaw-10** (sec) — `action-chips.tsx:56-71` renders
  `resultSummary` as plain text (escaped by React, safe today) but
  without explicit sanitization. Document or sanitize. S, low.
- **F-nanoclaw-11** (wiring-correctness) — Confirm route system-message
  injection uses template strings with user-provided `confirmId` +
  `action` without escaping. If the format ever allows special chars,
  could malform. Sanitize. S, low.
- **F-nanoclaw-14** (sec) — `/api/chat/send` trusts
  `cf-access-authenticated-user-email` without verifying CF Access
  JWT. Same pattern as F-backend-5 (same auth assumption). M, medium.

### Cross-cutting — 10 P1s

- **F-crosscut-1** (dry) — `scripts/cleanup-b2-old-versions.ts` no
  dry-run. Copy pattern from `purge-orphan-shoutouts.ts`. S, low.
- **F-crosscut-2** (sec) — Theme A. 3 main-repo internal routes use
  non-timing-safe compare. S, low.
- **F-crosscut-3** (sec) — `logs/*.log` (~440 KB of Obsidian MCP
  dev-session logs) tracked in git. Add `logs/` to `.gitignore` + `git
  rm -r --cached logs/`. S, low.
- **F-crosscut-4** (dead-code) — `lib/radio-host.ts` +
  `lib/strip-markdown.ts` in main repo are unreferenced; dashboard
  has its own divergent copies. Delete main-repo copies. S, low.
- **F-crosscut-5** (deps) — Videos repo commits 12 MB of MP3/PNG
  binaries under `src/assets/`. Either accept (current) or move
  sources-of-truth to B2 + regenerate. M, low.
- **F-crosscut-6** (sec) — Theme A. 5 dashboard non-tools internal
  routes. S, low.
- **F-crosscut-10** (sec) — Theme C. No security headers. M, medium
  (CSP breakage risk — use Report-Only first).
- **F-crosscut-12** (test-gap) — Theme D. No tests for
  `/api/internal/track-started`, `shoutout-started`, `shoutout-ended`
  webhook idempotency. M, low.
- **F-crosscut-13** (test-gap) — No tests for
  `lib/delete-aired-shoutout.ts`. Only the allowlist guard prevents
  music deletion — pin it. S, low.
- **F-crosscut-14** (test-gap) — No tests for
  `app/api/booth/submit/route.ts` rate-limit + moderation integration.
  M, low.

---

## P2 findings (backlog)

### Public site — 10 P2s

- **F-public-3** (dry) — Lena "Alright, night owls…" placeholder
  quote duplicated in 3 player components. S, low.
- **F-public-8** (a11y) — `<div role="button">` on PlayerCard +
  MiniPlayer. Convert to `<button>` or separate overlay button. M,
  low.
- **F-public-9** (a11y) — `add-to-home-screen` step-row has no
  keyboard affordance. S, low.
- **F-public-10** (perf) — `SongTab.tsx:245-255` uses `<img>` + ESLint
  suppression instead of `next/image` for generated artwork. S, low.
- **F-public-11** (a11y) — Artwork uses CSS `background-image`
  (invisible to screen readers, can't use lazy-loading). Move to
  `<Image>` + `alt`. M, low.
- **F-public-12** (seo) — `sitemap.ts` uses `new Date()` for ALL URL
  `lastModified`. Crawlers re-crawl everything endlessly. Set static
  dates for privacy/about/submit. S, low.
- **F-public-13** (seo) — Root metadata missing `images` property
  linking `/opengraph-image`. Social previews show no image. S, low.
- **F-public-14** (perf) — ListenerCount + HeroStats each start own
  polling loops (4+ fetches on home page). Singleton pattern like
  `useNowPlaying`. M, low.
- **F-public-15** (reliability) — Nav uses `<a href="/#req">` instead
  of `<Link>` — full page nav from subroutes. S, low.
- **F-public-17** (dry) — `ep-shell` CSS media-query block duplicated
  at lines 66-72 and 105-111 in `_expanded-player.css`. Delete second
  copy. S, low.

### Dashboard UI — 4 P2s

- **F-dash-3** (perf) — On-Air Log filter chips recompute counts
  inline × 5 per render. `useMemo` like library page. S, low.
- **F-dash-10** (dry) — `DaemonPush`/`DaemonFailure`/
  `DaemonStatusResponse` interfaces duplicated in library + shoutouts
  pages. Move to `dashboard/lib/types.ts`. S, low.
- **F-dash-12a** (responsive) — Library sticky bar uses hardcoded
  `top-14`. Document coupling to nav height or extract CSS var. S,
  low.
- **F-dash-12b** (dx) — `.dark` CSS block in `globals.css` is dead —
  `<html>` has no `class="dark"`. All shadcn `dark:` variants are
  inert. Add `className="dark"` to html. S, low.

### Backend + workers — 4 P2s

- **F-backend-15** (sec) — `moderate.ts` error reason like
  `moderator_http_429` can reach response body via `detail` field. Map
  to generic messages. S, low.
- **F-backend-16** (perf) — `SiteVisitor` sweep window (5min) vs.
  dashboard count window (1min) mismatch — departed users stay
  "active" for ~4min. Align or document. S, low.
- **F-backend-18** (reliability) — `StationConfigCache` 30s TTL means
  operator-triggered mode changes take up to 30s to reflect in
  daemon. One extra chatter break possible post-revert. Expose
  `/invalidate-config` or lower TTL to 10s. S, low.
- **F-crosscut-7** (sec) — `app/api/booth/submit/route.ts:245`
  persists raw `e.message` to DB `moderationReason`. Classify before
  writing. S, low.

### Broadcast infra — 13 P2s

- **F-infra-3** (observability) — `liquidsoap/numa.liq:239-244`
  smooth_add `p=0.3` but comment says "50%". Fix to `p=0.5` OR update
  comment. S, low.
- **F-infra-10** (observability) — Liquidsoap has no HTTP health
  endpoint. Add internal `output.http(...)` on a loopback port. M,
  low.
- **F-infra-11** (reliability) — Liquidsoap HTTP callbacks don't
  retry on failure. NowPlaying gap on transient blips. M, low.
- **F-infra-12** (sec) — Windows scheduled task runs `wsl.exe ... -u
  marku -- /bin/sleep infinity` with S4U. Privilege path via SYSTEM
  escalation. Acceptable for personal mini-server. L, low.
- **F-infra-14** (reliability) — `SupervisedSocket` reconnect backoff
  has no jitter. Thundering-herd risk. S, low.
- **F-infra-15** (reliability) — `refresh-rotation.ts` temp file uses
  `Date.now()` only; collision possible (rare). Add `crypto.randomBytes`.
  S, low.
- **F-infra-16** (observability) — No explicit log rotation config
  per unit. Systemd-journald has defaults but not documented. S, low.
- **F-infra-18** (sec) — Sudoers allows `reload cloudflared` without
  rate-limit/confirm. Operator can drop tunnel mid-stream. Document
  the pitfall. S, low.
- **F-infra-19** (reliability) — No explicit Prisma connection pool
  size for queue-daemon. Neon pooler helps. Document. S, low.
- **F-infra-21** (reliability) — No circuit-breaker on Neon retries.
  Daemon `/status` can hang during Neon outage. M, medium.
- **F-infra-22** (dx) — Liquidsoap config hardcodes daemon URLs as
  fallback defaults. Env vars exist but defaults should match deploy.
  S, low.
- **F-infra-23** (reliability) — Theme F. Playlist URLs not
  URL-encoded. Currently safe (B2 URLs are RFC-safe). S, low.
- **F-infra-24** (reliability) — `numa-dashboard.service` missing
  from `deploy/systemd/` template (sudoers references it). Commit the
  unit file. S, low.

### Videos repo — 6 P2s

- **F-videos-2** (dry) — `musicDuckEnvelope` logic duplicated 3× in
  compositions because `MusicBed` primitive's `VolumeEnvelope` doesn't
  support ducking. Extend envelope type + dedupe. M, low.
- **F-videos-3** (dx) — `MeetLena.tsx:23-32` header comment has stale
  beat-map frame numbers post-53s-trim. S, low.
- **F-videos-4** (dry) — `Waveform.tsx:76` hardcodes `COLORS.accentGlow`
  for box-shadow regardless of `color` prop. White waveforms get teal
  glow. Add `glowColor` prop. S, low.
- **F-videos-5** (dx) — `ffmpeg-static` pinned with `^5.2.0` — minor
  bump could change codec defaults. Pin exact. S, low.
- **F-videos-6** (perf) — `SongRequestDemo` `<Img>` mounted/unmounted
  across Sequence boundaries (3 copies), potential 1-frame decode
  gap. Hoist to composition level. M, low.
- **F-videos-7** (render-correctness) — Voice clip `<Sequence>` has
  no `durationInFrames` in DayInNuma + MeetLena. Audio can bleed into
  next beat. Cap durations. S, low.

### NanoClaw integration — 9 P2s

- **F-nanoclaw-4** (sse-robustness) — SSE stream orphaned briefly
  when tab closes mid-confirm. Minor resource leak. L, low.
- **F-nanoclaw-5** (race) — `resolveConfirm()` updates UI
  optimistically before POST completes. If POST fails, UI lies about
  tool execution. Move updates after fetch. M, low.
- **F-nanoclaw-6** (reliability) — No rate-limit on `/api/chat/send`.
  Spec called this "YAGNI for now." Reconsider after some use. S, low.
- **F-nanoclaw-8** (dry) — Tool response truncated to 200 chars in
  confirm route but inconsistently elsewhere. Centralize constant. S,
  low.
- **F-nanoclaw-9** (dx) — Confirm card has no timeout display or
  stale-on-reload detection. Operator could approve stale action. M,
  low.
- **F-nanoclaw-12** (race) — `library-push` reads track then pushes,
  but track could be deleted between the two. Atomize or re-validate.
  M, low.
- **F-nanoclaw-13** (wiring-correctness) — `autochatter-toggle` GET
  returns `enabled: mode !== "forced_off"` — in `auto` mode returns
  `enabled: true` which doesn't match POST's `enabled` semantics. Doc
  or fix. S, low.
- **F-nanoclaw-15** (dx) — `ACTION_ROUTES` allowlist not linked to
  spec. Agent trying a new yellow-light action gets 400 with no
  escalation path. Comment + better error. S, low.

### Cross-cutting — 8 P2s

- **F-crosscut-8** (dx) — Main repo has no `.env.local.example`.
  Extract from CLAUDE.md. S, low.
- **F-crosscut-9** (dx) — Dashboard + videos repos lack ESLint
  configs. Dashboard's `npm run lint` fails silently. S, low.
- **F-crosscut-11** (dx) — Already-executed one-shot scripts
  (`migrate-publicurl-to-cdn.ts`, `backfill-*`, `demote-listener-songs.ts`)
  sit in `scripts/` inviting accidental re-runs. Move to
  `scripts/archive/`. S, low.
- **F-crosscut-15** (dry) — `scripts/backfill-*.ts` + migrate +
  demote all lack `--dry-run` flags. Add uniformly. S, low.
- **F-crosscut-16** (dx) — Dashboard has no `.gitignore` of its own
  (root covers it). Optional self-describing ignores. S, low.
- **F-crosscut-17** (dry) — `preview-chatter.ts` burns ~8 MiniMax
  calls with no confirmation prompt. Add one. S, low.
- **F-crosscut-18** (test-gap) — `workers/queue-daemon/icecast-listeners.test.ts`
  may not cover all fail-closed modes (HTML body, 500, connection
  refused, partial JSON). Verify and fill gaps. S, low.

---

## Sanity-check notes (P0 → P1 downgrades)

- **F-infra-1** (Liquidsoap unit missing) — VERIFIED missing from
  repo but CONFIRMED running live at `/etc/systemd/system/`. Config
  drift is real; active broadcast risk is not. Downgraded to P1.
- **F-crosscut-1** (cleanup-b2-old-versions.ts no dry-run) — VERIFIED
  script is mass-delete but operates only on `IsLatest=false`
  versions (by definition not served). Bounded blast radius.
  Downgraded to P1.

## Notable non-findings (things the audit specifically vetted and passed)

- Zero TODO/FIXME/HACK/XXX markers across all extensions in both repos.
- `station-flag.ts` → `station-config.ts` replacement clean (old file
  gone per HANDOFF spec).
- `.vercelignore` correctly excludes `scripts/` + `nanoclaw-groups/`
  per the e73c710 fix.
- `npm audit` across 3 repos: 0 high, 0 critical prod vulns. 12
  moderates are all build-time/transitive with no concrete exposure.
- Dashboard auth (CF Access outer gate) is the right design for a
  solo operator dashboard — findings around it are defense-in-depth,
  not architectural problems.
- NanoClaw integration wiring matches the design spec. All 12 tools
  present and functioning.
- Queue-daemon loopback binding (127.0.0.1:4000) is correct; no
  risk of accidental 0.0.0.0.
- No secrets in committed files (pattern scan clean).
- Chat UI renders agent messages as plain React children (no raw-HTML
  injection sinks).
- Timing-safe compare used correctly in
  `dashboard/lib/internal-auth.ts` (and 12 tool routes use it).
- React 18 in videos repo is intentional (Remotion 4 constraint) —
  not a version-mismatch bug.

## Recommended fix sequence

**Session 1 (today, ~2-3 hours):**
1. **Theme A — timing-safe compare** (fixes P-2 + F-crosscut-2 +
   F-crosscut-6 — 9 routes in one PR). [S]
2. **P-1 — XFF spoofing** (`lib/rate-limit.ts`). [S]
3. Verify `dashboard/lib/internal-auth.ts` behavior in-situ.
4. Smoke test booth shoutout + one dashboard approve/reject.
5. Commit + deploy.

**Session 2 (~2-3 hours, public-site polish):**
6. Theme C — security headers (Report-Only CSP first). [M]
7. F-public-1/-2/-5/-6/-7/-16 — public-site SEO + a11y sweep. [S each]
8. F-public-4 (hardcoded B2 artwork). [S]
9. Deploy, watch CSP report.

**Session 3 (~2-3 hours, dashboard UX):**
10. F-dash-8/-9/-11 — error-handling toast additions. [S each]
11. F-dash-2/-10 — dedupe `fmtRelative` + types. [S]
12. F-dash-4/-5/-6/-7 — a11y fixes. [S + M]
13. F-dash-12b — add `className="dark"` to html. [S]
14. Dashboard deploy.

**Session 4 (~3-4 hours, Theme B timeouts + Theme F URL hardening):**
15. F-backend-6/-7/-8/-17 — external-call timeouts. [S each]
16. F-backend-12 — queue-daemon URL validation. [S]
17. F-infra-4 — Liquidsoap HTTP timeouts. [S]
18. F-infra-17 — Icecast early-connect check. [M]
19. Restart queue-daemon + song-worker + Liquidsoap (one at a time,
    verify each).

**Session 5 (~3-4 hours, infra hardening):**
20. F-infra-1 — commit Liquidsoap unit file. [S]
21. F-infra-6/-7 — StartLimitBurst on queue-daemon + song-worker. [S]
22. F-infra-9 — `/etc/numa/env` → 0600. [S]
23. F-infra-24 — numa-dashboard.service committed. [S]
24. F-crosscut-3 — logs/ gitignore + cached-rm. [S]
25. F-crosscut-4 — delete dead main-repo lib files. [S]

**Session 6 (~3-4 hours, observability + idempotency):**
26. F-dash-1 — listener poll via usePolling. [S]
27. Theme D cluster — webhook idempotency + tests (F-backend-9,
    F-backend-10, F-crosscut-12/-13/-14). [M-L]
28. F-infra-13/-20 — queue-daemon `/status` error fields. [M]

**Session 7+ (backlog):**
- Remaining P1s (videos DRY, NanoClaw validation, F-crosscut-10
  enforce CSP).
- All P2s on a slow-drip basis.

## Open questions for user

1. **Theme D (webhook idempotency)** requires a Liquidsoap config
   change (pass trackId in callback body). Worth the restart risk,
   or live with the current design (guarded by
   `delete-aired-shoutout.ts` allowlist)?
2. **F-nanoclaw-14 / F-backend-5** — CF Access JWT verification.
   Worth doing as defense-in-depth, or accept the CF-edge trust?
3. **F-backend-14** (rate-limit TOCTOU) — accept as documented
   design limit, or fix with advisory lock?
4. **F-crosscut-5** (videos repo 12MB assets) — accept committed or
   move to B2-sourced?
5. **F-backend-11** (approveShoutout status race) — fix or document?
6. **F-nanoclaw-7** (zero chat route tests) — L effort but bumps
   confidence significantly. Worth the session?
