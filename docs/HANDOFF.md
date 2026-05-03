# Handoff — pick up where we are

Last updated: 2026-05-03

---

## Backlog — do only if needed

Pick up only if Vercel CPU runs hot again or these start hurting.

- Broadcast boundary poll 1s → 3s (`Broadcast.tsx:BOUNDARY_POLL_MS`)
  + `/api/station/broadcast` edge cache 5s → 10s. Cuts homepage
  poll cost ~5×, ~5s flip lag during normal play.
- booth/song moderation into `after()` (same #4 pattern; needs a
  "moderating" status the song-worker skips).
- `@@index([fingerprintHash])` on Shoutout — yt-chat does findFirst
  on it for idempotency, sequential scan today.
- Heartbeat sweep dampening (`presence/heartbeat`) — gate the
  `deleteMany` on 1-in-60 or move to daily privacy-sweep cron.
- World-aside circuit-breaker on Brave outage — N consecutive
  failures → skip world_aside slots 30 min.
- Timing-safe token compare in `cron/privacy-sweep` — match
  `lib/internal-auth.ts` pattern.

---

## 2026-05-03 (evening) — listener-count cleanup, Resend email,
## broadcast freshness, artwork text/border suppression

Long evening session. Touched gate logic, email infra, broadcast
encoder freshness, dashboard library, Flux prompt pipeline. ~25
commits between `f8c5e17` and `0dabe7b`.

**Listener-count cleanup — LIVE.** Spec/plan
`docs/superpowers/{specs,plans}/2026-05-03-listener-count-cleanup*.md`.
- Icecast: `queue-size` 524288→204800, `burst-size` 65535→32768.
  Zombies now kicked at TCP layer in seconds, not hours.
- 3 Vercel routes (`/api/station/listeners`, dashboard
  `/api/station/listeners`, dashboard `/api/status`) subtract the
  OBS encoder pull when broadcasting. Uses already-cached YT
  snapshot — zero new API calls.
- Daemon gate folds in YT viewers via loopback fetch to dashboard's
  `/api/youtube/health`: `effective = icecast + (live ? viewers - 1
  : 0)`. New `workers/queue-daemon/youtube-audience.ts` (9 tests).
- Threshold later bumped 3 → 4 per operator preference. UI labels +
  5 tests realigned.
- Dashboard `/shoutouts` listener pill mirrors the gate's effective
  math (was showing audio-only and contradicting Lena when YT
  viewers tipped the gate over).

**Broadcast encoder freshness — LIVE on Vercel; OBS Browser Source
needs Refresh on Windows to pick up new JS.** Headless tab pollers
(`useNowPlaying`, `useBroadcast`, `useLenaLine`) bypass the
visibility gate AND append `?t=Date.now()` to bypass edge cache when
`?broadcast=1`. Fixes "stuck artwork + waveform for 30s after track
change" — visibility gate killed scheduled refetches and edge SWR
served stale during the gap. Three breadcrumbs added near the code
(`deploy/numa-youtube-encoder.sh` header, systemd unit Description,
`app/live/page.tsx` comment) so future agents stop reaching for
`systemctl restart numa-youtube-encoder` (cold fallback only since
2026-05-01).

**Resend email — LIVE.** `lib/email/{client,submission-approved,
submission-rejected}.ts`. Wired into the public-site internal
approve/reject routes via `after()` so the dashboard click stays
instant. Approve template gets `🎉 + GOOD NEWS` eyebrow (single
emoji, no exclamation marks). Reject template repurposes the
markdown that the dashboard used to download. From/Reply-To both
`hello@numaradio.com`. Dashboard `SubmissionsPanel` lost the
markdown-download path; toast wording updated.
- Backfilled approval emails for **19 prior approvals** (skipped
  SarabiXp who'd just got a one-off "what's the title?" email).
- Required `RESEND_API_KEY` in Vercel env (Production + Preview).
- One-off email sent to SarabiXp (`gersongsia92@gmail.com`) asking
  for the missing title; SimbaXp track renamed to "My Beautiful
  Disaster" + genre "Pop Punk, Indie Rock" per their reply.

**CSP — song-submit no longer violates.** Added
`https://numaradio.s3.eu-central-003.backblazeb2.com` to the public
`connect-src`. Browser uploads .mp3 + artwork via presigned PUT;
without this, flipping CSP from report-only to enforce would silently
break submissions. Dashboard CSP intentionally untouched (operators
don't upload songs).

**Submit page copy.** Post-submission card now reads "We'll listen"
not "Lena will listen". The on-air-flavoured Lena references stay
(she does announce + slot tracks).

**Nav + hero artist surfacing.** First attempt was a teal `+ SUBMIT`
pill in the navbar — operator rejected as too loud. Reverted.
Replaced with two quiet touches: 5th nav-link `Submit` (same style
as Requests/Shows) for cross-page reach, and a small mono uppercase
"GOT A FINISHED TRACK? SUBMIT IT HERE →" line under the hero CTAs
on `/`, mirroring the existing `/#requests` treatment.

**Dashboard library.**
- Auto-chatter threshold 3 → 4 (gate + UI + 5 tests, all green).
- Regenerate-artwork button DISABLED for tracks where the artist
  supplied their own art (`MusicSubmission.artworkSource` =
  `upload` or `id3`). Surfaced via LEFT JOIN in
  `dashboard/lib/library.ts`. Tooltip swaps to "Artist-supplied
  artwork — regenerate disabled".
- Hover artwork preview switched from `position: absolute` (was
  clipped by parent `overflow: hidden`) to `position: fixed` with
  viewport-relative coords from `getBoundingClientRect`. Auto-flips
  to left if it would overflow right; closes on scroll/resize;
  `z-[9999]`.

**Artwork prompt pipeline rewritten.**
- Two-stage: Minimax pre-step (`dashboard/lib/artwork-prompt-llm.ts`)
  translates `{title, mood, genre, show, hint}` into a 25-60-word
  visual scene with strict rules (no proper nouns, no quoted strings,
  no genre-name mentions). Then Flux gets the scene through a much
  more aggressive wrapper (`dashboard/lib/openrouter.ts`).
- Flux wrapper rewritten: avoids "album cover" framing entirely
  (was a typography trigger), front-loads + tail-loads "no text" +
  "no borders" constraints, enumerates text-prone surfaces (signage,
  license plates, posters, screens, t-shirts, graffiti). Verified
  in production logs (`[artwork-regen] llm=ok`,
  `[artwork-flux] prompt …`).
- Minimax timeout 15s → 25s after one transient fallback. Diagnostic
  logging added so future fallbacks reveal the failing branch.
- Fail-soft: missing key / network error / unusable output falls
  back to the bare mood + genre + show prompt — same as today's
  baseline.

**DB cleanups (one-off).**
- Purged 2 test submissions (rsrusu90@gmail.com — `test`, `testtt`)
  via the existing full-delete cascade (B2 + Track + TrackAssets +
  QueueItem + BroadcastSegment + nulled PlayHistory.trackId).
- SimbaXp Track + submission backfilled with title + genre.

**Operator follow-ups (still need sudo on Orion):**
1. `cd dashboard && npm run deploy` — picks up artwork pipeline,
   threshold UI, hover preview, library regen lock, Submit nav link
   + hero CTA (also covers earlier dashboard work today).
2. `sudo systemctl restart numa-queue-daemon` — picks up gate
   threshold change + YT audience fold-in.
3. `RESEND_API_KEY` confirmed in Vercel env — verified end-to-end
   send by operator.
4. OBS on Windows: refresh Browser Source for the broadcast-tab
   poller fixes to land on YouTube viewers (no encoder restart
   needed; OBS is primary, WSL is cold fallback).
5. Optional: when comfortable, flip both `next.config.ts` headers
   from `Content-Security-Policy-Report-Only` → enforce. Console
   should be clean now that B2 is allowed in `connect-src`.

---

## 2026-05-03 — Vercel free-tier audit + Lena prompt sweep

Hobby Fluid Active CPU hit 75% in 2.5 days. Two parallel audits →
8 commits between `ce43c63` and `cd88c62`. Burn rate ~5-10 min/hour
→ ~1 min/hour. Still over free-tier; recommend Pro (£15/mo) for May.

**Lena prompt time-grounding (5 surfaces)** — same class as the
2026-04-24 chatter-prompts "tonight at 08:40" leak. All inject
`Local time: HH:MM (bucket)` + per-bucket ban table:
- `dashboard/lib/humanize.ts` + `lib/lena-reply.ts` — dropped
  "warm late-night host" / "2am voice" framing → 24/7 host
- `workers/queue-daemon/context-line.ts` — StationState gains
  localTime/timeOfDay/dayOfWeek/weekPart; length cap 200 → 250
  (was full of `length_206/208/211` log noise)
- `workers/queue-daemon/world-aside-client.ts` — sign-off time
  rule added on top of existing event-timing rule
- `patterns/lena-quotes/*.json` — scrubbed 47 time-locked lines;
  pool generator BANNED_REGEX gains time labels

**Cost cuts:**
- Edge cache TTLs bumped on `/api/station/{broadcast,now-playing,
  lena-line,listeners}`. lena-line was the big find (was
  `no-store` → every 60s poll per visitor hit the function)
- All 10 client pollers gated on `document.visibilityState` —
  mirrors `dashboard/hooks/use-polling.ts`
- `getCachedNowPlayingSnapshot()` wraps SSR snapshot in
  `unstable_cache` (5s revalidate) — was 4 Prisma roundtrips per
  uncached page visit
- `booth/submit` + `internal/youtube-chat-shoutout` moderation
  moved into `after()`. Listener sees instant submit + spinner
  polls /status. Was 2-15s billable wait per call.

**Security:** `/api/submissions/[id]/audio` was unauthenticated on
public Vercel (CF Access didn't reach it — wrong subdomain). Now
HMAC-signed URLs minted by dashboard's `/api/submissions/list`,
verified on the public route. `dashboard/lib/sign-audio-url.ts` +
`lib/verify-audio-sig.ts` (8 tests). 1h TTL.

**Operator follow-ups:**
1. `sudo systemctl restart numa-queue-daemon` for context-line +
   world-aside prompt fixes to load (pool JSON loads fresh per req).
2. Watch Vercel Settings → Billing → Usage for 24h, decide Pro.

436/436 root + 50/50 dashboard tests pass.

---

## 2026-05-02 — first real artist traction; load surfaced latent bugs

Reddit post → ~50 comments + real submissions. Architecture held; one
session of catch-up work shipped.

**Submissions/library:**
- Form gains track title (req'd) + genre (opt) → migration
  `20260502151255`. English-only validation across booth shoutouts +
  song prompts + chat (`lib/text-script.ts isLatinScript`).
- Approve route: `one_off → request_only` (was `priority_request` →
  invisible in /library). Tier-3 artwork fallback added (show PNG if
  no upload + no ID3). Submitter consent now discloses YouTube
  simulcast.
- Library: bin button (full delete inc. B2), in-page audio preview
  with scrub bar, table-fixed (long titles can't push artwork),
  isShoutout tightened (external_import + request_only +
  title.startsWith("Shoutout")), genre column backfilled from
  provenanceJson + new `lib/derive-genre.ts`. ingestTrack guarantees
  Track.genre never null.
- Up Next: per-show coloured pills, Artist as own column, `?limit=20`
  with rolling-20 behaviour, "Reshuffle now" button on Now Playing.

**Rotation:**
- Generational pass replaces sliding-window (every track plays once
  per cycle, then wraps; bridge prevents seam repeat). Manual
  drag-and-drop override on /library writes
  `/etc/numa/manual-rotation.json`; auto-clears on exhaustion via
  timestamp check. m3u always has manual-remaining + auto-tail.

**Audio quality:**
- Suno MJPEG-as-video-stream bug fixed end-to-end:
  `lib/sanitize-mp3-audio-only.ts` (ffmpeg remux to audio-only) wired
  into suno approve before ingestTrack;
  `scripts/scan-and-repair-multistream-tracks.ts` repaired 19/84
  catalogue tracks; `scripts/check-cdn-hit-ratio.ts` for ongoing
  visibility. Cloudflare cache purged for the 14 affected URLs.
- Day-of-week added to chatter prompt context after "hope your week's
  started right" leaked on Saturday morning. BASE_SYSTEM rule
  literally names the leaked phrase as banned outside Monday.
- Humanize false-positive: `isSuspiciousRewrite` was killing good
  124-from-44 char rewrites (2.8× ratio). Replaced strict ratio with
  absolute 320-char ceiling for short inputs. approveShoutout now
  persists `gen.spokenText` as broadcastText, not the raw input.

**NanoClaw:**
- `groups/telegram_main` was running the generic "Andy" briefing
  with zero radio context. Shipped
  `nanoclaw-groups/telegram_main/CLAUDE.md` (mobile-tight variant of
  dashboard_main) with held-shoutout reply-pattern table + auth
  copied from dashboard_main. Container force-stopped to load.

**B2 cost audit (whole-day spelunking):**
- Real leaks: dashboard `checkB2()` HEAD'd B2 every 5s (~17k/day);
  `Phone1Mockup.tsx` hardcoded B2-direct URL on homepage; 12 legacy
  TrackAssets pointing at `f003.backblazeb2.com`; submission preview
  `Cache-Control: no-store` so every scrub re-downloaded. All fixed.
  Cloudflare Page Rule (Cache Everything + Edge TTL 1mo) + Tiered
  Cache enabled. Hit-ratio now 99% on audio + artwork.
- **Punchline:** B2 Class B is $0.004/10k and Cloudflare egress is
  free via the Bandwidth Alliance. Yesterday's "quota panic" was
  ~$0.001 of real liability. With a card on file, the daily cap
  becomes a tap. **Stop watching the counter.** The fixes are still
  good citizenship, not cost-saving.

**What's next:**
- 30s demo video showing visitor-types-shoutout → Lena-reads-it. The
  single most valuable asset for any launch.
- Hold Product Hunt 6-8 weeks until that exists. Skip Kickstarter.
- Keep posting on r/WeAreTheMusicMakers, r/AIMusic, r/listentothis,
  r/ThisIsOurMusic.
- "Often fast · max 3 days" submission turnaround is now load-bearing
  copy — watch pending submissions sitting > 24h.

---

## 2026-04-30 — TODO: dashboard owns the YouTube broadcast lifecycle

Operator workflow today is "go to Studio + click Go Live, come back
to dashboard + Start encoder, ditto in reverse to stop". Two control
surfaces. Worth collapsing to one button on the dashboard.

**Design:**

Replace the current encoder Stop/Start button on the YoutubeCard
with two buttons:

- **Go Live**: creates a chat-enabled broadcast via API (lift the
  insert + bind logic out of `scripts/youtube-go-live.ts` into a
  shared lib), then starts the encoder. Returns the watch URL.
- **End broadcast**: stops the encoder, then calls
  `liveBroadcasts.transition` with `broadcastStatus=complete` to
  mark the YouTube broadcast finished. **This is the load-bearing
  bit**: with `enableAutoStop=false` the broadcast otherwise stays
  in `live` lifecycle forever, and the chat poll keeps burning 5u
  per tick (~28k/day at 15s cadence). Transitioning to `complete`
  drops it back to 1u per tick (~5.7k/day).

**Files to touch:**

- New `dashboard/lib/youtube-broadcast.ts` — `createBroadcast()` and
  `endBroadcast(videoId)` helpers. Adapt from
  `scripts/youtube-go-live.ts` (already calls liveBroadcasts.insert
  + bind + videos.update; only `transition` is new).
- New `dashboard/app/api/youtube/broadcast/route.ts` — POST creates
  broadcast, DELETE ends current. Track quota via the existing
  `recordYoutubeQuota` (insert=50u, transition=50u, bind=50u — these
  are write ops, much pricier than the 1u read ops we're tracking
  today, so the meter stays accurate).
- Update `dashboard/components/youtube-card.tsx` — replace the
  Stop/Start row with Go Live / End broadcast buttons. Same confirm
  dialog on End. Same poll for state — but state should now reflect
  broadcast lifecycle (read from `/api/youtube/health`, the videoId
  presence) rather than just systemd.

**Quirk to watch:** if a broadcast is ALREADY active when Go Live
fires, `liveBroadcasts.bind` will fail (a stream can only be bound
to one active broadcast). Either error out clearly or auto-end the
existing one first. Suggest the latter — it's what the operator
would want anyway.

**Re-test the auto-broadcast chat assumption:** I theorised
yesterday that YouTube Studio's auto-broadcast doesn't have
`enableLiveChat=true` set, but never actually verified after the
`/liveChat/messages` URL fix. If a test from Studio's Go Live ends
up working with chat, this whole feature might be unnecessary —
the operator can just use Studio + dashboard Start/Stop side by
side. Worth 2 minutes of testing before building.

**Estimated time:** ~45-60 min if we build it. Skip if the Studio
test passes.

---

## 2026-04-29 — YouTube full launch + encoder + Lena reply mode — LIVE

PR 2 (encoder) installed on Orion. End-to-end YouTube path now LIVE:
broadcast → chat poll → reply / shoutout → on air. Several gotchas
hit during install + a chat-bridge bug (PR 4 had the wrong API URL
all along — never worked in prod until today).

**Encoder install gotchas (all fixed in repo, baked into the systemd
unit at `deploy/systemd/numa-youtube-encoder.service`):**

- WSL2/WSLg makes `/tmp/.X11-unix` a read-only tmpfs → Xvfb can't
  bind. Fix: `ExecStartPre=+` umounts and recreates with chmod 1777
  on every start. Harmless on a real Linux VPS.
- `pkill -f "Xvfb :99"` in ExecStartPre matched the shell's own
  argv → killed itself. Fix: `[X]vfb` regex trick (the regex matches
  "Xvfb" but the literal "[X]vfb" in shell argv doesn't match the
  regex).
- Orphan ffmpeg from a smoke-test (`--smoke`) survived a restart and
  competed for Xvfb frames → real encoder pushed choppy video →
  YouTube buffered minutes ahead of live. Fix: ExecStartPre also
  kills `[f]fmpeg.*x11grab.*-i :99` and removes the smoke FLV.
- `StartLimitBurst` / `StartLimitIntervalSec` only work in `[Unit]`
  on modern systemd, NOT `[Service]`.
- ffmpeg's default `thread_queue_size=8` too small for 1920x1080
  x11grab → "Thread message queue blocking" warnings + frame drops.
  Bumped to 1024 video / 512 audio.
- libx264 preset is `ultrafast` (was `veryfast`) — Chrome's
  single-threaded render thread needs CPU more than ffmpeg does. Top
  showed Chrome at 98% on one core, ffmpeg at 10% — the bottleneck
  is render, not encode.
- Setting `ENCODER_FRAMERATE=15` in `/etc/numa/env` is the current
  config. 1080p15 fits comfortably on Orion's 12700H.

**PR 4 chat poller bugs that shipped silently with the original PR
(all fixed today):**

- Endpoint URL was `/liveChatMessages` (one word) → returned Google
  edge-router 404 (zero-byte text/html). Correct path is
  `/liveChat/messages` with a slash. The doc resource name
  ("liveChatMessages.list") misled the original author.
- Default dispatch URL was `https://api.numaradio.com/api/internal/
  youtube-chat-shoutout` — that subdomain is Icecast/Orion via
  cloudflared, not Vercel. Vercel app is `numaradio.com`. Cloudflare
  ate dispatches with HTML 404 silently. Now defaults to
  `numaradio.com/...`.
- Daemon **filters channel-owner + moderator messages by design** —
  when testing, post from a non-owner account.
- Per-author rate limit: 3 dispatches/hour, sliding window. Excess
  is dropped silently — no log line. Silence ≠ broken, just rate-
  limited. (See `workers/queue-daemon/youtube-chat-loop.ts`
  `AUTHOR_HOUR_LIMIT`.)

**YouTube auto-broadcast quirk (worked around with new script):**
when an encoder pushes RTMP into a "Default" stream with auto-start,
YouTube auto-creates a broadcast — but with `enableLiveChat` unset
at the API level. The watch-page chat shows fine, but
`/liveChat/messages` returns empty for that broadcast. Fix:
`scripts/youtube-go-live.ts` calls `liveBroadcasts.insert` with
`enableLiveChat=true`, `enableAutoStart=true`,
`enableAutoStop=false`, then binds it to the existing stream.
Encoder's running RTMP picks it up. Run once per session:

```
cd ~/saas/numaradio && npx tsx scripts/youtube-go-live.ts
```

Requires OAuth refresh token with `youtube.force-ssl` scope (the
original `youtube.readonly` token works for read-only PR 3/4
polling but can't insert/bind broadcasts). Token re-grabbed from
OAuth Playground today; same client ID/secret.

**Lena conversational reply mode (NEW):** PR 4 originally treated
every `@lena` message as a shoutout to be read out, which felt
wrong for messages that were addressed TO Lena ("thanks for this
one", "you're amazing", "tuning in from Tokyo"). Classifier is now
tri-state — `shoutout` / `reply` / `noise`. Reply path generates a
fresh 1-2 sentence response from Lena via MiniMax
(`lib/lena-reply.ts`) and dispatches to the dashboard's
`/api/internal/shoutout` with `skipHumanize=true` (skip the
"narrate the listener's words" rewrite). Shoutout path unchanged.
Borderline messages bias to reply.

**Operator override (NEW):** `approveShoutout` now accepts blocked
rows too, not just held — so if NanoClaw blocks a shoutout and the
operator says "actually approve it", the override works. Hard
guard remains "hasn't aired" (no duplicate audio). Audit trail
preserves the original block reason: `approved_by:operator
revived_from_blocked prior=<original>`.

**Dashboard YouTube card additions:**
- Quota meter (today's spend / 10000 daily limit, color-coded at
  75/90%, reset countdown in Pacific Time).
- Operator-tunable chat-poll cadence input (15-600 s, daemon picks
  up the change within 10 s — no restart).
- New endpoints: `GET /api/youtube/quota`, `POST
  /api/youtube/chat-cadence`.
- Schema: new `YoutubeQuotaUsage` table (date PK in PT,
  unitsUsed). New `Station.youtubeChatPollMs` column. Migration
  `20260429192000_add_youtube_quota_and_chat_poll_ms` applied.
- Dashboard polling dropped 30s → 60s to fit combined daily quota
  under 10k.

**Day-to-day workflow:**
- Going live fresh: end any current broadcast in Studio →
  `npx tsx scripts/youtube-go-live.ts` → encoder auto-attaches.
- New stream key → edit `/etc/numa/env` + `sudo systemctl restart
  numa-youtube-encoder`.
- Frontend `/live` change → same restart (Chromium tab doesn't
  auto-reload).

**VPS migration plan** (see `~/saas/MIGRATION.md`): Hetzner CX33
€7.49/mo or CPX32 €14.99/mo. Encoder profile recommendations by
tier baked in. Updated today with the 1080p15 / ultrafast /
thread_queue_size / pkill / X11-unix learnings.

---

**Older deploy notes are in `docs/HANDOFF-archive.md`.** This file
keeps only the last few days of actionable state, anything not-yet-
deployed, and the evergreen conventions. When picking up work: read
this, then fall back to the archive if a reference here points there.

---

## 2026-04-28 (evening) — Broadcast UX refinements — LIVE

After the four-PR launch (below) the design got iterated through
the evening:

- **YouTube-live banner** on the public site — pulses + links to
  the watch URL when a broadcast is active. Reads from
  `/api/youtube/state` (60s cached). `LiveOnYouTubeBanner.tsx`.
  Hidden on `/live` itself. Today silent (no broadcast yet);
  goes live tomorrow with the encoder install.
- **Time-of-day expression moved to the show-name gradient.**
  An earlier attempt to tint the background with magenta/purple
  read as off-brand. Reverted: dark-teal base stays clean. Time
  is now in an animated gradient sweep across the show name
  (e.g. "PRIME HOURS") — warm dawn (peach), daylight gold-teal,
  dusk pink/purple/blue, night blue/violet, late-night brand
  cyan. Slow shimmer (`background-position` animation, 8s).
- **Lena live-dot removed.** The red pulsing dot on her portrait
  competed with the ON AIR · LIVE pill in the top-right header.
  Breathing teal halo around the portrait does the host-cue work
  on its own (and brightens when her quote is fresh).
- **Dual-mode CTA in the footer.** Encoder mode (`?broadcast=1`,
  the YouTube viewer copy) → "Type **@lena** in chat — hear her
  read it on air." Preview mode (`numaradio.com/live`) →
  unchanged "Type a message at numaradio.com — hear Lena read it
  on air." Audience-aware ask, same conversion.
- **Mobile `/live` single-column stack** for viewports ≤ 700px in
  preview mode. Encoder still runs at exactly 1920×1080 on Orion.
- **Bg atmosphere dialled to taste**: `.bcast-glow` blur 30px,
  `.bcast-grain` opacity 4%. Operator picked these after walking
  through three sharpness levels.

Commits between `0c7a88d` and `880a56b` on `main`. ~10 commits in
the evening session, all on the broadcast surface.

---

## 2026-04-28 — YouTube 24/7 broadcast — PR 1, 3, 4 LIVE; PR 2 NEEDS INSTALL TOMORROW

Two-PR ship in flight, only PR 2 left.

### PR 1 — `/live` page (LIVE on Vercel) — `b7e2452` on `main`
A purpose-built 16:9 broadcast stage at <https://numaradio.com/live>
that shares the in-app expanded-player's visual DNA: big Lena portrait
with teal halo + live-dot, NUMA·RADIO wordmark + show clock, ON AIR
pulse + listener-count pill, 3-column main (Lena / now-playing /
booth feed), persistent REQUEST CTA, scanlines + film grain + radial
vignette + time-of-day hue shift. Container-query-units (cqw/cqh)
throughout — same proportions at 1920×1080 (encoder) and any preview
viewport. The broadcast surface is wrapped in
`position: fixed; inset: 0` so it's pinned regardless of any body
styles (fixed a first-paint flash where the bottom CTA was the only
thing visible).

`/live?broadcast=1` is what the encoder will hit — hides the
fullscreen button, sets `cursor: none`, hard-mutes any audio (the
encoder muxes Icecast directly).

Spec: `docs/superpowers/specs/2026-04-28-youtube-live-broadcast-design.md`.

### PR 2 — Orion encoder service (CODE READY, INSTALL TOMORROW) — `44fc281` on `main`
`deploy/numa-youtube-encoder.sh` + `deploy/systemd/numa-youtube-encoder.service`
+ sudoers entry. Pipeline: `Xvfb :99 → headless Chromium kiosk on
/live?broadcast=1 → ffmpeg x11grab + Icecast audio → RTMP to YouTube`.
One systemd unit owns all three subprocesses with a cleanup trap so
restart leaves no orphans. `RuntimeMaxSec=86400` forces a daily clean
restart so a long-running Chromium can't leak forever.

**Operator install steps** (one-time, after PR 2 lands on `main`):

1. **Get a YouTube stream key** — <https://studio.youtube.com> →
   Create → Go Live → Stream → "Default" stream → copy stream key.
   You can also create a permanent stream so the same key is reused
   across restarts.

2. **Add the key to `/etc/numa/env` on Orion**:
   ```
   sudo nano /etc/numa/env
   # add: YOUTUBE_STREAM_KEY=xxxx-xxxx-xxxx-xxxx-xxxx
   sudo chmod 0600 /etc/numa/env
   ```

3. **Install dependencies** (Ubuntu/WSL2):
   ```
   sudo apt-get update
   sudo apt-get install -y xvfb x11-utils ffmpeg
   # Browser — google-chrome-stable is most reliable on WSL2:
   wget -qO- https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
   echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
   sudo apt-get update
   sudo apt-get install -y google-chrome-stable
   # (Or `chromium` from the Snap or your distro repo — the script
   #  detects either binary.)
   ```

4. **Smoke-test the encoder before pushing real traffic to YouTube**:
   ```
   cd /home/marku/saas/numaradio
   git pull
   export YOUTUBE_STREAM_KEY=smoke
   bash deploy/numa-youtube-encoder.sh --smoke
   # Stop with Ctrl-C after ~30 seconds.
   ffprobe /tmp/numa-encoder-smoke.flv
   # Expect: 1920x1080 30fps H.264 + 44100Hz stereo AAC.
   ```

5. **Install the service**:
   ```
   sudo install -m 0755 deploy/numa-youtube-encoder.sh /usr/local/bin/
   sudo install -m 0644 deploy/systemd/numa-youtube-encoder.service /etc/systemd/system/
   sudo install -d -o marku -g marku /var/lib/numa/chromium-broadcast
   # Refresh the sudoers drop-in so the new restart line takes effect:
   sudo install -m 0440 deploy/systemd/numa-nopasswd.sudoers /etc/sudoers.d/numa-nopasswd
   sudo visudo -c   # parsed OK
   sudo systemctl daemon-reload
   sudo systemctl enable numa-youtube-encoder
   sudo systemctl start numa-youtube-encoder
   ```

6. **Verify**:
   - `systemctl status numa-youtube-encoder` — active (running)
   - `journalctl -u numa-youtube-encoder -f` — should see one
     `[encoder] streaming → rtmp://a.rtmp.youtube.com/live2/<redacted>`
     and then ffmpeg reporting `frame=  N fps= N q= ...` lines.
   - <https://studio.youtube.com> live dashboard → **Stream health:
     Excellent** within ~30 s of `Start streaming`.
   - On Orion, capture the rendered Chromium frame:
     `DISPLAY=:99 import -window root /tmp/broadcast.png`
     then `scp` it back to your desktop and confirm it looks like
     `/live?broadcast=1`.

7. **Restart on `/live` redeploy**: when you push a frontend change to
   `/live`, the running Chromium tab won't auto-reload — give it a
   nudge:
   ```
   sudo systemctl restart numa-youtube-encoder
   ```
   ~10 s gap on the broadcast. The daily auto-restart
   (`RuntimeMaxSec=86400`) catches anything you forget.

**Knobs** (override in `/etc/numa/env`):
- `BROADCAST_URL` — defaults to `https://numaradio.com/live?broadcast=1`
- `ICECAST_URL` — defaults to `https://api.numaradio.com/stream`
- `ENCODER_VIDEO_BITRATE` — kbps for H.264, default 4500 (YouTube's
  recommended for 1080p30)
- `ENCODER_AUDIO_BITRATE` — kbps for AAC, default 192
- `ENCODER_FRAMERATE` — default 30. Bump to 60 only if Orion's CPU
  has headroom (encoding 1080p60 with libx264 veryfast is ~2× the
  cost of 1080p30).

**Music rights:** Suno Pro tier (commercial use rights for new songs,
verified 2026-04-28). MiniMax music-2.6 output is owned by us under
their commercial API terms. Both safe to broadcast.

---

## 2026-04-28 — Dashboard YouTube health card (PR 3) — CODE READY, NEEDS OAUTH

A new `YoutubeCard` on the operator dashboard reads YouTube Data API
v3 every 30s and shows: stream state pill (LIVE / DEGRADED / NO INGEST
/ READY / OFF AIR / API ERROR), concurrent viewer count, broadcast
title, watch + Studio links. The card sits between BandwidthPill and
HeldShoutoutsCard on `/`.

**Files added:**
- `dashboard/lib/youtube.ts` — OAuth refresh-token flow, `fetchYoutubeSnapshot()`
  with 30s in-process cache. Quota cost: 3 units per snapshot
  (broadcasts.list + streams.list + videos.list). At 30s polling that's
  ~8.6k units/day — under the 10k default quota with headroom for any
  other YouTube calls we add later.
- `dashboard/app/api/youtube/health/route.ts` — GET endpoint, `force-dynamic`,
  returns the snapshot JSON.
- `dashboard/components/youtube-card.tsx` — pill + viewers + title + links.
- `dashboard/app/page.tsx` — wired in.

**One-time OAuth setup** (do this once; the refresh token never
expires unless you revoke it in your Google Account):

1. **Create a Google Cloud project + enable the YouTube Data API v3**:
   - <https://console.cloud.google.com> → New Project (or reuse one).
   - APIs & Services → Library → search "YouTube Data API v3" → Enable.

2. **Configure the OAuth consent screen**:
   - APIs & Services → OAuth consent screen → External → fill the
     minimum fields (app name "Numa Radio Dashboard", support email,
     dev email).
   - Scopes: add `https://www.googleapis.com/auth/youtube.readonly`.
   - Test users: add the Google account that owns the @numaradio
     YouTube channel.

3. **Create OAuth 2.0 Client ID credentials** (Web application type):
   - APIs & Services → Credentials → Create Credentials → OAuth client ID.
   - Application type: **Web application**.
   - Authorised redirect URIs: add
     `https://developers.google.com/oauthplayground` (only used for the
     one-time refresh-token grab below).
   - Save. Note the **Client ID** and **Client Secret**.

4. **Get a refresh token via the OAuth Playground**:
   - <https://developers.google.com/oauthplayground/>
   - Top right ⚙ → "Use your own OAuth credentials" → paste the
     Client ID + Client Secret from step 3. Tick "Force prompt".
   - Step 1 (Select & authorize APIs): in the input box at the
     bottom of the long list, type
     `https://www.googleapis.com/auth/youtube.readonly` and click
     "Authorize APIs". Sign in with the @numaradio channel's Google
     account.
   - Step 2 (Exchange authorization code for tokens) → click the
     button. Copy the **Refresh token** that appears on the right.

5. **Add the three secrets to Vercel** (Project → Settings → Environment
   Variables, scope: Production + Preview):
   ```
   YOUTUBE_OAUTH_CLIENT_ID       <client id from step 3>
   YOUTUBE_OAUTH_CLIENT_SECRET   <client secret from step 3>
   YOUTUBE_OAUTH_REFRESH_TOKEN   <refresh token from step 4>
   ```
   Redeploy or push a commit so the new env reaches the dashboard.

**Without these env vars**, the card renders "API ERROR" with a tooltip
saying "missing YOUTUBE_OAUTH_*". Until then everything else on the
dashboard keeps working — the route is isolated.

**Verify after env is set:**
- Open `dashboard.numaradio.com/` → the YouTube card shows a pill.
- With the encoder offline: state should be `OFF AIR` (or `READY` if
  you have a scheduled stream).
- Once the encoder is pushing: pill flips to `LIVE · GOOD` within
  30-60 s, viewer count populates within 1-2 minutes (YouTube
  suppresses very low values).

**Quota:** the API console at
<https://console.cloud.google.com/apis/dashboard> shows live usage.
If you ever blow through 10k/day, request a quota bump (free, 2-3
weeks turnaround) or back the polling off to 60s in
`dashboard/app/page.tsx` (drops daily cost to ~4.3k).

---

## 2026-04-28 — YouTube live chat → shoutouts (PR 4) — CODE READY, NEEDS DAEMON RESTART + ENV

queue-daemon now polls the active YouTube broadcast's live chat every
90s and pipes new messages through the existing shoutout pipeline
(MiniMax moderator → if held → NanoClaw on Telegram + dashboard chat
→ if allowed → Lena radio-host rewrite + Deepgram TTS + B2 + queue
push). Inert (skipped + logged at boot) until the operator drops
the OAuth env vars in `/etc/numa/env`.

**Files added:**
- `workers/queue-daemon/youtube-chat-client.ts` — OAuth + low-level
  YouTube Data API v3 calls. Caches `liveChatId`, paginates message
  fetches with `nextPageToken`, drops the initial backlog so we don't
  air everything posted before the daemon came online. 12 tests.
- `workers/queue-daemon/youtube-chat-loop.ts` — orchestrator.
  Per-author rate limit (3/hr, 8/day per `authorChannelId` — sliding
  window). Skips channel-owner + moderator messages. Length bounds
  match the booth (4-240 chars). Dispatches to the new internal
  endpoint.
- `app/api/internal/youtube-chat-shoutout/route.ts` — Vercel internal
  endpoint, `x-internal-secret` guarded. Mirrors `/api/booth/submit`
  moderation + held flow but without IP rate-limit. Idempotent on
  YouTube message ID via `Shoutout.fingerprintHash` (`yt:<msgId>`)
  so a daemon restart can't double-fire.

**Quota math (combined with PR 3 dashboard health):**
- liveBroadcasts.list (cold-start): 1u
- liveChatMessages.list: 5u per call, 90s cadence → ~3,300/day
- PR 3 dashboard health (60s would be safer if you enable PR 4):
  ~4,300/day
- Combined: ~7,600/day. Comfortable under the 10k default.
- **Recommended:** when both PRs are live, drop dashboard polling to
  60s by changing `30_000` → `60_000` in `dashboard/app/page.tsx`'s
  `usePolling<YoutubeBroadcastSnapshot>` line.

**Setup steps** (after the OAuth env from PR 3 is in Vercel):

1. **Add the same OAuth credentials to Orion's `/etc/numa/env`** so the
   daemon can poll. INTERNAL_API_SECRET should already be there.
   ```
   sudo nano /etc/numa/env
   # add the same three values you put in Vercel for PR 3:
   # YOUTUBE_OAUTH_CLIENT_ID=...
   # YOUTUBE_OAUTH_CLIENT_SECRET=...
   # YOUTUBE_OAUTH_REFRESH_TOKEN=...
   sudo chmod 0600 /etc/numa/env
   ```

2. **Pull + restart the daemon**:
   ```
   cd /home/marku/saas/numaradio && git pull
   sudo systemctl restart numa-queue-daemon
   ```
   The Vercel internal endpoint deploys automatically with the push.

3. **Verify**:
   ```
   journalctl --user -u numa-queue-daemon -f | grep yt-chat
   ```
   On boot you should see:
   `[queue-daemon] YouTube chat poller enabled (90s cadence)`
   When a broadcast is live and someone sends a chat message:
   `[yt-chat] dispatched queued from <name> (<channel-id-suffix>): "..."`
   When off-air: silence (the loop early-returns after the 1u
   `liveBroadcasts.list` call).

4. **Test end-to-end**:
   - Make sure the encoder (PR 2) is running so a YouTube broadcast
     is actually live.
   - From a different YouTube account (not the channel owner — those
     get filtered), send a chat message on your live stream.
   - Within ~2 minutes you should hear it air on numaradio.com.
   - Send a profanity-laced one and verify it lands in the dashboard
     **/shoutouts** held queue (or shows up in the Telegram bot if
     NanoClaw is up).

**Rate limit behaviour:**
- 3 dispatches/hour per author channel ID
- 8 dispatches/day per author channel ID
- Excess messages are silently dropped (logged but not aired). The
  YouTube user sees their message in chat normally; they just don't
  get put on air.
- The window is in-memory (per daemon process) — a daemon restart
  resets the counter. That's intentional: a 90s poll cycle plus
  systemd's 15s restart delay means abuse-via-restart isn't viable.

**Disabling without code change:**
Comment out any of `YOUTUBE_OAUTH_CLIENT_ID` / `_SECRET` /
`_REFRESH_TOKEN` in `/etc/numa/env` and restart the daemon. Boot log
will say `YouTube chat poller DISABLED` and nothing else changes.

---

## 2026-04-26 (evening) — Lena Tier 2.5 + content-pipeline polish — LIVE

A long session. Multiple connected ships:

**Tier 2.5 — world_aside chatter (Brave + MiniMax)**
3 of every 20 auto-chatter slots become short Lena asides about
real outside-world facts (weather in 5 cities, music news, AI/tech,
on-this-day, light culture, astro events). Direct path: queue-daemon
picks topic by weighted random + anti-repeat → Brave Search →
MiniMax writes Lena-voice line → validated → broadcast through the
existing TTS pipeline. Dashboard `/shoutouts` got a second 3-state
toggle (Auto/Forced On/Forced Off) mirroring auto-chatter; toggle B
inherits A's listener gate (silent when nobody's listening).

NanoClaw is **NOT** involved — the spec originally routed through
NanoClaw's chat HTTP channel but we switched to direct (simpler,
single repo, fewer moving parts). Spec amendment at the top of
`docs/superpowers/specs/2026-04-26-lena-world-aside-design.md`
documents the pivot.

Brave key location: `BRAVE_API_KEY=...` in `/etc/numa/env` (already set).
Smoke test: `BRAVE_API_KEY=$(sudo grep '^BRAVE_API_KEY=' /etc/numa/env | cut -d= -f2- | tr -d '\r\n"') npx tsx scripts/test-world-aside.ts`
(6/6 categories produce concrete in-voice lines).

**"Next up" rotation indicator + click-to-override**
`/shoutouts` shows the next 5 rotation slots as chips. Clicking one
forces it as the next chatter type (one-shot override consumed by
the daemon). World aside chips show "→ filler" demotion when toggle
B is forced_off so operators see what listeners will actually hear.

**Lena visual integration**
- Canonical portrait (`numaradio-videos/src/assets/lena/lena-v1.png`)
  copied into `public/lena/portrait.png`
- Replaces the "L" gradient placeholder in PlayerCard (36px) and
  About page (240px feature with teal halo + live quote)
- Inner `.lena-avatar-frame` div clips circular without clipping the
  live-dot. Image scaled 1.3× anchored at 50%/45% (small) or 1.0×
  (feature) for proper face framing.
- Live-dot pulses when source is `live` or `context` (real fresh
  chatter), static when `pool`. Honors prefers-reduced-motion.
- 900ms CRT "tune-in" animation when the quote changes (blur clears,
  glowing teal text-shadow dissipates, letter-spacing snaps back).

**Lena cadence + content fixes**
- Context-line TTL: 30 min → 10 min (was too stale-feeling).
- Removed `currentListeners` from context state — drifted faster
  than 10-min context refresh. Lena now talks about other facts
  (shoutout/track counts, votes, top genre) which age 0-2 between
  ticks. Generic listener phrasings allowed ("whoever's around").
- Token-based numerical-claim parser handles compound words:
  "one hundred and eight" → 108 (was [100, 8] which dropped many
  truthful lines). +6 tests covering scale words.
- Pool tone scrub: regenerated all 600 quotes with banned-aloof-
  phrases regex ("fine by me", "I don't mind", "doesn't bother me").
  Lena always warms toward listeners, never shrugs them off.

**Error pages — branded 404 / 500 / global-error**
- `app/not-found.tsx` "OFF THE DIAL · ERR 404" with a teal tuner-
  needle drift animation
- `app/error.tsx` "STATIC · STAND BY · ERR 500" same dial in red
  with jagged step animation
- `app/global-error.tsx` minimal inline-styled fallback "OFF AIR ·
  CRITICAL"
- All three reuse Nav + Footer (where applicable). Honors
  prefers-reduced-motion.

**Frame-accurate track durations (root-cause fix)**
The public site was flipping artwork → placeholder in the last
20-30s of long tracks. Root cause: `music-metadata` was being called
without `{ duration: true }`, using the unreliable Xing/VBRI header
estimate. AI-generated MP3s often have bad headers → catalogue
durations off by 30-90s.

Fix:
- `lib/probe-duration.ts` — pure-JS wrapper around music-metadata
  in full-scan mode (frame-accurate). Supports file paths, HTTP URLs
  (streamed), and Buffers. ffmpeg now installed on Orion (handy for
  future use, not required by the current code path).
- Wired into `scripts/ingest-seed.ts` and `workers/song-worker/pipeline.ts`
- `scripts/backfill-track-durations.ts` re-probes every Track's B2
  asset via HTTP and updates Track + TrackAsset rows. Dry-run by
  default, `--apply` writes. **Backfill ran successfully** —
  6 tracks updated, biggest delta `Dashboard Glow: 195s → 285s`
  (was 90s short!).
- `STALE_GRACE_SECONDS` reverted from 120s back to 30s now that
  durations are accurate.

Future Suno-numa-radio drafts and listener-generated MiniMax songs
will all probe correctly at ingest time.

**To pick up daemon hygiene** (not urgent, public-site fix is live
via Vercel):
```
sudo systemctl restart numa-queue-daemon   # passwordless via sudoers
sudo systemctl restart numa-song-worker    # needs password
```

Commits between `f434fb8` and `5c3e847` on `main`. ~30 commits in
the day. All tests passing (210+ across daemon + new probe).

---

## Lena Tier 2.5 — world_aside chatter — CODE READY, NEEDS BRAVE KEY (2026-04-26)

Lena's "ears and eyes" — 3 of every 20 auto-chatter slots become
short asides about real outside-world facts (weather in 5 cities,
music news, AI/tech news, on-this-day, trending culture, astro events).
queue-daemon picks a category, hits Brave Search, prompts MiniMax for
a Lena-voice line, validates, broadcasts. Same pipeline as auto-chatter
from TTS onward.

**Spec:** `docs/superpowers/specs/2026-04-26-lena-world-aside-design.md`
(see the "Architecture amendment" at the top — final implementation
is direct Brave + MiniMax, not via NanoClaw).

**Schema change (already applied to Neon, migration
`20260426191605_add_world_aside_mode`):** three new columns on
`Station`: `worldAsideMode`, `worldAsideForcedUntil`,
`worldAsideForcedBy`. Mirror the existing autoHost trio. Reuses the
existing `AutoHostMode` enum.

**New files / edits:**
- `workers/queue-daemon/world-aside-client.ts` — topic picker
  (weighted random + anti-repeat), Brave search client, prompt
  builder, validator, `fetchWorldAside()` entry point
- `workers/queue-daemon/world-aside-client.test.ts` — 20 tests
- `workers/queue-daemon/auto-host.ts` — new `world_aside` branch in
  `generateAsset()`, `recentWorldTopics` ring buffer (cap 10),
  graceful demote-to-filler on any failure
- `workers/queue-daemon/chatter-prompts.ts` — rotation rewritten so
  W slots land at 4/10/16 (perfectly even), filler safety net at 14,
  BA preserved at 10/20
- `workers/queue-daemon/station-config.ts` — config shape gains
  `worldAside` block alongside `autoHost`
- `workers/queue-daemon/index.ts` — `fetchWorldAside` dep wired,
  `revertExpired` extended to cover both blocks
- `dashboard/app/api/shoutouts/world-chatter/route.ts` — GET + POST
  for the second toggle, mirrors auto-host route
- `dashboard/app/shoutouts/page.tsx` — second segmented control,
  status row composes with toggle A's gate

**Deploy steps** (once Brave key is in hand — get a free 2k/month
key at <https://api.search.brave.com/app/keys>):

1. Add `BRAVE_API_KEY` to `/etc/numa/env` on Orion:
   ```
   sudo nano /etc/numa/env
   # add: BRAVE_API_KEY=BSA...your-key-here
   sudo chmod 0600 /etc/numa/env
   ```
2. Pull and restart the daemon:
   ```
   cd /home/marku/saas/numaradio && git pull
   sudo systemctl restart numa-queue-daemon
   ```
   The migration is already applied; no `prisma migrate deploy` needed.
3. Deploy the dashboard (auto-host UI + new world-chatter UI + API):
   ```
   cd dashboard && npm run deploy
   ```
4. Toggle World chatter to Auto on `dashboard.numaradio.com/shoutouts`.

**Watch after deploy:**
```
journalctl --user -u numa-queue-daemon -f | grep -E "auto-chatter|world_aside"
```
Expect ~3 world asides per cycle (every ~60 min at full pelt).
Failures show as `[auto-chatter] fail world_aside_<reason>`. Reasons:
`no_brave_key`, `brave_search_failed`, `no_good_angle`, `banned_phrase`,
`too_long`, `clock_time`, `minimax_failed:...`.

**Verify on the public site:**
The world_aside row writes a Chatter row with `chatterType="world_aside"`
+ a real audio URL. The existing `/api/station/lena-line` route returns
these as `live` source (it filters out `context_line` only) — listeners
see "Host · Live · just now: 'Tokyo's seeing rain right now…'".
Bonus surface, no extra wiring.

**Cost / budget:** ~24 calls/day at full pelt against Brave's free
2000/month tier (~36% utilisation, comfortable headroom).

---

## Stack audit pass — LIVE (2026-04-25)

A 7-agent parallel audit + 9-session fix sweep. Full plan, findings,
and per-session breakdown:

- `docs/superpowers/specs/2026-04-25-stack-audit-plan.md`
- `docs/superpowers/specs/2026-04-25-stack-audit-findings.md`
- `docs/superpowers/specs/2026-04-25-stack-audit-summary.md`

**Headline:** 65 findings shipped, 2 P0 security fixes (XFF
spoofing + a non-timing-safe internal-secret compare), tests grew
188 → 200, both apps build clean, all systemd-controlled services
restarted with new code in place. Commits `466ab3f` through
`74698d5` on `main`.

**Operator follow-ups (need sudo, can't be automated):**
1. `sudo bash deploy/secure-numa-env.sh` — chmod 0600 on
   `/etc/numa/env`. One-time hardening.
2. Re-install systemd templates so the new `StartLimitBurst` /
   updated `EnvironmentFile=` actually take effect:
   ```
   sudo install -m 0644 deploy/systemd/numa-queue-daemon.service /etc/systemd/system/
   sudo install -m 0644 deploy/systemd/numa-song-worker.service /etc/systemd/system/
   sudo install -m 0644 deploy/systemd/numa-liquidsoap.service /etc/systemd/system/
   sudo install -m 0644 deploy/systemd/numa-dashboard.service /etc/systemd/system/
   sudo systemctl daemon-reload
   ```
3. `sudo systemctl restart numa-song-worker` (not in sudoers
   allowlist, so picks up the new timeout + SSRF code only after a
   manual restart).
4. Watch DevTools CSP-violation console for a week. Both
   `next.config.ts` files ship `Content-Security-Policy-Report-Only`.
   When the console stays clean, flip the header key to
   `Content-Security-Policy` to enforce.

**Behavioural changes a future session should know about:**
- The `shoutout-ended` Liquidsoap callback now sends
  `{sourceUrl}` in the body. The Vercel route resolves trackId
  from the body first, then falls back to NowSpeaking. This makes
  a double-fire cleanup-safe.
- queue-daemon `/status` JSON now includes a `lastHydrationError`
  field ({at, message} | null).
- PlayHistory `endedAt` and `completedNormally` are now closed
  out by the next `track-started` (was always {endedAt: null,
  completedNormally: true}).
- 23 findings deferred with reasoning — see the audit-summary doc
  before re-opening any of them.

---

## Auto-chatter listener gating — LIVE (2026-04-24)

Replaces the boolean `autoHostEnabled` toggle with a tri-state:
`auto` / `forced_on` / `forced_off`. In `auto` mode, Lena only speaks
when the raw Icecast listener count is ≥5 (fail-closed if Icecast
unreachable). Forced states expire after 20 min back to `auto` — so a
forgotten force ("left it On for testing") can't run forever to an
empty room.

- `prisma/schema.prisma` — `AutoHostMode` enum, `autoHostMode` +
  `autoHostForcedUntil` + `autoHostForcedBy` columns on `Station`,
  old `autoHostEnabled` dropped.
- `workers/queue-daemon/station-config.ts` (new, replaces
  `station-flag.ts`) — 30s TTL cache of `{mode, forcedUntil, forcedBy}`.
- `workers/queue-daemon/icecast-listeners.ts` (new) — `parseListenerCount`
  + `fetchListenerCount`; returns null on any fetch/parse error.
- `workers/queue-daemon/auto-host.ts:runChatter()` — new gating block:
  reads config, lazy-reverts expired forced states (atomic UPDATE WHERE
  forcedUntil = stored so we don't clobber a concurrent operator toggle),
  then branches on mode. `auto` with `listeners === null || listeners <
  5` → skip.
- Dashboard `/shoutouts` — three-button segmented control (Auto · Forced
  On · Forced Off) with a live countdown on forced states and a
  "currently On/Off (N listeners)" label in Auto mode, polled every 15s
  via new `GET /api/station/listeners`.
- API `POST /api/shoutouts/auto-host` body changed from `{enabled:bool}`
  to `{mode: "auto"|"forced_on"|"forced_off"}`.
- NanoClaw agent tool `/api/internal/tools/autochatter-toggle` kept its
  legacy `{enabled:bool}` contract but now writes the tri-state columns
  under the hood: true → `forced_on` 20m, false → `forced_off` 20m.

**Deploy** (ordering matters — running daemon errors after migration
lands because `autoHostEnabled` column is gone):
```
cd /home/marku/saas/numaradio && git pull
npx prisma migrate deploy
sudo systemctl restart numa-queue-daemon
cd dashboard && npm run deploy
```
Gap between migration and daemon restart is seconds; old daemon may
log one or two failed selects, harmless.

**Watch after restart:**
- `/shoutouts` shows three-button control with live listener count
- `journalctl --user -u numa-queue-daemon -f` — `auto_host_auto_revert`
  line appears ~20min after a forced toggle with no operator action
- With <5 listeners + Auto mode, no chatter pushes between tracks
- With Forced On + 0 listeners, chatter still fires every 2 tracks

---

## Marketing videos — LAUNCH SET SHIPPED (2026-04-24)

Sibling repo `~/saas/numaradio-videos` produces vertical videos for
TikTok / YouTube Shorts. Phases 1 + 2 complete — full 5-piece launch
set rendered, user-approved, and sitting in
`C:\Users\marku\Desktop\numaradio-launch-videos\`:

- `listen-now.mp4` (15s) — brand piece, "The Station That Never Sleeps"
- `shoutout-flagship.mp4` (15s) — magic loop: type a message, hear
  Lena read it on air live
- `meet-lena.mp4` (53s) — character piece with canonical Flux Pro
  portrait, "MEET YOUR HOST" hook, four-show montage, closer
- `song-request-demo.mp4` (30s) — describe a mood, watch Lena make
  a track, 16-second money beat of the real generated song
- `day-in-numa.mp4` (30s) — four-show day montage (00:00 → 06:00 →
  12:00 → 18:00) with per-show voice clips and music ducking

Voice: Helena (`aura-2-helena-en`) approved as the primary model.
Music beds: three curated from the Numa catalog, bed-01 extended to
35s for DayInNuma coverage. One-off MiniMax+Flux track "Nightwarm"
committed to the videos repo (3min source, money beat starts at 47s).

**Verify any piece:**

    cd ~/saas/numaradio-videos && npm run render <CompositionId>
    # IDs: ListenNow, ShoutoutFlagship, MeetLena, SongRequestDemo, DayInNuma

**Specs / plans** (in this repo, `docs/superpowers/`):
- `specs/2026-04-24-marketing-videos-design.md` — overall
- `specs/2026-04-24-lena-canonical-portrait-design.md` — Stage 2a
- `specs/2026-04-24-shoutout-flagship-design.md` — Stage 2b
- `specs/2026-04-24-meet-lena-design.md` — Stage 2c.1
- `specs/2026-04-24-song-request-demo-day-in-numa-design.md` — Stage 2c.2

**Primitives inventory** (12 total, all in videos repo):
ScanLines, FilmGrain, LiveChip (top:140), EyebrowStrip (top:140),
Wordmark, Waveform, PulsingDot, EqBars, TypedText, MusicBed,
LenaPortrait, ShowPanel. Plus SFX: `keyboard-typing.mp3`, `submarine-ping.mp3`.

**Next:** Phase 3 — Prisma data pickers + templated daily/weekly
series. ShoutoutOfTheDay template reuses ShoutoutFlagship primitives
with a real DB pick; SongOfTheWeek reuses SongRequestDemo with a
listener-generated track pick. Adds `npm run video:shoutout` / `:song`
ops wrappers so a future session can render daily content in one
command. Also worth extracting at Phase 3 time: `PayoffSection`
primitive (identical 5× across current comps) and `musicDuckEnvelope`
utility (written 3× already).

---

## Lena time-of-day context — CODE READY, NEEDS DAEMON RESTART (2026-04-24)

Fixes auto-chatter saying "tonight" at 08:40 AM. Root cause: few-shot
examples in `workers/queue-daemon/chatter-prompts.ts` had "tonight"
baked in, and the prompt carried no wall-clock signal, so MiniMax
pattern-matched the examples regardless of actual hour.

- `lib/schedule.ts` — new `TimeOfDay` type + `timeOfDayFor(h)` +
  `formatLocalTime(d)` helpers (bucket: 0-4 late night, 5-11 morning,
  12-16 afternoon, 17-20 evening, 21-23 night).
- `workers/queue-daemon/chatter-prompts.ts` — `PromptContext` gains
  `localTime` + `timeOfDay`, rendered as `- Local time: 08:40
  (morning)`. BASE_SYSTEM rule rewritten: time-of-day phrasing allowed
  **only if Local time is given**, must match it. Examples in
  `back_announce`, `shoutout_cta`, `filler` now mix
  morning/afternoon/evening/time-neutral with `[use when morning]`
  metadata tags and an explicit "never speak the brackets aloud"
  instruction. `song_cta` kept neutral — time doesn't fit the
  song-generation pitch.
- `workers/queue-daemon/auto-host.ts:296-308` — always passes
  `localTime` + `timeOfDay` from `deps.now` into every break,
  unthrottled (unlike `currentShow`'s 15% gate).
- `scripts/preview-chatter.ts` — samples now carry time context so
  dev preview matches prod.
- Tests: +4 in `chatter-prompts.test.ts`, +1 in `auto-host.test.ts`
  (pins time to the exact 08:40 scenario that fired "tonight" on
  air). 60/60 chatter tests, 109/109 worker tests, `next build`
  clean.

**Deploy:** `cd /home/marku/saas/numaradio && git pull && sudo
systemctl restart numa-queue-daemon` on Orion. Prompt-only change, no
binary moves.

**Watch after restart:** first few auto-chatter breaks. If "tonight"
still leaks at 08:40 AM, the few-shot rewrite wasn't strong enough
and we tighten further. Preview a batch without going live:
`npx tsx scripts/preview-chatter.ts` (burns ~8 MiniMax calls, prints
samples with word counts).

---

## Latest shipped (2026-04-23 night) — LIVE

Three independent changes deployed tonight. Related theme: make Lena
feel human, stop shoutouts from leaving litter behind.

1. **Booth submit UX** — shoutout POST returns in ~2 s (was 20-40 s);
   pipeline runs in `after()`. New `GET /api/booth/shoutout/[id]/status`
   plus `numa.shoutout.last` localStorage ping on focus surfaces silent
   failures. Song pending state persists across tab-switches via
   `numa.song.pending` + helpers in `lib/booth-stash.ts` (6 unit tests).
   `.req-pending` card in Lena's voice
   (`app/styles/_design-overrides.css`). Field-level validation on
   both forms. Spec:
   `docs/superpowers/specs/2026-04-23-submit-feedback-lena-human-design.md`.

2. **Shoutout lifecycle** — aired shoutouts now auto-delete (Track +
   TrackAsset + QueueItem + PlayHistory + B2 MP3).
   `/api/internal/shoutout-ended` → `lib/delete-aired-shoutout.ts`,
   which refuses anything that isn't `external_import + request_only`,
   so music can't be nuked. `Shoutout` audit row survives. Dashboard
   library's `+ Shoutouts` filter removed. Re-runnable if the callback
   ever misses: `npx tsx scripts/purge-orphan-shoutouts.ts`.

3. **NanoClaw held-notify fix** (NanoClaw `62ae4c7` + numaradio
   `21af532`) — `src/ipc.ts` now stores in SQLite first, then sends to
   Telegram, so the agent's next container session sees the
   held-shoutout prompt in `getMessagesSince()`. Dashboard passes
   `persistInContext: true` + `senderName: "Dashboard"` explicitly.

**Verify held-notify on prod:** submit a shoutout with `fuck` from
numaradio.com → Telegram DM → reply `no` → agent should reply
"Blocked." within ~10 s and the dashboard's held card disappears
within ~8 s. Container logs if it misbehaves:
`docker logs --tail 100 $(docker ps --format '{{.Names}}' | grep nanoclaw-telegram-main)`.

**Deploy state:** numaradio `main` at `e73c710`, nanoclaw `main` at
`62ae4c7`, dashboard rebuilt + restarted on Orion, 52 orphan shoutouts
purged.

**Where to pick up tomorrow:**
- Verify the NanoClaw fix on prod (recipe above).
- Booth UX only smoke-tested via `next build` + unit tests. Worth a
  30-s browser tour: submit a shoutout (should confirm in ~2 s),
  submit a song (pending card survives tab switch, shows rotator in
  Lena's voice), try submitting either with required fields empty
  (fields should highlight red).
- If auto-delete ever misses one, it shows briefly in the dashboard
  library (filter is just a UI hide) — re-run the purge script.

---

## Lena auto-chatter voice tuning — LIVE (2026-04-23)

Loosened Lena's auto-chatter to sound like a DJ who riffs around
track-IDs. Voice model swapped **Andromeda → Luna** (`aura-2-luna-en`,
friendly/upbeat) across `workers/queue-daemon/deepgram-tts.ts` and
`dashboard/lib/shoutout.ts`. Asteria is the 4xx fallback; next
step-downs if Luna doesn't stick are Helena (warm) or Thalia
(presenter).

- Shared show grid in `lib/schedule.ts` (imported by `Schedule.tsx` +
  `auto-host.ts`) — frontend and queue-daemon can't drift.
- MiniMax `temperature: 1.0` pinned explicitly in
  `minimax-script.ts`. Knobs for v1.1: bump to 1.1 if still same-y,
  0.8 if poetry drifts back.
- Show-name reference gated behind a 15% random roll in
  `auto-host.ts:generateAsset` (`deps.randomGate` injectable for
  tests) — listeners hear one roughly every ~40 min instead of every
  ~6 min.
- `broadcastText` now persists what Lena actually said —
  `generateShoutout()` returns `spokenText`, booth route persists it.
  Existing rows have stale `broadcastText` (not worth backfilling).
  Agent Compose + operator Compose paths don't write Shoutout rows
  today; if we want those in the log, that's the next addition.
- **Preview prompt changes without burning API from tests:**
  `npx tsx scripts/preview-chatter.ts` — hits real MiniMax, prints 8
  samples with word counts. Dev-only.

**Redeploy:** prompts/state machine → `git pull && sudo systemctl
restart numa-queue-daemon`. Frontend schedule labels → `git push
origin main` (Vercel auto). Specs:
`docs/superpowers/specs/2026-04-23-lena-chatter-voice-design.md`,
plan `docs/superpowers/plans/2026-04-23-lena-chatter-voice.md`.

**Build gotcha (fixed, but worth knowing):** `scripts/*.ts` importing
from `.vercelignore`'d dirs (`workers/`, `dashboard/`) broke Vercel's
tsc even though `next build` locally was fine — local tsc resolves
the path because the files physically exist. Fix landed in `e73c710`:
`.vercelignore` now excludes `scripts/` and `nanoclaw-groups/` too.
**Going forward:** any new `scripts/*.ts` importing from `workers/`
etc. is fine — the whole `scripts/` dir is invisible to Vercel.

---

## Dashboard Talkback (NanoClaw chat) — CODE READY, NEEDS DEPLOY (2026-04-23)

New full-page chat at `dashboard.numaradio.com/chat` that talks to
the same NanoClaw agent you reach over Telegram, with **parity +
dashboard ops** as agent tools (push tracks, approve/reject held
shoutouts, restart services, toggle auto-chatter, tail logs, query
now-playing).

**Architecture in one line:** browser → Next.js SSE proxy on :3001 →
new NanoClaw HttpChannel on loopback :4001 → agent container → curls
new `dashboard/app/api/internal/tools/*` routes for actions.

- **Spec:** `docs/superpowers/specs/2026-04-23-dashboard-nanoclaw-chat-design.md`
- **Briefing (ships in this repo):**
  `nanoclaw-groups/dashboard_main/CLAUDE.md` — copied into NanoClaw's
  `groups/dashboard_main/` on deploy.
- **Agent identity:** "Lena's producer" (not Lena herself — Lena is
  the on-air voice). New group `dashboard_main` with separate history
  + briefing; global memory shared with `telegram_main`.

**What's code-complete:**
- NanoClaw:
  - `src/channels/http.ts` — HttpChannel implementing Channel
    interface. `POST /chat/send`, `GET /chat/stream` (SSE),
    `GET /chat/history`, `POST /chat/inject`, `GET /chat/health`.
    Binds 127.0.0.1:4001 only. Auto-registers `dashboard:main` group
    on connect; falls back to direct DB write if `ChannelOpts.registerGroup`
    isn't wired.
  - `src/channels/http-tags.ts` + tests — parses `<action/>` and
    `<confirm>…</confirm>` inline tags into SSE events. 11 tests.
  - `src/db.ts` — new `getChatHistory()` returning bot + user messages
    for scrollback (existing `getMessagesSince` filters bots).
  - `src/channels/registry.ts` gained optional `registerGroup`;
    `src/index.ts` passes it through.
  - `src/channels/index.ts` barrel registers `./http.js`.
  - All 317 existing NanoClaw tests green, `npm run build` clean.
- Dashboard:
  - `app/chat/page.tsx` — "Talkback" console, operator msgs
    right-aligned monospace with `> ` prompt, producer msgs with warm
    rule on the left, progressive-disclosure action chips, yellow-light
    confirm cards. Uses `useChatStream` hook for SSE + history.
  - 9 new internal tool routes under
    `app/api/internal/tools/{nowplaying,library-search,library-push,
    shoutout-list-held,shoutout-approve,shoutout-reject,
    service-restart,autochatter-toggle,logs-tail}` — all guarded by
    `INTERNAL_API_SECRET`.
  - 4 new chat proxy routes under
    `app/api/chat/{send,stream,history,confirm/[confirmId]}` —
    forward loopback to HttpChannel.
  - `lib/internal-auth.ts` — shared timing-safe auth helper.
  - `lib/chat-proxy.ts` — NanoClaw URL + `DASHBOARD_GROUP_JID`
    constant.
  - `components/chat/{chat-turn,action-chips,confirm-card,chat-composer}.tsx`
  - `hooks/use-chat-stream.ts` — SSE parser + reconnect + history.
  - `app/page.tsx` header links to `/chat` ("Talkback →").
  - `npm run build` clean; `npm test` all 38 existing tests green.

### Deploy steps (when you're back)

1. **Ship the NanoClaw channel** (from `/home/marku/nanoclaw`):
   ```bash
   cd /home/marku/nanoclaw
   npm run build
   # 1a. Ship the briefing
   install -d groups/dashboard_main
   install -m 0644 /home/marku/saas/numaradio/nanoclaw-groups/dashboard_main/CLAUDE.md \
     groups/dashboard_main/CLAUDE.md
   # 1b. Shared secret in the group folder — the agent container only
   #     sees TZ + credential-proxy env, so it reads this to curl
   #     dashboard tools. `tr -d '\r\n'` is LOAD-BEARING: .env.local
   #     is CRLF, and a trailing CR in an HTTP header makes Node 400
   #     the whole request.
   SECRET=$(grep '^INTERNAL_API_SECRET=' \
     /home/marku/saas/numaradio/dashboard/.env.local | \
     cut -d= -f2- | tr -d '\r\n')
   printf '%s' "$SECRET" > groups/dashboard_main/.auth
   chmod 0600 groups/dashboard_main/.auth
   # 1c. Channel env
   grep -q '^DASHBOARD_CHANNEL_PORT=' .env || echo 'DASHBOARD_CHANNEL_PORT=4001' >> .env
   grep -q '^INTERNAL_API_SECRET=' .env || printf 'INTERNAL_API_SECRET=%s\n' "$SECRET" >> .env
   # 1d. Restart + smoke
   systemctl --user restart nanoclaw
   sleep 2
   ss -ltn | grep 4001                                                 # LISTEN 127.0.0.1:4001
   curl -sS http://127.0.0.1:4001/chat/health -H "x-internal-secret: $SECRET"
   ```
   `/chat/health` returns `{"ok":true,"subscribers":0}` once bound.
2. **Ship the dashboard:** `cd dashboard && npm run deploy` (build +
   password-free restart via sudoers). `NANOCLAW_CHAT_URL` defaults
   to `http://127.0.0.1:4001` — only set if NanoClaw moves.
3. **Smoke test.** Visit `https://dashboard.numaradio.com/chat`, send
   "what's playing?". Pill flashes red ("On air") while the producer
   replies. Timeout? `journalctl --user -u nanoclaw -f` and
   `sudo journalctl -u numa-dashboard -f`.

### Redeploy after a code change
- **Dashboard only:** `cd dashboard && npm run deploy`.
- **NanoClaw only:** `cd /home/marku/nanoclaw && npm run build &&
  systemctl --user restart nanoclaw`.
- **Briefing only:** edit `nanoclaw-groups/dashboard_main/CLAUDE.md`,
  re-copy to NanoClaw's `groups/dashboard_main/CLAUDE.md`, and
  **force-stop the cached container** so her next turn opens a fresh
  Claude Code session:
  `docker ps --format '{{.Names}}' | grep nanoclaw-dashboard-main | xargs -r docker stop`.
  (IDLE_TIMEOUT = 30 min holds the old briefing otherwise.)

### Operator mental model
- One persistent conversation — close the tab, come back tomorrow,
  scrollback intact.
- **Green-light** actions (push, search, approve, nowplaying,
  shoutout, auto-chatter toggle, logs-tail) run unilaterally — chips
  appear in the transcript for audit.
- **Yellow-light** actions (service.restart, shoutout.reject) render
  an inline Confirm / Cancel card. Composer locked until resolved.
  Confirm → dashboard executes the tool (audit: your CF Access email
  ends up in the log line). Cancel → agent sees `[cancelled]` system
  line.
- Agent is **MiniMax-M2.7** via NanoClaw's credential proxy — same
  brain as Telegram.
- **Don't ask her to restart `numa-dashboard`** — she's briefed to
  refuse (it would cut her own connection).

### Known deferrals (v1.1+)
True token-streaming (v1 sends the whole reply as one chunk),
multi-tab presence, "Stop generation" button, proactive agent-initiated
nudges.

---

## Current live state — quick reference

Everything below is **LIVE** and stable. Details in `HANDOFF-archive.md`.

- **Stream:** `https://api.numaradio.com/stream` — Icecast + Liquidsoap
  on Orion (WSL2). 192 kbps stereo MP3.
- **Public site:** `numaradio.com` (Vercel) — hero shows Neon
  `NowPlaying`, listener count = `15 + real` Icecast listeners.
- **Dashboard:** `dashboard.numaradio.com` (Cloudflare Access) —
  `/library` (browse + Play Next), `/shoutouts` (Compose + Held +
  Recent + Auto-chatter toggle + activity log).
- **Queue daemon:** `numa-queue-daemon.service` on loopback `:4000`.
  `POST /push`, `POST /on-track`, `GET /status`. Owns telnet to
  Liquidsoap `:1234`.
- **Rotation:** `numa-rotation-refresher.timer` every 2 min.
  Regenerates `/etc/numa/playlist.m3u` from Neon minus last 20
  `PlayHistory` rows, Fisher–Yates shuffled.
- **Shoutout pipeline:** `dashboard/app/api/generate/shoutout`
  (radio-host transform → Deepgram Luna TTS → B2 → Track row → queue
  push). Overlay via Liquidsoap `smooth_add` ducker — music ducks
  50% (~-6 dB), 500 ms fade.
- **Listener booth:** `numaradio.com` Requests / Song request tabs.
  Shoutout = IP rate-limit 3/hr + 10/day → MiniMax moderator →
  dashboard route via tunnel + `INTERNAL_API_SECRET`. Song = 1/hr +
  3/day → `numa-song-worker` runs MiniMax music-2.6 + OpenRouter Flux
  artwork → B2 → queue.
- **Auto-chatter:** toggled at `/shoutouts`. Lena speaks over every
  3rd music track (~15 s), 20-slot rotation, rides `overlay_queue`
  same as shoutouts.
- **NanoClaw:** `/home/marku/nanoclaw` (separate repo, fork of
  `qwibitai/nanoclaw`). Agent brain = MiniMax-M2.7 via credential
  proxy. Container runtime = native Docker CE as systemd unit inside
  WSL (`docker.service` enabled).
- **WSL auto-start:** Windows scheduled task `Start WSL (Numa Radio)`
  (AtStartup / AtLogOn / SessionUnlock, S4U). Task action keeps
  `wsl.exe` persistently attached via `/bin/sleep infinity` — that's
  what prevents idle-shutdown, not `vmIdleTimeout=-1` alone.
  Installer: `deploy/windows/install-autostart.ps1`.

**Sudoers drop-in** `/etc/sudoers.d/numa-nopasswd` (template
`deploy/systemd/numa-nopasswd.sudoers`) lets `marku` restart
`numa-dashboard`, `cloudflared`, `numa-queue-daemon`,
`numa-liquidsoap`, `numa-rotation-refresher.timer` without a password.

---

## Vault location (product decisions / design / policy)

The Numa Radio vault lives at **`docs/numa-radio/`**. Symlinked into
the Mac Obsidian vault at `SaaS/Numa Radio` — editing in Obsidian =
editing in the repo = git push syncs to all machines.

Read in order:
1. **`docs/numa-radio/Decisions Log.md`** — most recent decisions, always first
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
- **Path alias:** `@/*` → repo root
- **TypeScript scripts:** run via `tsx` (e.g. `npm run ingest:seed`)
- **Env loading** in scripts: `import "../lib/load-env"` first; reads `.env.local`
- **Tailwind v4:** tokens via `@theme inline` in `app/globals.css`. Class
  names like `bg-bg`, `text-fg`, `text-accent`, `border-line`,
  `font-display`, `font-mono`.

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

Also needed (Vercel env + mini-server `/etc/numa/env`):
```
INTERNAL_API_SECRET          shared secret Liquidsoap uses to call /api/internal/*
                             generate with `openssl rand -hex 32`
```

Server (mini-server only):
```
ICECAST_SOURCE_PASSWORD      generated during Icecast install
```

## Cross-machine workflow

- **Mac** (dev box): code work, design, Obsidian editing. `npm run dev`,
  ingest scripts, Prisma migrations.
- **Mini-server** (WSL2 Ubuntu, aka Orion): runs Icecast, Liquidsoap,
  cloudflared, NanoClaw workers, the timer that refreshes the playlist.
  Reads Neon + B2 over the internet.
- **GitHub** is the sync mechanism. Both machines `git pull`. Vault
  edits on Mac flow through Obsidian → symlink → repo → push → server
  pull.

## When you finish a session

Update this file (and `docs/numa-radio/Decisions Log.md` if you made
decisions), commit, push. **Rotate anything older than ~a week into
`docs/HANDOFF-archive.md`** so this file stays short — CLAUDE.md loads
it on every session.
