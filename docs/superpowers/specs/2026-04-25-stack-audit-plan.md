# Stack Audit & Improvement Plan

Date: 2026-04-25
Status: Phase 1 — Audit orchestration (pre-dispatch)

## Goal

Produce a prioritized fix list covering every website pillar
(performance, SEO, security, responsive, accessibility, DRY, best
practices, reliability, observability) across the full Numa Radio
stack. Then ship the fixes one at a time without breaking live
broadcast or production dashboard.

## Quality bar — NON-NEGOTIABLE for every agent

> Only flag issues that are **genuinely worth fixing**. Most of this
> codebase is well-built from the ground up. Do not nitpick style, do
> not propose refactors where the current code is already clear, do
> not recommend hypothetical future-proofing. If a reasonable engineer
> would look at the current code and say "that's fine," skip it.
>
> Every item you report must pass this bar: **"If we didn't fix this,
> something concrete would be worse — slower, less secure, harder to
> maintain, or broken on some device."**

## Scope

**In scope:**
- Public site (`app/`, excluding `app/api`) — numaradio.com
- Public API + shared libs (`app/api/`, `lib/`)
- Dashboard (`dashboard/`) — dashboard.numaradio.com
- Workers (`workers/queue-daemon`, `workers/song-worker`)
- Scripts (`scripts/`) — one-shot CLIs
- Broadcast infra (`liquidsoap/`, `deploy/systemd/`, `deploy/windows/`)
- Videos repo (`~/saas/numaradio-videos/src/`)
- NanoClaw integration on **our side only**:
  `nanoclaw-groups/dashboard_main/`,
  `dashboard/app/api/chat/*`, `dashboard/app/api/internal/tools/*`,
  `dashboard/app/chat/page.tsx`, briefing copy in deploy steps
- Dependencies across all three repos
- Build configs, env var handling, secrets hygiene

**Out of scope:**
- Upstream NanoClaw fork (`/home/marku/nanoclaw/`) — do NOT inspect or
  recommend changes. Only verify our integration is wired correctly.
- Neon/Cloudflare/Vercel/Backblaze/Deepgram/MiniMax vendor-side
  configuration — we can recommend config changes but the agents can't
  verify those.
- Documentation prose quality in `docs/numa-radio/` (Obsidian vault).

## Stack snapshot (for agent context)

- **numaradio** (Next.js 16.2.4 + React 19.2.4, Tailwind v4, Prisma 6)
  — single package, no workspaces. Deployed to Vercel.
- **dashboard** (Next.js 16.2.4 + React 19.2.4, shadcn/Base UI, sonner,
  Tailwind v4) — sub-package inside same repo, runs on Orion via
  systemd.
- **workers** run on Orion as systemd units:
  - `numa-queue-daemon` (loopback :4000) — owns Liquidsoap telnet :1234
  - `numa-song-worker` — listener song-request pipeline
  - `numa-rotation-refresher.timer` every 2 min
- **Liquidsoap** — single config `liquidsoap/numa.liq`
- **Icecast** — 192 kbps stereo MP3 at `api.numaradio.com/stream`
- **NanoClaw** — separate fork at `/home/marku/nanoclaw/`, runs as
  systemd unit (non-root user), HttpChannel on loopback :4001, tools
  curl back into dashboard's `/api/internal/tools/*` with
  `INTERNAL_API_SECRET`.
- **Videos repo** (`~/saas/numaradio-videos/`) — Remotion 4 + React
  18, renders launch videos to `out/*.mp4`. Uses `ffmpeg-static`.

Node: `--experimental-strip-types` via `tsx`/`node --test`; memory
constraint: no param-property shorthand, test imports need `.ts`.

## Report format — every agent must use this

Each finding:

```
### F-<area>-<n>: <one-line title>
**Severity:** P0 / P1 / P2
**Category:** perf / sec / seo / a11y / responsive / dry / reliability / observability / dx
**File(s):** path:line or path
**Problem:** 1-2 sentences, concrete. What goes wrong, to whom.
**Fix sketch:** 1-3 sentences. What to change.
**Effort:** S (< 1 hr) / M (1-3 hr) / L (> 3 hr)
**Risk of breaking prod:** low / medium / high
```

Priority definitions:

- **P0** = user-visible bug, security hole, data loss risk, or live
  broadcast can drop. Ship same-session.
- **P1** = meaningful UX/perf/maintainability win, no user harm yet.
  Ship within a week.
- **P2** = nice-to-have improvement, small win, edge case.

Agents that exceed 25 findings in one area should trim to the top 25
by impact. We'd rather 25 high-signal items than 80 noisy ones.

## Agent fan-out plan

Seven parallel read-only agents. Each gets: scope, quality bar,
report format, caveats. No agent writes code or touches git.

### Agent 1 — Public site (numaradio.com)

**Type:** code-reviewer
**Scope:** `app/` (excluding `app/api/*`), `app/_components/`,
`app/styles/`, `app/globals.css`, `app/layout.tsx`,
`app/opengraph-image.tsx`, `app/manifest.ts`, `app/sitemap.ts`,
`app/robots.ts`, `app/icon.tsx`, `app/apple-icon.tsx`.
**Pillars:** perf (bundle, LCP, CLS, INP, image opt, font loading,
SSR/ISR decisions, caching), SEO (meta, OG, canonical, structured
data, sitemap coverage, robots), a11y (contrast, keyboard, focus
order, ARIA, alt text, motion), responsive (320-1920 coverage, touch
targets, safe-area), DRY, client/server component boundaries, security
headers, CSP opportunities.
**Verify:** public site is SSR'd now (per recent commit 4f5005f),
mobile polish landed (commits f57f656, feae0cf) — don't flag things
already done.
**Deliverable:** markdown report, findings grouped by pillar.

### Agent 2 — Dashboard frontend (dashboard.numaradio.com UI)

**Type:** code-reviewer
**Scope — FRONTEND ONLY:**
- `dashboard/app/*/page.tsx` and `dashboard/app/*/layout.tsx` (all
  routes: library, shoutouts, chat, root, etc.)
- `dashboard/components/**`, `dashboard/hooks/**`
- `dashboard/lib/**` (shared client libs)
- `dashboard/app/globals.css`, tailwind config
**Explicitly out of scope for this agent:**
- `dashboard/app/api/**` (Agent 3 owns non-chat dashboard APIs,
  Agent 6 owns chat + internal/tools APIs)
- `dashboard/app/chat/page.tsx` (Agent 6)
**Pillars:** perf, a11y, DRY (check for duplicated shadcn
primitives), component boundaries, error states, loading states,
typing rigor, optimistic UI failure modes, responsive (operator may
be on phone).
**Verify:** Cloudflare Access is the outer gate (dashboard is
operator-only, not public); shadcn/Base UI is the design system;
sonner for toasts.
**Deliverable:** markdown report.

### Agent 3 — Backend: all non-NanoClaw APIs + shared libs + workers

**Type:** code-reviewer
**Scope:**
- **Public API (numaradio.com):** `app/api/**` — booth/*, internal/*,
  presence/*, station/*, vote/*
- **Dashboard backend APIs (non-NanoClaw):**
  `dashboard/app/api/bandwidth/*`, `dashboard/app/api/generate/*`,
  `dashboard/app/api/internal/shoutout*` (the NON-tools internal
  shoutout routes), `dashboard/app/api/library/*`,
  `dashboard/app/api/logs/*`, `dashboard/app/api/services/*`,
  `dashboard/app/api/shoutouts/*`, `dashboard/app/api/station/*`,
  `dashboard/app/api/status/*`
- **Shared:** `lib/**`
- **Workers:** `workers/queue-daemon/**`, `workers/song-worker/**`
- **Scripts (security hygiene only, not code quality):** `scripts/**`
**Explicitly out of scope for this agent:**
- `dashboard/app/api/chat/**` + `dashboard/app/api/internal/tools/**`
  (Agent 6)
- Broadcast infra files like `liquidsoap/numa.liq` and systemd units
  (Agent 4)
**Pillars:** security (authN/authZ, rate limiting, input validation,
SSRF, prototype pollution, SQL injection via Prisma raw, secret
exposure in logs, timing attacks on secret comparison), DRY
(duplicated logic across routes — especially since same operations
exist in public API AND dashboard backend), error-handling
consistency, structured logging, observability (can we diagnose an
incident from logs alone?), Prisma query efficiency (N+1s, missing
indexes, over-fetching), timeouts/retries/circuit-breakers on
external calls (MiniMax, Deepgram, B2, Icecast, OpenRouter),
idempotency of webhook-shaped endpoints (Liquidsoap callbacks), race
conditions (concurrent auto-host toggle, concurrent shoutout
approval).
**Context:** `INTERNAL_API_SECRET` guards Liquidsoap → dashboard
callbacks, NanoClaw tool curls, and cross-app internal routes.
Booth endpoints are open to the internet behind Cloudflare but have
IP rate limits.
**Deliverable:** markdown report. Security findings MUST lead.

### Agent 4 — Broadcast infra reliability

**Type:** Explore (very thorough)
**Scope:** `liquidsoap/numa.liq`, `deploy/systemd/*`,
`deploy/windows/install-autostart.ps1`, `workers/queue-daemon/*`
(infra angle only — code quality covered by Agent 3),
`scripts/refresh-rotation.ts`.
**Pillars:** reliability (what happens if Liquidsoap crashes? queue
daemon crashes? B2 404s mid-track? Icecast unreachable?),
observability (what journal lines tell us prod is fine vs. broken?),
security (ICECAST_SOURCE_PASSWORD handling, sudoers scope,
loopback-only binding verification), listener failure modes (stream
drops, rebuffering).
**Also check:** is there any single-point-of-failure we can harden?
Crash-loop protection in systemd units? Log rotation? Disk pressure?
**Out of scope for this agent:** code quality of TypeScript (Agent 3
owns that).
**Deliverable:** markdown report.

### Agent 5 — Videos repo (numaradio-videos)

**Type:** code-reviewer
**Scope:** `~/saas/numaradio-videos/src/` — compositions, primitives,
tokens, scripts, assets loader.
**Pillars:** DRY (HANDOFF already flags `PayoffSection` used 5× and
`musicDuckEnvelope` written 3× — verify + find more), render
correctness, tokens/theming consistency, TypeScript rigor, asset
loading patterns, render script robustness (error handling, exit
codes, nice/concurrency caps), ffmpeg-static version pinning,
security (no API keys in committed code).
**Note:** React 18 here vs React 19 in numaradio is INTENTIONAL
(Remotion 4 constraint), not a bug.
**Deliverable:** markdown report.

### Agent 6 — NanoClaw integration (our side only)

**Type:** Explore (very thorough)
**Scope:**
- `nanoclaw-groups/dashboard_main/CLAUDE.md` — briefing content
- `dashboard/app/api/chat/send/`, `stream/`, `history/`, `confirm/`,
  `clear/` — proxy routes to HttpChannel
- `dashboard/app/api/internal/tools/` — 12 tool endpoints
  (autochatter-toggle, daemon-activity, library-push, library-search,
  logs-tail, nowplaying, service-restart, shoutout-approve,
  shoutout-list-held, shoutout-list-recent, shoutout-reject,
  song-generate)
- `dashboard/app/chat/page.tsx`, `dashboard/components/chat/*`,
  `dashboard/hooks/use-chat-stream.ts`
- `dashboard/lib/internal-auth.ts`, `dashboard/lib/chat-proxy.ts`
- Deploy steps in `docs/HANDOFF.md` regarding briefing copy,
  `.auth` file, env setup
**Pillars:** wiring correctness (does each tool match the design
spec?), auth (`INTERNAL_API_SECRET` timing-safe usage, no leakage via
logs/errors, CRLF handling in `.auth` per HANDOFF note), SSE
robustness (reconnect, back-pressure, orphaned streams),
confirmation-flow correctness (yellow-light actions lock composer
correctly?), race conditions between auto-host toggle and chat-driven
toggle, tool-call injection risk (can a crafted message exploit an
action chip?).
**DO NOT:** inspect `/home/marku/nanoclaw/` source. Treat NanoClaw as
a black box with a documented contract (HttpChannel on 127.0.0.1:4001,
SSE events, action/confirm tags).
**Reference:** design spec
`docs/superpowers/specs/2026-04-23-dashboard-nanoclaw-chat-design.md`.
**Deliverable:** markdown report.

### Agent 7 — Cross-cutting

**Type:** general-purpose
**Scope:** repo-wide.
**Pillars:**
- **Dependencies:** outdated packages, known CVEs (run `npm audit` in
  both `numaradio/` and `dashboard/` and `numaradio-videos/` — report
  real vulns, skip dev-only moderate issues unless concrete), license
  concerns, duplicate deps between dashboard and root.
- **Build configs:** `next.config.ts` (both), `.vercelignore`,
  `tsconfig.json`, ESLint configs — anything weak or outdated?
- **Secrets hygiene:** any accidental secret in committed files? Is
  every `.env.local`-style file gitignored? Any hardcoded URLs that
  should be env? Any secret in error messages or logs?
- **TODO/FIXME/HACK:** grep all three repos, report any found with
  context. (Quick pre-scan showed zero, but confirm including
  `.liq`, `.md`, `.sh`, `.ts`.)
- **Gitignored-but-committed**: files in git that should be ignored.
- **Scripts safety:** `scripts/*.ts` running destructive ops — do they
  have dry-run modes? Confirmation prompts for prod data?
- **Test coverage gaps:** which critical paths have zero tests?
  (Quality bar: only flag HIGH-risk paths with no coverage, not every
  file.)
- **Dead code:** unused exports, unused files, orphan components.
  Cross-check with tokenstack if available.
**Deliverable:** markdown report.

## Report consolidation

After all agents return, I will:

1. Merge all 7 reports into
   `docs/superpowers/specs/2026-04-25-stack-audit-findings.md` with
   findings re-numbered globally and grouped by severity.
2. Present a summary table to you: counts by area × severity.
3. You review + veto any findings you disagree with.
4. For each P0 / P1 that survives: create a TaskCreate entry.
5. Execute fixes one at a time, per-area, lowest-risk first. Each
   fix gets its own plan (via writing-plans skill) if it's non-
   trivial; small fixes just get done.
6. `frontend-design` skill engaged for any UI change per your
   standing instruction.

## Non-goals of this audit

- No refactors "because it'd be cleaner." The codebase was built from
  scratch by one person; arbitrary refactors add risk without
  benefit.
- No framework migrations.
- No design system overhaul.
- No new features hidden inside "fixes."

## Risk management during fix phase

- **Live broadcast guard:** any fix touching `workers/queue-daemon`
  or `liquidsoap/` requires `systemctl restart` — drop-listeners risk
  is ~2-5 seconds. Batch these fixes; don't restart the daemon 8×
  in one session.
- **Dashboard deploys:** `npm run deploy` rebuilds and restarts. Fine
  to do many times; ~10s downtime per deploy. Cloudflare Access gates
  it so no public impact.
- **Vercel deploys:** every main push deploys automatically. Fine to
  iterate.
- **Prisma migrations:** order of operations matters (migration before
  daemon restart, per HANDOFF). Any schema change in audit fixes will
  be called out explicitly.
- **NanoClaw side:** out of scope.

## Checkpoints where I stop and check with you

1. After all 7 agents return + consolidated report is written — you
   read the findings doc, veto anything.
2. After each P0 fix lands — I confirm nothing broke before moving on.
3. End of session — we decide what carries into next session.
