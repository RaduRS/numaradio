# Stack Audit — Final Session Summary

Date: 2026-04-25
Closes the audit started in
`2026-04-25-stack-audit-plan.md` (findings doc:
`2026-04-25-stack-audit-findings.md`).

## Top-line

- **9 sessions, 9 commits**, all deployed (Vercel auto-deploy + dashboard
  `npm run deploy` + manual `systemctl restart` for daemon and Liquidsoap
  per session).
- **2 P0 security bugs** closed in Session 1 (XFF rate-limit spoofing +
  the only non-timing-safe internal-secret comparison).
- **~65 findings closed** out of ~111 in the audit. The rest are
  intentionally deferred — see "Deferred (with reasoning)" below.
- **Tests grew from 188 → 200** (root) and held steady at 40
  (dashboard). Both apps build clean.

## What shipped, by session

### Session 1 — P0 security fixes + Theme A (commit `466ab3f`)
- F-backend-2 (P0): `lib/rate-limit.ts` no longer takes the FIRST
  comma-split value of `x-forwarded-for`. Prefers `cf-connecting-ip`,
  then `x-real-ip`, then `x-vercel-forwarded-for`, with `x-forwarded-for`
  last-hop as the fall-back. 7 unit tests pin it.
- F-backend-1 (P0) + F-crosscut-2 + F-crosscut-6 (Theme A): extracted
  `lib/internal-auth.ts` mirroring the dashboard's helper, switched 9
  routes from `secret !== expected` to timing-safe `internalAuthOk()`.

### Session 2 — public site polish (commit `997a2b7`)
- F-public-1 / F-crosscut-10 (Theme C): added `headers()` to both
  `next.config.ts` files — X-Frame-Options DENY, X-Content-Type-
  Options nosniff, Referrer-Policy, Permissions-Policy, plus a
  `Content-Security-Policy-Report-Only` scoped to the actual
  origins. Edge-verified after deploy.
- F-public-2: JSON-LD moved from `next/script` afterInteractive to
  inline `<head>` so SSR-only crawlers see it.
- F-public-5: `prefers-reduced-motion` block in `_design-base.css`
  pauses EQ bars / marquee / pulse dots / slow glows.
- F-public-6: `ExpandedPlayer` restores focus to the triggering
  element on close.
- F-public-7: tab/tabpanel ARIA wired up on RequestForm (song/shout)
  and add-to-home-screen platform picker.
- F-public-16: `/add-to-home-screen` split into server-wrapper
  (owns metadata + canonical) + client component. Now prerenders
  static.
- F-public-4: `MOCK_ARTWORK` → committed `/public/mock-cover.svg`.

### Session 3 — dashboard UX polish (commit `3da9df9`)
- F-dash-2 + F-dash-10: extracted shared `dashboard/lib/fmt.ts`
  (`fmtRelative`) and moved `DaemonPush/Failure/StatusResponse` to
  `dashboard/lib/types.ts`.
- F-dash-1: listener-count poll migrated to `usePolling` (gets
  visibility-pause for free).
- F-dash-4: auto-chatter radiogroup now keyboard-navigable
  (Arrow/Home/End cycle through Auto · Forced On · Forced Off,
  roving tabIndex).
- F-dash-5: `aria-pressed` on filter chips (library + shoutouts).
- F-dash-6 / F-dash-7: `aria-label` on Compose textarea + library
  search input.
- F-dash-8: `setAutoHostMode` POST failures now `toast.error()`.
- F-dash-9: initial auto-host GET falls back to Auto + warning toast.
- F-dash-11: `service-row` toast paren bug fixed.
- F-dash-12b: `<html className="dark">` so shadcn `dark:` variants
  actually fire.

### Session 4 — Theme B (timeouts) + Theme F (URL hardening) (commit `77b4a64`)
- F-backend-6: 15s timeout on MiniMax moderator fetch + dedicated
  `moderator_timeout` reason.
- F-backend-7: 5s timeout on song-worker → queue-daemon push.
- F-backend-17: 30s timeout on MiniMax MP3 download.
- F-backend-8: 60s timeout on OpenRouter, 15s on remote-image
  follow-up. Validates the remote URL hostname is not localhost or
  RFC 1918 / link-local (SSRF defense).
- F-backend-12: new `validatePushUrl()` in queue-daemon /push
  rejects whitespace (telnet-injection) + non-http(s)/file schemes.
  6 unit tests pin it.
- F-infra-4: `timeout=5.` on the three Liquidsoap http.post calls.

### Session 5 — infra + hygiene (commit `830a254`)
- F-infra-1 + F-infra-24: committed `numa-liquidsoap.service` and
  `numa-dashboard.service` templates so the live config reproduces
  from source.
- F-infra-6 + F-infra-7: `StartLimitBurst` / `StartLimitIntervalSec`
  on all four units. Song-worker also dropped its `.env.local`
  optional-fallback (production reads `/etc/numa/env` only).
- F-infra-9: new `deploy/secure-numa-env.sh` (chmod 0600 root:root).
  *Operator must run with sudo.*
- F-crosscut-3: `/logs/` (~440 KB of MCP dev-session logs)
  gitignored + git-rm --cached.
- F-crosscut-4: deleted dead `lib/radio-host.ts` and
  `lib/strip-markdown.ts` (dashboard has its own divergent copies
  resolved via dashboard-local @/* paths).
- F-crosscut-8: new `.env.local.example`.
- F-crosscut-9: dashboard ESLint config (was a silent no-op before).
- F-crosscut-11: 5 already-executed one-shot scripts moved to
  `scripts/archive/` with a README explaining each.
- F-crosscut-1: `cleanup-b2-old-versions.ts` defaults to dry-run,
  requires `--confirm`.
- F-crosscut-17: `preview-chatter.ts` confirms before burning ~8
  MiniMax credits (`--yes` for CI).
- `tsconfig.json` excludes `scripts/archive` (broken-on-purpose
  relative imports there).

### Session 6 — observability + idempotency + tests (commit `338379b`)
- F-backend-3: `claim.ts` switched from `$queryRawUnsafe` to
  `$queryRaw` + `Prisma.sql` tagged template.
- F-backend-4: `ipc-writer.ts` asserts `dir` is absolute.
- F-backend-5: cf-access email shape-checked on dashboard
  approve/reject routes.
- F-backend-11: `approveShoutout` retries the post-generate UPDATE
  once with backoff; documents the shoutout-ended fallback.
- F-backend-18: `StationConfigCache` TTL 30s → 10s.
- F-backend-16: `SiteVisitor` sweep 5min → 2min, aligned with
  dashboard's 60s count window.
- F-crosscut-7: booth-submit error reason persisted as a controlled
  enum (`internal_forward_timeout` / `internal_forward_network`).
- F-crosscut-13: new `lib/delete-aired-shoutout.test.ts` (6 tests).
  Refactored to accept dependency-injected prisma + deleteObject.
- `lib/storage/index.ts`: added `.ts` extensions to relative
  re-exports (per-user memory's known node --strip-types constraint).

### Session 7 — NanoClaw + SEO + broad polish (commits `6360a9d` + videos `ea61d3b`)
- F-nanoclaw-3: per-action arg schema validation in /api/chat/confirm.
- F-nanoclaw-11: sanitize `confirmId` / `action` (`safeTag`) before
  injecting into NanoClaw's group.
- F-nanoclaw-15: `ACTION_ROUTES` comment links to the design spec.
- F-nanoclaw-13: documented the GET vs POST `enabled` semantic
  asymmetry on `autochatter-toggle`.
- F-nanoclaw-10: `ActionChips` strips control chars from `resultSummary`.
- F-public-13: root metadata.openGraph + .twitter now include
  `/opengraph-image` explicitly.
- F-public-12: `sitemap.ts` uses static per-route `lastModified`
  (home page keeps dynamic).
- F-public-15: `Nav` anchor links → `next/link`.
- F-public-17: removed duplicate `.ep-shell` mobile media-query
  block.
- F-dash-3: pre-computed per-kind counts via `useMemo` in On-Air Log.
- F-infra-3: `numa.liq` smooth_add p comment matches behavior (~30%/-10dB).
- F-infra-15: `refresh-rotation.ts` tmpfile appends 4 random bytes.
- F-videos-4: `Waveform` accepts `glowColor` prop.
- F-videos-5: `ffmpeg-static` pinned to 5.2.0 exactly.
- F-videos-3: `MeetLena` beat-map header comment matches the 53s trim.

### Session 8 — Theme D shoutout-ended + status visibility (commit `c2d1751`)
- F-backend-9: `notify_shoutout_ended` in Liquidsoap now passes
  `{sourceUrl}` in the body. `/api/internal/shoutout-ended` resolves
  trackId from the body (with NowSpeaking as legacy fallback).
  Double-fire is now properly idempotent — second fire still has
  the trackId in the body and `deleteAiredShoutout` short-circuits
  at `track_not_found`. Restarted Liquidsoap + queue-daemon.
- F-infra-20: queue-daemon `/status` now includes `lastHydrationError`
  ({ at, message } | null). Cleared on next successful hydrate.

### Session 9 — PlayHistory truthful ledger + reconnect jitter + step-row a11y (commit `74698d5`)
- F-backend-10: `track-started` closes out the previous still-open
  PlayHistory row (sets endedAt + completedNormally based on elapsed
  vs duration with 5s tolerance). Without a track-ended Liquidsoap
  callback this is the closest-to-truthful ledger we can get.
- F-infra-14: `SupervisedSocket` reconnect adds up to 1s jitter.
- F-public-9: add-to-home-screen step-row converted from `<div
  onClick>` to `<button aria-pressed>` with CSS reset to keep the
  visual identical.

## Memory updates

Two new entries written to per-user memory:
- **Listener-count-aware risk management** — when listeners=0, treat
  it as a maintenance window; bundle restart-heavy fixes.
- **Dashboard has orphan nested .git** — `cd dashboard && git
  status` hits a vestigial repo. Always run git from main repo path
  or use absolute paths.

## Deferred (with reasoning)

These passed the audit's quality bar but were not shipped this run.
Each has a clear "why" so a future session knows what to think
about before picking it up.

| ID | What | Why deferred |
|---|---|---|
| F-backend-14 | rate-limit TOCTOU | Documented as design limit. Concurrency-bypass overhead is bounded and the station's traffic doesn't approach the limit. |
| F-nanoclaw-7 | chat route tests (L) | Large effort. Worth a dedicated session. |
| F-nanoclaw-14 / F-backend-5 (CF JWT half) | CF Access JWT verification | Needs Cloudflare-side tokens + tooling. Format check shipped as defense-in-depth. |
| F-infra-2 | daemon /push 503 on socket-down | Risk: medium (changes caller-visible semantics). Needs careful retry-design conversation. |
| F-infra-5 | playlist file emergency fallback | Risk: medium (audio choice matters). Design needs thought before code. |
| F-infra-17 | Icecast password early-validate | Liquidsoap doesn't expose a clean pre-flight hook; a probe-then-config approach needs design work. |
| F-infra-21 | Neon circuit breaker | Adds a dep + state machine. Worth scoping before adding. |
| F-infra-25 | DB-level callback unique constraint | Schema change deferred — F-backend-9's body-trackId fix already closes the worst cleanup-loss case. |
| F-public-3 | Lena placeholder quote dedupe | The mobile variant is intentionally shorter (display constraint). Extracting a constant would require two constants — not worth the indirection. |
| F-public-8 | `<div role="button">` → `<button>` on PlayerCard/MiniPlayer | M effort, nested-button complications. Worth a focused session. |
| F-public-11 | Artwork as `<Image>` with alt | M effort across multiple components. Worth a focused session. |
| F-public-14 | ListenerCount/HeroStats singleton | M effort, requires a cross-component subscription pattern. |
| F-videos-1 / -2 / -6 / -7 | PayoffSection / duck envelope / Img hoist / voice durationInFrames | All require re-rendering all 5 launch videos to verify nothing regressed visually — a session where the user has time to QA the renders. |
| F-crosscut-5 | Videos repo 12MB assets | Accepted current state. Cost is bounded; moving to B2 + regenerate doesn't pay off until the asset count grows. |
| F-crosscut-12 | webhook idempotency tests | Partial coverage shipped via `lib/delete-aired-shoutout.test.ts`. Full coverage of all three callback routes would require Prisma test-doubles or a Postgres test container. |
| F-crosscut-14 | booth submit integration test | Same Prisma-mocking blocker. Worth a session that sets up a real Postgres container for tests. |
| F-infra-12 | Windows scheduled task privilege path | Acceptable for solo personal mini-server. Hardening requires a dedicated service account, complicates dev. |
| F-public-10 / F-dash-12a / F-infra-8/10/11/16/18/19/22/23 / F-nanoclaw-4-9 | misc low-impact P2s | Ran out of context. Pick up in any future polish session. |

## Operator follow-ups (need sudo / external action)

1. `sudo bash deploy/secure-numa-env.sh` — chmod 0600 on
   `/etc/numa/env`. One-time.
2. Re-install systemd unit templates so the new `StartLimitBurst`
   actually applies (deploy/systemd/ edits are documentation until
   installed):
   ```
   sudo install -m 0644 deploy/systemd/numa-queue-daemon.service /etc/systemd/system/
   sudo install -m 0644 deploy/systemd/numa-song-worker.service /etc/systemd/system/
   sudo install -m 0644 deploy/systemd/numa-liquidsoap.service /etc/systemd/system/
   sudo install -m 0644 deploy/systemd/numa-dashboard.service /etc/systemd/system/
   sudo systemctl daemon-reload
   ```
3. `sudo systemctl restart numa-song-worker` — picks up the timeout
   + SSRF additions (song-worker isn't in the sudoers allowlist so
   I couldn't restart it from here).
4. Watch the CSP Report-Only console in DevTools for a week or so;
   when nothing's flagged, flip `Content-Security-Policy-Report-Only`
   to `Content-Security-Policy` in both `next.config.ts` files to
   actually enforce the policy.

## Stats

```
Commits     : 9
Files       : ~60 touched
Tests       : 188 → 200 (root), 40 → 40 (dashboard)
Findings    : 65/111 shipped, 23 explicitly deferred, 23 P2 backlog
Restarts    : numa-queue-daemon ×4, numa-liquidsoap ×2, numa-dashboard ×3
Vercel      : 9 deploys (every push)
```
