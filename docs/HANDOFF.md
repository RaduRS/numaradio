# Handoff — pick up where we are

Last updated: 2026-04-19 (Mac, end of Phase 1 ingest)

## Where we are

**Phase 0 (Foundations) — DONE**
- Repo structure: `app/` `lib/` `workers/` `prisma/` `scripts/` `docs/` `liquidsoap/` `seed/`
- Prisma schema applied to Neon (one `init` migration in `prisma/migrations/`)
- B2 read + write + public-URL fetch verified
- Tailwind v4 design tokens wired (`@theme inline` in `app/globals.css`)
- Fonts: Archivo (variable, with wdth axis), Inter Tight, JetBrains Mono via `next/font/google`
- Dev server boots cleanly (`npm run dev` → `http://localhost:3000`)

**Phase 1 (Audible station) — partially done**
- ✅ Seed-ingest script working end-to-end (`npm run ingest:seed`)
- ✅ One real track ingested: "One More Dance" by Russell Ross
- ⏳ Install Icecast + Liquidsoap on the mini-server (WSL2 Ubuntu) — see `docs/SERVER_SETUP.md`
- ⏳ Drop the minimal Liquidsoap config and confirm local stream works
- ⏳ Set up Cloudflare Tunnel so `https://api.numaradio.com/stream` is publicly reachable

When all three remaining Phase 1 tasks are done, the station is live.

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
