# Handoff — pick up where we are

Last updated: 2026-04-23 night (booth UX + shoutout lifecycle + NanoClaw IPC fix — all LIVE)

## Booth UX + shoutout lifecycle + NanoClaw IPC fix — LIVE (2026-04-23 night)

Three connected pieces shipped tonight. Each independently deployable
but they share the theme: make Lena feel like a person, and stop
shoutouts from leaving litter behind.

### 1. Listener booth submit UX

- **Shoutout submit is now optimistic.** `app/api/booth/submit/route.ts`
  returns ~2 s after moderation passes; the dashboard internal
  shoutout call (radio-host rewrite → Deepgram → B2 → queue push) runs
  in `after()`. Was 20-40 s of spinner before.
- **Silent-failure recovery:** new `GET /api/booth/shoutout/[id]/status`
  reads `Shoutout.deliveryStatus`. Client stashes the ID in
  `localStorage` (`numa.shoutout.last`) and on focus pings the status
  endpoint — surfaces a one-time "Heads up — your last shoutout didn't
  make it on air" if the background pipeline failed.
- **Song pending state persists across tab-switches** via
  `numa.song.pending` localStorage key (helpers in
  `lib/booth-stash.ts` with 6 unit tests). 404 from the status endpoint
  unsticks the rotator instead of leaving it spinning forever.
- **Voice change.** Stage-specific headings ("Composing… / Painting
  the cover…") replaced with a 3-line quiet-confidence rotator in a
  styled `.req-pending` card (accent-tinted border + pulsing dot using
  the existing `pulseDot` keyframe + `IN THE BOOTH` mono-caps kicker).
  CSS in `app/styles/_design-overrides.css`.
- **Field-level form validation.** Both forms (shoutout + song) now
  validate on submit, paint required-field borders red with a pulsing
  red dot inline error message, and clear errors as the user types.
  Removed the song form's `disabled` button gate so users can click
  and discover what's missing instead of a dead-looking button.

**Spec:** `docs/superpowers/specs/2026-04-23-submit-feedback-lena-human-design.md`

### 2. Shoutout lifecycle — auto-delete after airing

Aired shoutouts used to accumulate forever as Track + TrackAsset +
QueueItem + PlayHistory rows + B2 MP3s, cluttering the dashboard
library and growing storage. Now:

- **`/api/internal/shoutout-ended` deletes the transient track**
  (Track + TrackAsset + QueueItem + PlayHistory + B2 audio) in a
  transaction immediately after Liquidsoap signals the overlay
  finished. The `Shoutout` audit row survives — only the audio is
  ephemeral.
- **Defense in depth:** `lib/delete-aired-shoutout.ts` refuses to act
  unless `sourceType='external_import' AND airingPolicy='request_only'`.
  Music tracks can't be nuked by a misrouted call.
- **Dashboard library:** `+ Shoutouts` filter button gone. Shoutouts
  are always hidden — they'll be deleted seconds after airing anyway.
- **Re-runnable purge:** `scripts/purge-orphan-shoutouts.ts` (with
  `--dry-run`). Cleared 52 pre-existing orphans on initial run. Use
  this if `shoutout-ended` ever misses one.
- **No retention/sweep job for `Shoutout` rows.** Decided they're
  small (text only, ~200 bytes) and the displays already cap at "last
  N" (`/api/station/shoutouts/recent` LIMIT 10, dashboard /shoutouts
  Recent LIMIT 20). 24h retention was too aggressive vs the
  moderation-audit value.
- **Shoutout wall sized:** desktop shows 10 (5 per column), mobile
  shows 6 (CSS `:nth-child(n+4)` hides overflow at <=1100px).

### 3. NanoClaw IPC bug fix — held-notify reaches agent context

**The bug:** dashboard's held-notify wrote to `<group>/messages/`,
which NanoClaw's IPC watcher (`src/ipc.ts`) treated as
Telegram-outbound only — `sendMessage` then `unlink`, no SQLite write.
When the operator replied "no" on Telegram, the agent's freshly-spawned
container session pulled context from `getMessagesSince()` (SQLite),
which had no record of the held-shoutout prompt. Agent replied
conversationally ("Everything OK? 😄") and the reject curl never fired.
Shoutout sat in `moderationStatus='held'` forever.

**The fix (NanoClaw `64118ad` + `62ae4c7`):** `src/ipc.ts` now
**stores in SQLite first, then sends to Telegram**. New optional
`persistInContext` flag (default true when target chat is a registered
agent group, false for pure-broadcast). Idempotent on re-process via
`INSERT OR REPLACE` keyed on `ipc-<filename-stem>`. 8 new unit tests.

**Dashboard side (numaradio `21af532`):** held-notify now passes
`persistInContext: true` + `senderName: "Dashboard"` explicitly so
intent is unambiguous regardless of NanoClaw's default.

**Verify on prod:** submit a shoutout with `fuck` from numaradio.com →
Telegram DMs you the held-shoutout prompt → reply `no` → agent should
now reply "Blocked." within ~10 s and the dashboard's held card
disappears within ~8 s.

### Vercel build gotcha (resolved, but worth knowing)

`scripts/preview-chatter.ts` imports from `../workers/queue-daemon/
chatter-prompts.ts`. `workers/` is `.vercelignore`'d but `scripts/`
wasn't, so on Vercel the import target disappeared and tsc died with
"Cannot find module … or its corresponding type declarations." Fixed
by adding `scripts` and `nanoclaw-groups` to `.vercelignore` (commit
`e73c710`). Local `next build` doesn't reproduce this — all dirs
physically exist on disk, so tsc resolves the import even though
tsconfig excludes `workers/`. **Going forward:** any new
`scripts/*.ts` that imports from `workers/`, `dashboard/`, etc. is
fine — the whole `scripts/` dir is gone from Vercel's view.

### Deploy state

- numaradio `main` at `e73c710`. Vercel auto-deployed.
- nanoclaw `main` at `62ae4c7`. `systemctl --user restart nanoclaw`
  done; cached agent containers killed.
- Dashboard rebuilt + restarted on Orion via `cd dashboard && npm run
  deploy`.
- 52 orphan shoutouts purged from Neon + B2.
- One stuck held shoutout (`cmobx8oov0005jr04vvt49jzn`) cleared via
  the internal API as a one-off — would have been auto-handled if the
  fix had shipped before that incident.

### Where to pick up tomorrow

- Verify the NanoClaw held-notify fix on prod (test recipe above).
  If anything misbehaves, container logs are the first stop:
  `docker logs --tail 100 $(docker ps --format '{{.Names}}' | grep nanoclaw-telegram-main)`
- The booth UX has only been smoke-tested via `next build` + unit
  tests; no in-browser click-through. Worth a 30-second tour:
  numaradio.com → submit a shoutout (should confirm in ~2s), submit
  a song (pending card should survive a tab switch and show the
  rotator in Lena's voice), try submitting either with required
  fields empty (fields should highlight red).
- If the auto-delete callback ever misses one, you'll see it in the
  dashboard library briefly (since the filter is just a UI hide) —
  re-run `npx tsx scripts/purge-orphan-shoutouts.ts`.

---

## Lena auto-chatter voice tuning — LIVE (2026-04-23)

Loosened Lena's on-air auto-chatter so she sounds like a DJ who riffs
around the track-ID instead of reciting `[track]. Good one. [signoff].`
on every break. No cadence / gating / pipeline changes — content only.

- **Spec:** `docs/superpowers/specs/2026-04-23-lena-chatter-voice-design.md`
- **Plan:** `docs/superpowers/plans/2026-04-23-lena-chatter-voice.md`

**What changed:**
- New `lib/schedule.ts` — shared 4-slot show grid (Night Shift / Morning
  Room / Daylight Channel / Prime Hours) as the single source of truth.
  Frontend `Schedule.tsx` and queue-daemon `auto-host.ts` both import
  from it, so Lena's time-of-day context can't drift from the homepage
  show grid.
- Rewrote `BASE_SYSTEM` in `workers/queue-daemon/chatter-prompts.ts` to
  actively encourage a beat of DJ-riff texture per break (rhetorical
  question, listener callout, show-vibe line) while keeping all
  anti-poetic bans from the 2026-04-22 failure mode
  (no "wandering piano lines", no stacked adjectives, etc.).
- Expanded per-type example banks from 3 identically-shaped lines to 6
  deliberately varied ones — breaks MiniMax's skeletal anchor.
- Bumped word budget 20-30 → 35-50. Budget slack: MiniMax still
  undershoots ~1/8 samples; flag for v1.1 if it persists on air.
- Pinned MiniMax `temperature: 1.0` explicitly in `minimax-script.ts`
  (previously was whatever MiniMax-M2.7's default was). Knob for v1.1
  bumps: 1.1 if still same-y, 0.8 if poetry drifts back.
- New `PromptContext` optional fields: `currentShow`, `recentArtists`
  (3-slot ring, tracked in `AutoHostStateMachine`), `slotsSinceOpening`.
  `renderContextBlock()` emits an optional Context block the prompt
  surfaces; back_announce slices `recentArtists[0]` (the currently-
  announcing artist) so MiniMax doesn't double-count it as "second X in
  a row". `body.artist` from the `on-track` handler is forwarded through
  `autoHost.onMusicTrackStart(artist)` to populate the ring.
- `back_announce` falls back to filler when `resolveCurrentTrack()`
  returns null — previously would have aired literal `"that one" by
  "the artist"` placeholders.
- Pre-existing TS2018 regex flag `/s` on line 34 of `minimax-script.ts`
  was unblocking `next build`; removed since the input is space-joined
  (no newlines to match).

**Deploy state:**
- Queue-daemon restarted 2026-04-23 evening via
  `sudo systemctl restart numa-queue-daemon` (sudoers password-free).
  `/status` returns clean: `{"socket":"connected","lastPushes":[],
  "lastFailures":[]}` post-restart.
- Frontend pushed to `origin/main` — Vercel auto-deployed.
  `Schedule.tsx` refactor is render-identical, no visual change.

**Ear-check (pre-deploy) summary:**
Ran `npx tsx scripts/preview-chatter.ts` against real MiniMax and got 8
samples (2 per type). No poetry regressions, no stilted context
parroting, no show-name invention when context absent. Best sample was
Prime Hours filler: *"Prime Hours on Numa Radio, Lena with you until
midnight. Dinner's done and we're going weirder from here — put your
requests up, let's see what's hot. Stay locked."* Pulls directly from
the Prime Hours description without parroting it.

**Redeploy after a code change:**
- Prompts / state machine: `git pull && sudo systemctl restart
  numa-queue-daemon`
- Frontend schedule labels: `git push origin main` (Vercel auto)
- Preview any prompt tweak: `npx tsx scripts/preview-chatter.ts` —
  hits real MiniMax, prints 8 samples with word counts. No tests run
  it (burns API credit), manual dev tool only.

**Knobs if on-air feel is still off after 24h:**
- Still same-y → bump `temperature` to 1.1 in
  `workers/queue-daemon/minimax-script.ts`
- Poetry creeping back → drop to 0.8 AND add the newly-observed phrase
  to the `DO NOT` list in `BASE_SYSTEM`
- Context parroting (`"In Prime Hours, I am Lena, and I am playing…"`)
  → strengthen the Context-block opt-out sentence in
  `renderContextBlock()`

Each is one-commit-one-restart.

### Same-day follow-ups (2026-04-23 evening)

Three post-launch iterations after the initial voice-tuning deploy:

1. **Show-name throttle — `d5fb699`.** Passing `currentShow` on every
   auto-chatter prompt produced "Prime Hours" framing every ~6 min.
   Now gated behind a 15% random roll (`auto-host.ts:generateAsset`);
   listeners hear a show-name reference roughly every ~40 min instead.
   `deps.randomGate` is injectable for tests. Tune up/down in one line
   if rate still feels wrong.

2. **Voice model swap: Andromeda → Luna — `db44e7e`.** Andromeda's
   "soft whisper late-night radio" register read "dead in the water"
   in Prime Hours. Switched to `aura-2-luna-en` (friendly/upbeat/casual)
   across both surfaces (`workers/queue-daemon/deepgram-tts.ts` and
   `dashboard/lib/shoutout.ts`). Asteria still the 4xx fallback.
   Lena's persona name unchanged — voice model is an implementation
   detail, not the brand. If Luna doesn't stick, next step-downs are
   Helena (warm) or Thalia (presenter). Two-line swap each time.

3. **`broadcastText` fix — `7614cf7`.** Dashboard `/shoutouts` on-air
   log was showing the pre-humanize listener input instead of what
   Lena actually said. `generateShoutout()` now returns `spokenText`
   (the final post-`humanizeScript` + post-`radioHostTransform` text
   fed to Deepgram), and the booth route (`/api/internal/shoutout`)
   persists it as `broadcastText`. New listener submissions log
   correctly; existing rows have stale `broadcastText` (not worth
   backfilling). Agent Compose + operator Compose paths don't write
   Shoutout rows today — if we want those in the log, that's the
   next addition.

### Build gotcha to remember

`workers/queue-daemon/minimax-script.ts:34` used a `/s` (dotAll) regex
flag. Runs fine under node, but `next build` type-checks against
tsconfig target ES2017 where `/s` isn't allowed. Removed the flag
(`cbca4d4`) — the flag was inert anyway since the input is space-
joined (no newlines to match). `scripts/preview-chatter.ts` also
needed exclusion from Vercel deploy because it imports from
`workers/queue-daemon/` which `.vercelignore` excludes; fix in
`e73c710` added `scripts/` and `nanoclaw-groups/` to `.vercelignore`.
Both lessons for future dev-only CLIs under `scripts/`.

---

## Dashboard Talkback (NanoClaw chat) — CODE READY, NEEDS DEPLOY (2026-04-23)

New full-page chat at `dashboard.numaradio.com/chat` that talks to the
same NanoClaw agent you reach over Telegram, with **parity + dashboard
ops** as agent tools (push tracks, approve/reject held shoutouts,
restart services, toggle auto-chatter, tail logs, query now-playing).

**Architecture in one line:** browser → Next.js SSE proxy on :3001 →
new NanoClaw HttpChannel on loopback :4001 → agent container → curls
new `dashboard/app/api/internal/tools/*` routes for actions.

- **Spec:** `docs/superpowers/specs/2026-04-23-dashboard-nanoclaw-chat-design.md`
- **Briefing (ships in this repo):** `nanoclaw-groups/dashboard_main/CLAUDE.md`
  — copied into NanoClaw's `groups/dashboard_main/` on deploy.
- **Agent identity:** "Lena's producer" (not Lena herself — Lena is the
  on-air voice). New group `dashboard_main` with separate history +
  briefing; global memory shared with `telegram_main`.

**What's code-complete:**
- NanoClaw:
  - `src/channels/http.ts` — HttpChannel implementing Channel interface.
    POST /chat/send, GET /chat/stream (SSE), GET /chat/history,
    POST /chat/inject, GET /chat/health. Binds 127.0.0.1:4001 only.
    Auto-registers `dashboard:main` group on connect; falls back to
    direct DB write if `ChannelOpts.registerGroup` isn't wired.
  - `src/channels/http-tags.ts` + tests — parses `<action/>` and
    `<confirm>…</confirm>` inline tags into SSE events. 11 tests.
  - `src/db.ts` — new `getChatHistory()` export returning bot + user
    messages for scrollback (existing `getMessagesSince` filters bots).
  - `src/channels/registry.ts` — `ChannelOpts` gained optional
    `registerGroup`; `src/index.ts` passes it through.
  - `src/channels/index.ts` — barrel registers `./http.js`.
  - All 317 existing NanoClaw tests green, `npm run build` clean.
- Dashboard (Next.js):
  - New page `app/chat/page.tsx` — "Talkback" console, operator msgs
    right-aligned monospace with `> ` prompt, producer msgs with warm
    rule on the left, progressive-disclosure action chips, yellow-light
    confirm cards. Uses `useChatStream` hook for SSE + history.
  - 9 new internal tool routes under
    `app/api/internal/tools/{nowplaying,library-search,library-push,
    shoutout-list-held,shoutout-approve,shoutout-reject,
    service-restart,autochatter-toggle,logs-tail}` — all guarded by
    `INTERNAL_API_SECRET`.
  - 4 new chat proxy routes under `app/api/chat/{send,stream,history,
    confirm/[confirmId]}` — forward loopback to HttpChannel.
  - `lib/internal-auth.ts` — shared timing-safe auth helper.
  - `lib/chat-proxy.ts` — NanoClaw URL + DASHBOARD_GROUP_JID constant.
  - `components/chat/{chat-turn,action-chips,confirm-card,chat-composer}.tsx`
  - `hooks/use-chat-stream.ts` — SSE parser + reconnect + history.
  - `app/page.tsx` header now links to `/chat` ("Talkback →").
  - `npm run build` clean; `npm test` all 38 existing tests green.

### Deploy steps (when you're back)

1. **Ship the NanoClaw channel.** From `/home/marku/nanoclaw`:
   ```bash
   cd /home/marku/nanoclaw
   npm run build
   # 1a. Ship the briefing
   install -d groups/dashboard_main
   install -m 0644 /home/marku/saas/numaradio/nanoclaw-groups/dashboard_main/CLAUDE.md \
     groups/dashboard_main/CLAUDE.md
   # 1b. Write the shared secret into the group folder so the agent
   #     container (which only sees TZ + credential-proxy env) can curl
   #     dashboard tools. `tr -d '\r\n'` is LOAD-BEARING: .env.local is
   #     CRLF, and a trailing CR in an HTTP header gets Node to 400 the
   #     whole request.
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
   ss -ltn | grep 4001                      # should show LISTEN 127.0.0.1:4001
   curl -sS http://127.0.0.1:4001/chat/health -H "x-internal-secret: $SECRET"
   ```
   `/chat/health` returns `{"ok":true,"subscribers":0}` once bound.
2. **Ship the dashboard.** From `/home/marku/saas/numaradio`:
   ```bash
   cd dashboard
   # env: NANOCLAW_CHAT_URL defaults to http://127.0.0.1:4001 — only set
   # this if NanoClaw moved. INTERNAL_API_SECRET is already in .env.local.
   npm run deploy      # build + password-free restart via sudoers
   ```
3. **Smoke test.** Visit `https://dashboard.numaradio.com/chat`, send
   "what's playing?". The pill should flash red ("On air") while Lena's
   producer replies. If it times out, check
   `journalctl --user -u nanoclaw -f` and
   `sudo journalctl -u numa-dashboard -f`.

### Redeploy after a code change

- **Dashboard only:** `cd dashboard && npm run deploy`.
- **NanoClaw only:** `cd /home/marku/nanoclaw && npm run build &&
  systemctl --user restart nanoclaw`.
- **Briefing only** (fine-tune Lena's voice / add tools): edit
  `nanoclaw-groups/dashboard_main/CLAUDE.md` in this repo, re-copy into
  `/home/marku/nanoclaw/groups/dashboard_main/CLAUDE.md`, and
  **force-stop the cached container** so her next turn opens a fresh
  Claude Code session that re-reads the briefing:
  `docker ps --format '{{.Names}}' | grep nanoclaw-dashboard-main | xargs -r docker stop`
  (NanoClaw keeps containers alive for IDLE_TIMEOUT = 30 min for
  latency; the in-flight session holds the old briefing until it's
  killed.)

### Operator mental model

- The chat is **one persistent conversation** — close the tab, come back
  tomorrow, scrollback is intact.
- **Green-light** actions (push, search, approve, nowplaying, shoutout,
  auto-chatter toggle, logs-tail) run unilaterally — chips appear in
  the transcript for audit.
- **Yellow-light** actions (service.restart, shoutout.reject) render an
  inline Confirm / Cancel card. The composer is locked until resolved.
  Confirm → the dashboard itself executes the tool (audit: your CF Access
  email ends up in the log line). Cancel → agent sees a `[cancelled]`
  system line.
- The agent is **MiniMax-M2.7** via NanoClaw's credential proxy — same
  brain as Telegram.
- **Don't ask her to restart `numa-dashboard`** (she's briefed to refuse
  — it would cut her own connection).

### Known deferrals (v1.1+)

- True token-streaming (v1 sends the whole reply as one chunk).
- Multi-tab presence / "who else is watching" indicators.
- "Stop generation" button.
- Proactive agent-initiated nudges ("held queue has 5 items") — add via
  the scheduler when we want it.

---

## Lena auto-chatter — LIVE (2026-04-22)

When the **Auto-chatter** toggle on `dashboard.numaradio.com/shoutouts`
is on, Lena speaks for ~15 s over the beginning of every 3rd music
track (i.e. after every 2 music tracks with no voice). A shoutout in
that window replaces the slot — the counter resets and the next
opportunity is 2 music tracks later. Off by default; flipping the
toggle in the dashboard propagates to the queue-daemon within ~30 s
(flag cache TTL).

Chatter content is chosen deterministically from a 20-slot rotation
in `workers/queue-daemon/chatter-prompts.ts`:

- **10 × back-announce** — *"That was [title] by [artist], [colour]. You're on Numa Radio, more ahead."*
- **3 × shoutout-CTA + 3 × song-CTA** — nudges listeners to use the site features.
- **4 × generic filler** — station-ID lines.

No same-type adjacency. `slotCounter` only advances on successful
chatter push, so a MiniMax/Deepgram failure doesn't cost a slot —
the same variant retries at the next opportunity.

**Pipeline per chatter** (in `workers/queue-daemon/auto-host.ts`):
MiniMax-M2.7 (Anthropic-compat endpoint, `max_tokens=2000` to fit
M2.7's reasoning `thinking` block + the ~40-word output) → Deepgram
Aura-2-Andromeda-en → B2 upload with immutable Cache-Control →
`overlay_queue.push` via the daemon's existing telnet socket. Rides
over music via Liquidsoap's pre-existing `smooth_add` ducker — same
mechanism shoutouts use.

**Failure handling:** retry once after 2 s. Each failure attempt logs
to the daemon's `lastFailures` ring buffer with a distinct reason
code (`auto_chatter_script_failed`, `auto_chatter_tts_failed`,
`auto_chatter_b2_failed`, `auto_chatter_push_failed`). Both attempts
show in the dashboard's new **Auto-chatter activity** card at the
bottom of `/shoutouts` — also shows recent successes with slot
number + variant type.

**Operator ergonomics:**
- **Toggle on/off:** `dashboard.numaradio.com/shoutouts` → Auto-chatter
  card. No daemon restart needed; effect within ~30 s.
- **Watch it work:** `journalctl -u numa-queue-daemon -f | grep auto-chatter`
- **Redeploy after a code change:** `git pull && sudo systemctl
  restart numa-queue-daemon` (password-free via the existing sudoers
  drop-in).

**Env deps** (all read lazily — missing keys surface as
`auto_chatter_*_failed` in `lastFailures`, never crash the daemon):
`MINIMAX_API_KEY`, `DEEPGRAM_API_KEY`, `B2_*` + `B2_BUCKET_PUBLIC_URL`.
All are picked up from `.env.local` via `workers/queue-daemon/prisma.ts`
which imports `lib/load-env`.

**Rotation-size fix, same-day** (`scripts/refresh-rotation.ts`):
`MIN_POOL` was raised from 2 to 6 after a listener-report of a track
airing back-to-back. With a 13-track library Liquidsoap's default
`playlist(mode="randomize")` previously had a 30-50% reshuffle-repeat
probability; pool=6 keeps it ≤ 1/6 and gives real variety.

**Spec:** `docs/superpowers/specs/2026-04-22-lena-auto-chatter-design.md`
**Plan:** `docs/superpowers/plans/2026-04-22-lena-auto-chatter.md`

---

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
- **Air-once default:** listener-generated songs are created with
  `airingPolicy = "priority_request"` and stay out of rotation until
  after their first air. The `track-started` endpoint flips them to
  `"request_only"` in the same transaction that writes PlayHistory —
  which keeps them permanently out of rotation. Any re-air requires
  the operator to push from the dashboard library page (which lists
  both `library` and `request_only` tracks and accepts pushes of
  either). Backfilled on 2026-04-22 via
  `scripts/demote-listener-songs.ts`.

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
