# Handoff — pick up where we are

Last updated: 2026-04-20 (on-demand queue + Neon rotation code landed, ready to deploy)

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

**On-demand queue + Neon rotation — READY (code only, not deployed yet)**
- ✅ `workers/queue-daemon/` — Node service: loopback HTTP (`POST /push`, `POST /on-track`, `GET /status`), Liquidsoap telnet socket with exponential reconnect, hydrator that reads staged priority `QueueItem`s from Neon and re-pushes on startup/reconnect.
- ✅ `scripts/refresh-rotation.ts` — regenerates `/etc/numa/playlist.m3u` from Neon: library tracks (`trackStatus='ready' AND airingPolicy='library'`) minus the last 20 `PlayHistory` entries, Fisher–Yates shuffled, atomic tmp→rename write.
- ✅ `liquidsoap/numa.liq` — now uses `fallback(track_sensitive=true, [priority_request_queue, rotation, blank()])`. Priority requests air at the next track boundary, never mid-song. `on_track` callback POSTs to both Vercel (`/api/internal/track-started`) AND the local daemon (`/on-track`) so queue-item transitions don't depend on Vercel.
- ✅ `app/api/internal/track-started/route.ts` — now writes `PlayHistory` alongside `NowPlaying` in one transaction, so rotation's "avoid recent N" filter has a reliable source of truth.
- ✅ Manual CLI: `npm run queue:push -- --trackId=<id> [--reason=<text>]`.
- ✅ Systemd units written at `deploy/systemd/` (queue daemon unit, rotation refresher service + timer).
- ✅ 27 unit tests across `workers/queue-daemon/` and `scripts/`: `npm test`.

**NanoClaw integration seam:** once NanoClaw exists, its final step is `POST http://127.0.0.1:4000/push` with `{ trackId, sourceUrl, requestId?, reason? }`. No protocol negotiation — just that one call.

**Spec:** `docs/superpowers/specs/2026-04-20-on-demand-track-queue-design.md`
**Plan:** `docs/superpowers/plans/2026-04-20-on-demand-track-queue.md`

**To deploy (next step):**
```bash
sudo cp deploy/systemd/numa-queue-daemon.service /etc/systemd/system/
sudo cp deploy/systemd/numa-rotation-refresher.service /etc/systemd/system/
sudo cp deploy/systemd/numa-rotation-refresher.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now numa-rotation-refresher.timer
sudo systemctl enable --now numa-queue-daemon.service
sudo systemctl restart numa-liquidsoap  # picks up new numa.liq
```
Then verify `curl -sS http://127.0.0.1:4000/status | jq .` returns `{"socket":"connected",...}`. The unit files live in `deploy/systemd/` in this repo — the commands above copy them into place. Only the `sudo` install steps require operator action; the copy-in is deliberately manual so the operator reviews any changes before they land under `/etc/systemd/`.

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
