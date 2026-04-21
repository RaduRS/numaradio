# Handoff — pick up where we are

Last updated: 2026-04-21 (night — Listener Song Generation Phase A
LIVE end-to-end)

## Listener Song Generation (Phase A) — LIVE (2026-04-21 night)

Listener fills the existing `Song request` tab on `numaradio.com` with
a prompt (mood / genre / BPM / key / vibe), artist name, and optional
"instrumental only" toggle. The dedicated `numa-song-worker` on Orion
polls Neon, runs a 6-step pipeline per job (LLM prompt-expansion →
MiniMax `music-2.6` + OpenRouter `black-forest-labs/flux.2-pro`
artwork in parallel → MP3 duration probe → B2 upload → Track +
TrackAsset insert → queue-daemon push) and airs the new song on the
stream within ~1–4 min.

- **Spec:** `docs/superpowers/specs/2026-04-21-song-generation-design.md`
- **Plan:** `docs/superpowers/plans/2026-04-21-song-generation.md`
- **Rate limits:** 1/hour, 3/day per IP (see
  `lib/rate-limit.ts:checkSongRateLimit`). The worker runs one job at
  a time — that's the real backpressure against the 20/hr MiniMax
  subscription cap.
- **Moderation:** song prompts use a song-specific moderator
  (`moderateSongPrompt` in `lib/moderate.ts`) that defaults to
  `allowed` for normal creative briefs (moods, genres, tempos, even
  dark moods like "rage" / "heartbreak") and only blocks hate speech,
  targeted real-person attacks, content involving minors, etc. Profane
  artist names fall back to "Numa Radio". Vocal jobs whose
  LLM-generated lyrics trip the profanity prefilter silently fall back
  to instrumental (`lyricsFallback=true` on the row).
- **Anti-repeat:** new tracks are created with `airingPolicy =
  "priority_request"`. Rotation refresh only considers `"library"`
  tracks, so the track is invisible to rotation until it airs. The
  `track-started` endpoint flips it to `library` in the same
  transaction that writes PlayHistory — by that point the track is
  already in the "last 20 played" window, so it can't rotate back
  until it ages out. No more A → B → A immediate repeats.

**Deployed surfaces:**
- **Vercel:** `/api/booth/song` (POST — creates request, rate-limits,
  moderates); `/api/booth/song/queue-stats` (GET — live "N ahead of
  you"); `/api/booth/song/[id]/status` (GET — polled every 5s by the
  UI); `app/_components/SongTab.tsx` now drives the `Song request` tab
  on the homepage (was a `setTimeout` stub for months).
- **Orion:** `numa-song-worker.service` is `enabled` + `active`,
  polling Neon every 3s. Loopback-pushes to `numa-queue-daemon` at
  `127.0.0.1:4000`.
- **Neon:** `SongRequest` table holds each job's lifecycle
  (`queued → processing → finalizing → done`; `failed` with
  `errorMessage` on pipeline crash; rows get deleted on failure so
  the listener's rate-limit slot is refunded).

**Operator ergonomics:**
- **Redeploy worker after code change:**
  `sudo systemctl restart numa-song-worker` — password-free for
  `marku` via `/etc/sudoers.d/numa-nopasswd`.
- **Redeploy UI + booth API:** `git push origin main`; Vercel
  auto-deploys.
- **Watch the pipeline:** `journalctl -u numa-song-worker -f`.
- **Find a row in Neon:**
  `SELECT id, status, titleGenerated, trackId, errorMessage
     FROM "SongRequest" ORDER BY "createdAt" DESC LIMIT 10;`.
- **Backfill a missing duration** (probes MP3 from B2, writes
  `Track.durationSeconds` + `TrackAsset.durationSeconds`):
  `npx tsx scripts/backfill-song-duration.ts`.

**Kill the feature temporarily** (no redeploy needed):
```
sudo systemctl stop numa-song-worker
sudo systemctl disable numa-song-worker
```
Queued rows pile up; new submissions still hit the rate limiter but
nothing airs. `start` + `enable` to resume; the startup sweep re-queues
anything left in `processing`.

**Pipeline quirks learned the hard way on launch day:**
- MiniMax `music-2.6` has two response shapes: async
  (`{task_id,...}` → poll) and sync (`{audio,...}` with no `task_id` —
  the generation finished inside the initial request window). Handler
  accepts either.
- OpenRouter's image-only models (like Flux) require
  `modalities: ["image"]`; the `["image","text"]` form only works for
  dual-output models like Gemini and returns `404 No endpoints found
  …`.
- MiniMax sync responses also skip `extra_info.duration`, so we probe
  the downloaded MP3 with `music-metadata.parseBuffer` as a fallback.

**Phase B/C deferred** (out of scope here):
- Shareable "your song" pages / account system.
- Listener-written lyrics (we generate them for now).
- Structured form fields (genre dropdown, tempo slider).
- Dashboard operator curation for generated songs.
- `NEXT_PUBLIC_SONG_CREATION_ENABLED` kill-switch flag (add when we
  need scheduled maintenance).
- Custom site-wide cursor (radio-vibe accent-teal ring); sketched out
  in conversation but deferred — revisit when there's a dedicated UI
  pass.

---

## Docker Engine in WSL — LIVE (2026-04-21 evening)

NanoClaw's container runtime is now **native Docker CE running as a
systemd unit inside the Ubuntu WSL distro** instead of Docker Desktop.
`dockerd` starts with the distro, same pattern as Icecast / Liquidsoap /
cloudflared. No Windows session needed — an unattended reboot brings
everything back up, including NanoClaw and the Telegram
shoutout-approval bot.

Details live at rest:
- `docker.service` is `enabled` (starts on every WSL boot) and `active`.
- `Operating System: Ubuntu 24.04.4 LTS`, `Server Version: 29.4.1`,
  `Docker Root Dir: /var/lib/docker` (images on the WSL filesystem).
- `marku` is in the `docker` group — no sudo needed for `docker`
  commands in a fresh shell.
- Docker Desktop is quit (no longer autostarts on Windows login) and
  its WSL integration for Ubuntu is disabled. Safe to uninstall it
  entirely if you want to reclaim Windows-side RAM.

Day-to-day commands:
- `docker ps`, `docker logs -f <name>`, `docker events`, `docker stats`
- `lazydocker` — full-screen TUI installed alongside the migration.

**Acceptance test** (to run whenever convenient): reboot Windows
without logging in; from a phone, submit a shoutout containing "fuck"
on numaradio.com. A Telegram DM from `@nanoOrion_bot` should arrive
within ~90s, confirming the full stack — WSL auto-start + dockerd +
NanoClaw + Telegram + held-notify — all survive an unattended reboot.

Rollback path (still works): `sudo systemctl disable --now docker`,
re-check WSL integration in Docker Desktop, `systemctl --user restart
nanoclaw`.

Script that did the migration (idempotent, safe to re-run):
`deploy/install-docker-ce.sh`. Spec:
`docs/superpowers/specs/2026-04-21-docker-in-wsl-design.md`.

---

Prior update (afternoon — WSL idle-shutdown round 2: the earlier
`.wslconfig` fix wasn't enough, task action now keeps `wsl.exe`
persistently attached via `/bin/sleep infinity`)

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

**WSL auto-start on Windows boot — 2026-04-21 (revised)**
Orion runs Numa Radio inside WSL2. The Windows scheduled task
`Start WSL (Numa Radio)` has three triggers (AtStartup / AtLogOn /
SessionUnlock), runs as S4U, and its action now **keeps `wsl.exe`
persistently attached** to the Ubuntu distro via `/bin/sleep infinity`.
That single attached session is what prevents WSL from idle-shutting-down
after the radio stack comes up — no logged-in user needed. The task's
`ExecutionTimeLimit` is `PT0S` (no limit) so the persistent attachment isn't
killed at 5 min. `.wslconfig` `vmIdleTimeout=-1` is retained as a secondary
safety net but is no longer the primary mechanism — the initial fix relied
on it alone and didn't survive the second unattended test-reboot. See
Decisions Log 2026-04-21 (afternoon) for the full postmortem.

Installer lives at `deploy/windows/install-autostart.ps1` (run elevated after
a Windows reinstall). It registers the scheduled task AND copies
`deploy/windows/wslconfig` to `%USERPROFILE%\.wslconfig`. Task backup at
`deploy/windows/Start-WSL-NumaRadio.backup.xml`.

Context: on 2026-04-21 at 02:19:56 BST the host BSOD'd (bugcheck `0x0000000A`)
and auto-rebooted at 02:31, but the stream stayed down until 07:47 because the
task's only trigger was "at user logon." S4U + AtStartup closes that gap. The
first attempt at the idle-timeout problem wrote `.wslconfig` with
`vmIdleTimeout=-1`; that didn't survive the second unattended test-reboot,
so the task action now uses `/bin/sleep infinity` to keep `wsl.exe`
persistently attached instead of relying on the idle-timeout knob. See
Decisions Log 2026-04-21 and 2026-04-21 (afternoon).

**After any full Windows reboot, verify from a phone or another device:**
`curl -sI https://api.numaradio.com/stream` should return `200` within ~90s of
POST, *without* logging into Orion. If it doesn't, check:
`powershell.exe Get-ScheduledTaskInfo -TaskName 'Start WSL (Numa Radio)'`
→ `LastTaskResult` (0 = success), and the
`Microsoft-Windows-TaskScheduler/Operational` event log.

Rollback: `schtasks /create /tn "Start WSL (Numa Radio)" /xml deploy\windows\Start-WSL-NumaRadio.backup.xml /f`.
To undo the idle-timeout change: delete `%USERPROFILE%\.wslconfig` (next full
Windows reboot will revert to the 60-second default).

**Verifying the attached-session fix on Orion:**
```
powershell.exe Get-ScheduledTask -TaskName 'Start WSL (Numa Radio)' | \
  Select-Object TaskName, State           # State should be "Running"
ps -ef | grep 'sleep infinity' | grep -v grep   # /bin/sleep infinity must be present
```
If either is missing after a reboot, the fallback path is `vmIdleTimeout=-1`
in `.wslconfig` — still a valid defence.

Spec: `docs/superpowers/specs/2026-04-21-wsl-autostart-design.md`
Plan: `docs/superpowers/plans/2026-04-21-wsl-autostart.md`

**Shoutout replay-storm fix + audio-player auto-reconnect — 2026-04-21**
First unattended-restart test exposed two more bugs:
- Every previously-aired Lena shoutout re-played back-to-back when the queue
  daemon came back up. Root cause: shoutout `QueueItem` rows never left
  `queueStatus='staged'` (the `onTrackHandler` only promotes music items), so
  `hydrator.ts` re-pushed all of them to Liquidsoap's `overlay_queue` on
  every reconnect. **Fix:** shoutout rows are now created as `completed`
  straight away (they're fire-and-forget to an in-memory overlay queue; no
  `staged` phase to resume), and `hydrate()` explicitly skips `queueType='shoutout'`
  as defence-in-depth. One-off Neon cleanup marked the 22 orphaned rows
  `completed` with `reasonCode='cleanup_2026-04-21_replay_storm_fix'`.
- The public `<audio>` element gave up on the first `error` event and showed
  "Stream error — try again". **Fix:** `app/_components/PlayerProvider.tsx`
  now tracks a `wantPlaybackRef` (user pressed Play) and on `error` it stays
  in "loading" and retries with exponential backoff (2/4/8/16/30 s, capped).
  Pause clears the intent. Backoff resets to 2 s on a successful `playing`
  event, so the *next* outage is recovered from quickly. `NotAllowedError`
  (autoplay-policy) still bails immediately — those require a user gesture.

To verify after a code change: deploy Vercel, open numaradio.com, press Play,
then on Orion `sudo systemctl restart numa-liquidsoap` and watch — the player
should stay in "loading" and resume within a few seconds without any click.

**Radio-feel overhaul — 2026-04-20 (final commit of the day)**
Spec: `docs/superpowers/specs/2026-04-20-radio-feel-design.md`
Plan: `docs/superpowers/plans/2026-04-20-radio-feel.md`

Phase 1 + 2 are shipped to `main` — safe to deploy to Vercel as-is. Phase 3
is **committed but not yet restarted on Orion**. The new Liquidsoap script
passes `liquidsoap --check` but hasn't been run against live Icecast yet.
Restart needs your eyes on the stream.

- ✅ **Phase 1** — `NowSpeaking` migration applied to Neon; broadcast /
  now-playing APIs return a `shoutout` field; Hero `PlayerCard` + `MiniPlayer`
  render a "• Lena on air" pill when a shoutout overlay is active; public
  booth form submit shows a spinner on both tabs (shoutout real, song still
  stub).
- ✅ **Phase 2** — new routes `app/api/internal/shoutout-started/route.ts`
  + `app/api/internal/shoutout-ended/route.ts` (Vercel auto-deploys).
  Queue daemon and `generateShoutout()` route shoutouts to Liquidsoap's
  `overlay_queue` via a `kind: "shoutout"` push. QueueItem rows tagged
  `queueType='shoutout'` and filtered out of Up Next.
- ✅ **Phase 3 — LIVE on Orion** (restarted + smoke-tested 2026-04-20 22:07).
  `liquidsoap/numa.liq` is now:
  - 5s crossfade between music tracks (`crossfade(duration=5., …)`).
  - Lena rides on top of music via `smooth_add(duration=0.5, p=0.5, normal=music_bed, special=voice)`
    — music bed ducks to 50% (≈ −6 dB) while she talks, 500 ms fade in/out.
  - Voice = `normalize(overlay_queue)` + `amplify(2.0, …)` so she sits
    consistently above the ducked bed.
  - `overlay_queue.on_track` + `source.on_end(overlay_queue, …)` notify
    Vercel on start/end of each shoutout.
  - Old single-`fallback` graph kept in a commented-out rollback block at
    the bottom of the file.

Already live. If a future tweak to `numa.liq` needs shipping:
```bash
git pull
sudo systemctl restart numa-liquidsoap
```
(The sudoers drop-in allows this password-free for `marku`, and for
Claude too via the same user.) Watch `journalctl -u numa-liquidsoap -f`
— errors are explicit. Rollback: uncomment the preserved old-graph block
at the end of `numa.liq`, rebuild, restart.

Bug caught & fixed during rollout:
- Liquidsoap's `source.on_end` defaults to `delay=5.` (fires when ≤5s
  remain). For a typical shoutout that fires ~3s after start,
  prematurely clearing NowSpeaking. Pinned to `delay=0.2` so the end
  callback fires at the actual audio end.

Remaining smoke tests to do by ear:
1. Submit a shoutout → music should duck audibly ~50% (–6 dB) while
   Lena speaks; underlying title/artwork must NOT change; pill clears
   right when she ends; music restores over ~0.5s.
2. Two library pushes back-to-back → 5s crossfade, no hard cut, no
   silence.
3. Two shoutouts in quick succession → sequential, not simultaneous.

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
