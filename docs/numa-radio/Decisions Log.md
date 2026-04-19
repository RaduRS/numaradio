# Numa Radio — Decisions Log

Living record of decisions made in chat that aren't already captured elsewhere in the vault. Newest at top.

---

## 2026-04-19 (evening) — Phase 0 + Phase 1 ingest landed

### Repo foundation set up
- Single-package structure (no npm workspaces — too much friction for MVP solo dev). Folder shape:
  - `app/` — Next.js (web + API routes)
  - `lib/` — shared code (db, storage, events, etc.)
  - `workers/` — standalone Node processes for the mini-server
  - `prisma/` — schema + migrations (one `init` migration applied to Neon 2026-04-19)
  - `liquidsoap/` — broadcast config (lives here, runs on mini-server)
  - `seed/` — gitignored audio drop-zone
- Path aliases: `@/*` → repo root.
- Tailwind v4 with design tokens (`bg-bg`, `text-fg`, `text-accent`, `font-display` etc.) wired via `@theme inline` in `app/globals.css`.
- Fonts loaded via `next/font/google`: Archivo (variable, with wdth axis), Inter Tight, JetBrains Mono.

### Seed-ingest workflow proven end-to-end
- Operator workflow:
  1. Drop Suno-exported MP3s into `seed/`
  2. Run `npm run ingest:seed`
  3. Done — auto-creates station if missing, uploads audio + artwork to B2, writes `tracks` + `track_assets` rows in Neon, marks ready
- Idempotent: dedup'd via Suno UUID parsed from MP3 comment field. Re-running is a no-op for existing tracks.
- **Surprising finding worth noting:** Suno-exported MP3s embed everything in ID3: title, artist, BPM, key, genre tags, full lyrics, source URL/UUID, and 1024×1024 cover art (~300KB JPEG). No URL scraping or external API needed — `music-metadata` reads it all from the file.
- Artist normalization: `russellross` (Suno's lowercase format) → `Russell Ross` for display, via small lookup map in the script.
- First track ingested: "One More Dance" — `122 BPM · D Minor · NuDisco · Groovy`, 4.44MB audio + 295KB artwork, both publicly fetchable from B2.

### B2 bucket policy: Public
- Reversed earlier overcaution. Reasoning: all content is meant to be public anyway (radio broadcast + permissive reuse policy), signed-URL flow adds real overhead, B2 free egress (3× storage) and Cloudflare Bandwidth Alliance make scraping cost negligible at MVP scale.
- Tracks stored at `stations/numaradio/tracks/{trackId}/audio/stream.mp3` and `…/artwork/primary.{jpg|png}`.
- `provenance.json` originally specced for B2 instead lives in Neon as a JSON column on `tracks` — metadata belongs in the DB.

---

## 2026-04-19 (afternoon)

### Suno-link feature: DROPPED for MVP
- Listener-pasted Suno URLs are out. Reasoning:
  - Submitter rights cannot be verified from a URL ("I'm Dominic" is unverifiable; free-tier vs paid Suno accounts indistinguishable; impersonation/copy of someone else's track is trivial).
  - Manual approval doesn't fix the rights question — it's paperwork, not detective work.
  - Feature value is modest; risk and operator load are not.
- Request panel becomes **two tabs**: Song request (MiniMax-generated custom track) + Shoutout (Lena reads on air).
- "Pick from existing catalog" alternative considered and deferred — overlaps with what queue planner does, and the Up Next view in the design already scratches that itch passively.
- Vault `request_type` enum stays as in blueprint (`song`, `theme_song`, `birthday_song`, `mood_song`, `other`) — Suno was never in the schema, only in the design mockup.
- **Design impact:** the request form's three-tab UI in `Numa Radio Landing.html` should become two tabs when ported to React. HTML prototypes left as-is (they're throwaways).

### Stream delivery protocol: CHOSEN
- **Icecast + Liquidsoap** on the home mini-server.
- Listeners stream from `api.numaradio.com/stream` via Cloudflare Tunnel.
- Liquidsoap absorbs much of what the blueprint calls `worker-broadcast`: it pulls from a playout queue, crossfades, splices pre-rendered Deepgram host inserts, handles fallback to library tracks if assets fail.
- Free, proven, runs alongside NanoClaw on the mini-server.
- ~5–15s latency, native browser playback via `<audio>` — no HLS.js needed.
- Cloudflare Tunnel is acceptable for MVP listener counts. Migration path if scale demands: front the tunnel with BunnyCDN (~$5/mo) or move to Cloudflare Stream — no app code changes.
- Trade-off: Liquidsoap's config language is OCaml-flavored. ~1 day learning curve, then stable.

---

## 2026-04-19 (morning)

### Catalog size
- Launch with **~50 songs**, not 500. Catalog grows over time.
- Single-artist seed: **Russell Ross**. Site copy and queue rotation rules should not over-emphasize artist names since one identity covers most plays at launch.

### Hosting
- Frontend: `numaradio.com` on **Vercel**.
- Backend: `api.numaradio.com` → **Cloudflare Tunnel** → dedicated **always-on home mini-server** (NOT the user's day-to-day laptop).
- Cloudflare Tunnel chosen for reliability + free tier.
- MVP-acceptable. Migration to managed cloud (Fly / Railway / Hetzner / AWS) is a planned later step.

### Database
- **Neon Postgres** (eu-west-2, pooled). Verified reachable on 2026-04-19 (PostgreSQL 17.8).
- Connection string lives in `.env.local` as `DATABASE_URL`.

### Music generation
- **MiniMax 2.6** via `https://api.minimax.io/v1/music_generation`.
- Existing code worth reusing from sibling project `make-noise/`:
  - `app/api/music/route.ts` — submit + duration normalization (MiniMax returns durations in inconsistent units; this normalizes to ms).
  - `app/api/music/status/route.ts` — GET poll for async results.
  - Polling pattern in `page.tsx`: 180 attempts × 2s = ~6min ceiling.
  - Mood + genre prompt prefix concatenation.
- Env var: **`MINIMAX_API_KEY`** (matches blueprint).

### Host voice (Lena)
- **Deepgram Aura** for MVP. Migrate to **ElevenLabs** later for more emotional range.
- Recommended starting voice: **`aura-2-luna-en`** (warm, late-night DJ feel). `read-for-me` defaults to Asteria — swap for Numa.
- Existing code worth reusing from `read-for-me/`:
  - `app/api/synthesize/route.ts` — Aura TTS with chunking (600 soft / 1600 hard cap), primary→fallback model, PCM concat, WAV wrap. Reusable; only changes: swap model env, change return path (upload to B2 instead of streaming back), update env var name.
  - `lib/radio-host.ts` — text → radio cadence (8–14 word phrases, clause-boundary splits, "Up next." cues, quote-marks around "Numa Radio"). Directly reusable for Lena's segments.
  - `lib/strip-markdown.ts` — input sanitizer.
- Env var: **`DEEPGRAM_API_KEY`** (standardize away from `read-for-me`'s `DEEPGRAM_API`).

---

## Memory notes

This project also has an internal Claude memory at `~/.claude/projects/-Users-sisin-Developer-numaradio/memory/` (not visible in the vault). Vault is the source of truth for product decisions; memory is for collaboration patterns and live conversational state.
