# Numa Radio — Decisions Log

Living record of decisions made in chat that aren't already captured elsewhere in the vault. Newest at top.

---

## 2026-04-19 (night) — Now-playing + real listener count wired end-to-end

### Public site now shows truthful title, artist, artwork, elapsed/duration
- Liquidsoap `on_track` POSTs to `/api/internal/track-started` → Neon `NowPlaying` upsert → site polls `/api/station/now-playing` every 15s.
- Tunnel now also exposes `/status-json.xsl` (new ingress rule in `/etc/cloudflared/config.yml`), so `/api/station/listeners` proxies Icecast directly.

### Liquidsoap 2.2.4 quirks worth remembering
- **`json.stringify` takes the value positionally**, not as `payload={…}`. The labeled form is a newer-Liquidsoap idiom and the 2.2.4 parser hard-errors with "no argument labeled payload".
- **`source.on_track(f)` returns `unit`, not a new source** in 2.2.4. The method form mutates the receiver in place; reassigning (`source = source.on_track(f)`) replaces `source` with `unit`, which then breaks `mksafe(source)` downstream with a type error. Just call it.
- **`playlist.reloadable` pre-downloads HTTP items to /tmp** before playback, so by the time `on_track` fires, `metadata["filename"]` is `/tmp/liq-processXXXXXX.mp3` — the original URL is gone from that field. The B2 URL **is** still present in `metadata["initial_uri"]` though (not `["source_url"]`, which is empty in this Liquidsoap build). `numa.liq` picks `initial_uri` first, falls back to `filename`.

### API fallback: lookup by title + artist when the URL doesn't carry a trackId
- Even with `initial_uri` available, we send `title` and `artist` from ID3 in the POST body. The API tries `trackId → URL-extracted trackId → (stationSlug, title, artist)` lookup in order. Case-insensitive match, `orderBy updatedAt desc` so later-ingested duplicates win. This means future playlist sources that strip the URL (local cache, a different `playlist.*` builder, etc.) keep working without an API change.

### Listener count: additive boost, not a floor
- Original implementation was `max(real, 15)` — real listeners up to 15 produced no visible change. Switched to `15 + real` so pressing play always nudges the counter. Field name `withFloor` kept in the API response for backwards compatibility with the `ListenerCount` component (semantically it's a boost now, but renaming would churn the consumer for no gain).

### HSTS: deliberately NOT enabling
- Cloudflare Security Center flagged `api.numaradio.com` for missing HSTS. Enabled "Always Use HTTPS" (the practical protection — redirects any `http://` request to `https://`) but skipped HSTS. Reason: HSTS pins browsers to HTTPS-only for the max-age window (6–24 months typical); any future HTTPS hiccup (expired cert, Cloudflare pause, migration) → site dark for cached visitors. Marginal security upgrade not worth the operational lock-in at MVP stage.

### Operational gotcha — Claude Code's `!` shell prefix
- Chained commands with `&&` and `sudo` sometimes only surface the first command's output; later commands still run but their stdout gets eaten before it reaches the paste buffer. Recovery pattern: run each command as its own `!` invocation. Cost a lot of round-trip confusion tonight when trying to batch `sudo cp ... && sudo systemctl restart ... && curl ...`.

---

## 2026-04-19 (late evening) — Operator Dashboard live + two field-learned fixes

### Dashboard is live
- `https://dashboard.numaradio.com` is up behind Cloudflare Access, running as `numa-dashboard.service` on Orion (the mini-server, Next.js on port 3001 → cloudflared).
- Four cards: stream status + now-playing, controllable services, health (Neon / B2 / Tunnel), journalctl logs.
- Plan: `docs/superpowers/plans/2026-04-19-operator-dashboard.md`. Design spec: `docs/superpowers/specs/2026-04-19-operator-dashboard-design.md`.

### Cloudflared REMOVED from dashboard-controllable services
- First deploy exposed a footgun: "Restart cloudflared" from the dashboard kills the tunnel the dashboard itself rides on. Clicked it once by accident → Cloudflare Error 1033 for both `dashboard.numaradio.com` and `api.numaradio.com` until restarted from a local terminal.
- Decision: remove cloudflared from the controllable service list (`lib/service-names.ts`). Services card + Logs tab now only show `icecast2` and `numa-liquidsoap`. Health card still shows **Cloudflare Tunnel** status (connection count from `/metrics`) so tunnel state stays visible without the restart button.
- Sudoers allowlist at `/etc/sudoers.d/numa-dashboard` keeps cloudflared entries — allowed-but-unused is harmless and we may want the escape hatch back later.

### Listener count was being inflated by our own probe
- `/api/status` originally did `fetch(STREAM_PUBLIC_URL, { Range: "bytes=0-1" })` every 5s to set the "reachable" flag. Icecast counts any HTTP GET on `/stream` as a listener — so the dashboard was adding one listener per open dashboard tab, visible as a steadily-climbing count.
- Fix: `reachable` is now derived from signals we already collect — Icecast's source JSON shows `/stream` is connected **and** cloudflared `/metrics` reports active tunnel connections. No extra stream connection, listener count matches reality.

### Vercel was building `dashboard/` and failing
- Vercel builds the parent Next.js app from repo root. Its tsconfig had `"include": ["**/*.ts", ...]`, which swept in `dashboard/**` — and the dashboard's `@/*` alias points inside `dashboard/`, so Vercel's builder couldn't resolve `@/lib/systemd` and the deploy failed.
- Added `dashboard` to root `tsconfig.json` `exclude`, plus a `.vercelignore` (also skips `workers`, `liquidsoap`, `seed`, `docs` — Vercel doesn't need any of them).

### B2 egress optimization: not worth doing yet
- With Liquidsoap pulling each track from B2 once per play (not per listener — Icecast handles fan-out), actual egress is small: ~100 plays/day × 5.5 MB ≈ 550 MB/day, under B2's free 1 GB/day. Effective cost ≈ $0.
- Two optimizations held in reserve if costs ever show up: (1) local disk cache so Liquidsoap re-reads from `/var/cache/numa/` on repeat plays, or (2) Cloudflare CNAME in front of the B2 public bucket (Backblaze + Cloudflare Bandwidth Alliance = free egress). Prefer (2) when the time comes — zero code, just DNS + page rule.

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
