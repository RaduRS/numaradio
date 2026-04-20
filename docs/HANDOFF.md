# Handoff — pick up where we are

Last updated: 2026-04-20 (listener booth + dashboard shoutouts panel live; `npm run deploy` + passwordless restarts)

## Where we are

**Phase 0 (Foundations) — DONE**
- Repo structure: `app/` `lib/` `workers/` `prisma/` `scripts/` `docs/` `liquidsoap/` `seed/`
- Prisma schema applied to Neon (one `init` migration in `prisma/migrations/`)
- B2 read + write + public-URL fetch verified
- Tailwind v4 design tokens wired (`@theme inline` in `app/globals.css`)
- Fonts: Archivo (variable, with wdth axis), Inter Tight, JetBrains Mono via `next/font/google`
- Dev server boots cleanly (`npm run dev` → `http://localhost:3000`)

**Phase 1 (Audible station) — DONE**
- ✅ Seed-ingest script working end-to-end (`npm run ingest:seed`)
- ✅ One real track ingested: "One More Dance" by Russell Ross
- ✅ Icecast + Liquidsoap installed on the mini-server (WSL2 Ubuntu)
- ✅ Liquidsoap config running, mount `/stream`, 192kbps stereo MP3
- ✅ Cloudflare Tunnel live — `https://api.numaradio.com/stream` publicly reachable

The station is live and listenable from any browser worldwide.

**Public site — now-playing + real listener count LIVE**
- Hero shows truthful title / artist / artwork fetched from Neon `NowPlaying`,
  pushed there by Liquidsoap's `on_track` → `POST /api/internal/track-started`
  (auth: `INTERNAL_API_SECRET` shared between Vercel env and `/etc/numa/env`).
- Public listener count via `/api/station/listeners` = `15 + real` (additive
  boost, not a floor — pressing play always nudges the counter).
- Tunnel now exposes `/status-json.xsl` in addition to `/stream` so the listener
  endpoint can read Icecast directly.
- See Decisions Log 2026-04-19 (night) for the Liquidsoap 2.2.4 metadata
  quirks that took the most time (`playlist.reloadable` hides the source URL
  in `initial_uri`, not `filename`).

**Phase 2 (Operator Dashboard) — LIVE**
- ✅ `https://dashboard.numaradio.com` running behind Cloudflare Access
- ✅ `numa-dashboard.service` enabled + active on Orion (Next.js on :3001)
- ✅ Controllable services: `icecast2`, `numa-liquidsoap` (cloudflared dropped from
  controls after it was clicked and killed its own tunnel — health row kept for
  visibility; see Decisions Log 2026-04-19 late evening)
- ✅ Cards: stream pills + now-playing, services (start/stop/restart + confirm
  dialog), health (Neon/B2/Tunnel), logs (journalctl tail)
- Spec: `docs/superpowers/specs/2026-04-19-operator-dashboard-design.md`
- Plan: `docs/superpowers/plans/2026-04-19-operator-dashboard.md`
- Acceptance checklist: `dashboard/ACCEPTANCE.md`
- To redeploy after a code change: `git pull && cd dashboard && npm run build && sudo systemctl restart numa-dashboard`

**Dashboard `/library` page — BUILT, needs restart to go live**
- ✅ New page at `https://dashboard.numaradio.com/library` for browsing the
  library and pushing a track to the priority queue with one click.
- ✅ Search by title/artist, filter by `trackStatus` (ready/draft/failed/other),
  table with artwork thumbnails, duration, genre, status badge.
- ✅ "Play Next" button per row → `POST /api/library/push` → forwards to
  `http://127.0.0.1:4000/push` (the existing queue daemon). Reason is recorded
  as `dashboard:<cf-access-email>` for audit.
- ✅ "Recent priority pushes" panel below the table reads the daemon's
  existing `/status` endpoint (`lastPushes` + `lastFailures`), polled every 5s.
- ✅ Nav link from main dashboard header: "Library →".
- ✅ 18 unit tests for `dashboard/lib/library.ts` (all pass: `cd dashboard && npm test`).
- ✅ `cd dashboard && npm run build` compiles cleanly.
- ⚠ **Running service still on old build.** The build artifact is in
  `dashboard/.next/` on Orion, but `sudo systemctl restart numa-dashboard`
  needs an interactive password, so Claude could not flip it live. To ship:
  ```bash
  sudo systemctl restart numa-dashboard
  # then verify:
  curl -s http://127.0.0.1:3001/api/library/tracks | jq '.tracks | length'
  ```
- Spec: `docs/superpowers/specs/2026-04-20-dashboard-library-card-design.md`

**On-demand queue + Neon rotation — LIVE**
- ✅ `numa-queue-daemon.service` active on Orion, loopback `:4000`. Exposes
  `POST /push`, `POST /on-track`, `GET /status`. Owns a persistent telnet
  connection to Liquidsoap at `127.0.0.1:1234` with exponential reconnect.
- ✅ `numa-rotation-refresher.timer` active, firing every 2 min (plus
  `OnBootSec=30s`). Regenerates `/etc/numa/playlist.m3u` from Neon:
  library tracks (`trackStatus='ready' AND airingPolicy='library'`) minus
  the last 20 `PlayHistory` entries, Fisher–Yates shuffled, atomic tmp→rename.
- ✅ `liquidsoap/numa.liq` now uses `fallback(track_sensitive=true, [priority, rotation, blank()])`.
  Priority requests air at the next track boundary, never mid-song.
  `on_track` callback POSTs to both Vercel (`/api/internal/track-started`)
  AND the local daemon (`/on-track`) so queue-item transitions don't
  depend on Vercel. Telnet idle timeout disabled
  (`settings.server.timeout.set(-1.)`) — see Decisions Log 2026-04-20 for why.
- ✅ `app/api/internal/track-started/route.ts` writes `PlayHistory` alongside
  `NowPlaying` in one transaction so rotation's "avoid recent N" filter
  has a reliable source of truth.
- ✅ Manual CLI: `npm run queue:push -- --trackId=<id> [--reason=<text>]`.
- ✅ 27 unit tests: `npm test`.

**NanoClaw integration seam:** when NanoClaw exists, its final step is `POST http://127.0.0.1:4000/push` with `{ trackId, sourceUrl, requestId?, reason? }`. No protocol negotiation — just that one call.

**Shoutout pipeline via NanoClaw — LIVE end-to-end (2026-04-20)**
- ✅ Dashboard endpoint `POST /api/generate/shoutout` at
  `dashboard/app/api/generate/shoutout/route.ts`. Body:
  `{ text, sender?, requestId? }` (2000-char cap). Flow: radio-host transform →
  Deepgram Aura (`aura-2-asteria-en` = "Lena", fallback `aura-asteria-en`) →
  MP3 → B2 `stations/numaradio/tracks/{id}/audio/stream.mp3` →
  `Track` + `TrackAsset` rows (`sourceType=external_import`,
  `airingPolicy=request_only`, `safetyStatus=approved`,
  `trackStatus=ready`, `artistDisplay="Lena"`) →
  `POST :4000/push` via `pushToDaemon()`. Track id is `crypto.randomUUID()`
  (raw pg in the dashboard, not Prisma — the public site/root app keeps the
  Prisma stack).
- ✅ Helpers ported from `~/examples/read-for-me` into
  `dashboard/lib/radio-host.ts` and `dashboard/lib/strip-markdown.ts`.
- ✅ Dashboard bind fix: `dashboard/package.json` start script is now
  `next start -H 0.0.0.0 -p 3001` (previously bound IPv6-only so Docker
  containers on the IPv4 bridge got `connection refused`).
- ✅ NanoClaw agent is briefed via `groups/*/CLAUDE.md` "Numa Radio" section
  to curl the endpoint from inside the container using
  `http://host.docker.internal:3001/api/generate/shoutout`.
- ✅ Confirmed end-to-end: Telegram `@nanoOrion_bot` → agent (MiniMax-M2.7
  brain via NanoClaw's credential proxy) → dashboard endpoint →
  Deepgram → B2 → Neon → queue → Liquidsoap → aired on stream.
- **To redeploy after a code change:** `cd dashboard && npm run build &&
  sudo systemctl restart numa-dashboard` (unit owns `/etc/systemd/system/`,
  requires sudo password — agents cannot restart this).

**NanoClaw location:** `/home/marku/nanoclaw/` on this machine (separate repo).
The user's fork is `mark-blue-evans/nanoclaw` with `upstream` →
`qwibitai/nanoclaw`. NanoClaw uses **MiniMax-M2.7** as the agent brain (not
real Claude) — its credential proxy rewrites outbound Anthropic-SDK requests
to the MiniMax endpoint. See
`/home/marku/.claude/projects/-home-marku-nanoclaw/memory/project_numaradio_integration.md`.

**Listener booth — LIVE (2026-04-20)**
- ✅ Public shoutout form on `numaradio.com` (the existing `Requests` homepage
  tab). POSTs to Vercel `POST /api/booth/submit` which does:
  IP rate-limit (3/hour, 10/day, keyed on `sha256(INTERNAL_API_SECRET:ip)`,
  counted from the existing `Shoutout` table) → MiniMax Anthropic-compat
  moderator (`MiniMax-M2.7`, classifies `allowed` / `rewritten` / `held` /
  `blocked`; fail-closed to `held` on any moderator error) → create `Shoutout`
  row (audit trail) → if approved, forward to the dashboard's internal route
  via the tunnel with `x-internal-secret: $INTERNAL_API_SECRET`.
- ✅ Cloudflare tunnel: `api.numaradio.com/api/internal/*` →
  `http://localhost:3001` (ingress rule added to
  `/etc/cloudflared/config.yml`; `~/.cloudflared/config.yml` is now a symlink
  to the same file, no more drift). `dashboard.numaradio.com` stays behind
  Cloudflare Access; only `/api/internal/*` is tunnel-exposed and gated by
  the shared secret.
- ✅ `INTERNAL_API_SECRET` canonical source is `/etc/numa/env` (root-only)
  and matches Vercel's env var. Copy it into `dashboard/.env.local` with:
  `sudo grep ^INTERNAL_API_SECRET= /etc/numa/env | sudo tee -a
  dashboard/.env.local` — `numaradio/.env.local` had a stale value and bit us
  once; don't trust it as the source.
- ✅ Moderator JSON extraction (`lib/moderate.ts`) tolerates markdown fences
  and leading prose — MiniMax-M2.7 sometimes wraps its JSON.

**Dashboard shoutouts panel — LIVE (2026-04-20)**
- ✅ `dashboard.numaradio.com/shoutouts` — three cards:
  - **Compose**: textbox + "Send to Lena" (⌘/Ctrl+Enter). POSTs to
    `/api/shoutouts/compose`, which reuses `generateShoutout()` directly —
    no moderation, no rate limit (operator trust = Cloudflare Access).
    Sender is tagged `dashboard:<cf-access-email>` in Track provenance.
  - **Held for review**: lists rows where MiniMax returned `held`, with
    one-click Approve (flips `moderationStatus` to `allowed`, runs the
    normal pipeline, updates `deliveryStatus` + `linkedQueueItemId`) or
    Reject (marks `blocked`, logs operator email in `moderationReason`).
  - **Recent**: last 20 aired/failed/blocked. Clocks use `HH:MM` for
    anything older than 10 minutes (relative time was reading "1h ago"
    for 60-90m-old items, which is technically true but useless).
- Nav link from main dashboard header alongside "Library →".

**Operator ergonomics — 2026-04-20**
- ✅ `cd dashboard && npm run deploy` = `next build && sudo systemctl restart
  numa-dashboard`, no password prompt.
- ✅ Sudoers drop-in at `/etc/sudoers.d/numa-nopasswd` (template in repo:
  `deploy/systemd/numa-nopasswd.sudoers`) allows `marku` to restart
  `numa-dashboard`, `cloudflared`, `numa-queue-daemon`, `numa-liquidsoap`,
  and `numa-rotation-refresher.timer` without a password. Scope is a strict
  Cmnd_Alias — no wildcards, both `foo` and `foo.service` spellings listed.

**Next for NanoClaw × Numa Radio:**
1. Song generation endpoint (`POST /api/generate/song`) — MiniMax
   `music_generation` API, async, polls 2-3 min, re-hosts audio on B2,
   same `Track` flow. Reference code: `~/examples/make-noise/app/api/music/`.
2. Dashboard chat widget (full NanoClaw agent) — conversational UI at
   `dashboard.numaradio.com` with all agent tools (memory, schedules, songs,
   shoutouts), progress callbacks. Requires adding an HTTP channel on the
   NanoClaw side. Deferred: the `/shoutouts` Compose card already covers the
   "unlimited shoutouts from the dashboard" need.

**Spec:** `docs/superpowers/specs/2026-04-20-on-demand-track-queue-design.md`
**Plan:** `docs/superpowers/plans/2026-04-20-on-demand-track-queue.md`

**To redeploy after a code change:**
```bash
git pull
sudo systemctl restart numa-queue-daemon
sudo systemctl restart numa-liquidsoap  # only if numa.liq changed
```
Systemd units live in `deploy/systemd/` in the repo; they're already
installed under `/etc/systemd/system/`.

## Vault location (product decisions / design / policy)

The Numa Radio vault lives in this repo at **`docs/numa-radio/`**. On the Mac
it's symlinked into the Obsidian vault at `SaaS/Numa Radio` so editing in
Obsidian = editing in the repo = git push syncs to all machines.

Read these in order:
1. **`docs/numa-radio/Decisions Log.md`** — most recent decisions, always read first
2. `docs/numa-radio/4. Branding and Hosting Update.md` — hosting topology
3. `docs/numa-radio/3. AI Radio Final Implementation Blueprint.md` — full blueprint
4. `docs/numa-radio/Numa Radio Design.md` — design bundle pointer

## Code conventions

- **Single package**, no npm workspaces. Folder shape:
  - `app/` — Next.js (web + API routes both live here)
  - `lib/` — shared modules (`db`, `storage`, `events`, `queue-rules`, …)
  - `workers/` — standalone Node processes that run on the mini-server
  - `scripts/` — one-shot CLIs (e.g. `ingest-seed.ts`)
  - `prisma/schema.prisma` + `prisma/migrations/`
  - `liquidsoap/` — broadcast configs (versioned here, run on the mini-server)
  - `seed/` — gitignored audio drop-zone for ingest
- **Path alias**: `@/*` → repo root
- **TypeScript scripts**: run via `tsx` (e.g. `npm run ingest:seed`)
- **Env loading** in scripts: `import "../lib/load-env"` first; it reads `.env.local`
- **Tailwind v4**: tokens via `@theme inline` in `app/globals.css`. Use class names
  like `bg-bg`, `text-fg`, `text-accent`, `border-line`, `font-display`, `font-mono`.

## Required env vars (`.env.local`)

```
DATABASE_URL                 Neon Postgres pooled URL
MINIMAX_API_KEY              MiniMax 2.6 API key
DEEPGRAM_API_KEY             Deepgram API key (Aura voice for Lena)
B2_BUCKET_NAME               numaradio
B2_REGION                    eu-central-003
B2_ENDPOINT                  https://s3.eu-central-003.backblazeb2.com
B2_ACCESS_KEY_ID             Backblaze keyID
B2_SECRET_ACCESS_KEY         Backblaze applicationKey
B2_BUCKET_PUBLIC_URL         https://f003.backblazeb2.com/file/numaradio
```

Also needed (everywhere — Vercel env + mini-server `/etc/numa/env`):

```
INTERNAL_API_SECRET          shared secret Liquidsoap uses to call /api/internal/*
                             generate with `openssl rand -hex 32`
```

Server (mini-server only) also needs:

```
ICECAST_SOURCE_PASSWORD      generated when installing Icecast — see SERVER_SETUP step 1
```

## Cross-machine workflow

- **Mac** (this dev box): code work, design, Obsidian editing. Runs `npm run dev`,
  ingest scripts, Prisma migrations.
- **Mini-server** (WSL2 Ubuntu): runs Icecast, Liquidsoap, cloudflared, NanoClaw
  workers, the cron that refreshes the playlist. Reads from Neon + B2 over the
  internet.
- **GitHub** is the sync mechanism. Both machines `git pull` to get the latest.
  Vault edits on Mac flow through Obsidian → symlink → repo → push → server pull.

## When you finish a session

Update this file (and `docs/numa-radio/Decisions Log.md` if you made decisions),
commit, push. The next session — on this machine or the other one — picks up here.
