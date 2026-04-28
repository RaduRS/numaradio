---
title: YouTube 24/7 Live Broadcast — `/live` page + headless encoder
date: 2026-04-28
status: spec
---

# YouTube 24/7 Live Broadcast

## Goal

Run a permanent 24/7 YouTube live stream of Numa Radio, in the spirit
of Lofi Girl, but with the unique advantage that listeners can submit
shoutouts and song requests at `numaradio.com` and watch them appear
on screen in real time.

The whole thing must run **headless on Orion** — no OBS, no screen
share, no PC kept open. Same operational profile as
`numa-liquidsoap.service`.

## Architecture in one diagram

```
┌──────────────────────────────────────────────┐
│ Orion (WSL2 Ubuntu)                          │
│                                              │
│  Xvfb :99 (virtual display, 1920x1080)       │
│        │                                     │
│  Chromium --kiosk https://numaradio.com/live?broadcast=1 │
│        │   (renders to :99, no window)       │
│        ▼                                     │
│  ffmpeg                                      │
│    -f x11grab -i :99                         │← video from headless chrome
│    -i https://api.numaradio.com/stream       │← audio from existing Icecast
│    -c:v libx264 -c:a aac                     │
│    -f flv rtmp://a.rtmp.youtube.com/live2/<KEY> │
└──────────────────────────────────────────────┘
```

One systemd unit (`numa-youtube-encoder.service`) brings up Xvfb +
Chromium + ffmpeg as a process group, restarts on failure, runs as
user `marku` like the other Numa services.

## Why ExpandedPlayerDesktop, not a new composition

Building a Remotion-style live composition was the original idea (see
follow-up notes in the marketing-videos repo), but
`app/_components/ExpandedPlayerDesktop.tsx` already provides:

- Big artwork with track title, artist, frame-accurate progress (130
  lines, just shipped in the duration backfill)
- Lena's live quote with the 900ms CRT tune-in animation
- `OnAirFeed` — chronological timeline of tracks + shoutouts as they
  air. **This is the killer feature** — viewers literally see
  shoutouts roll in.
- Waveform component reading the same `useNowPlaying` cache that
  PlayerCard uses
- Fully styled in `_expanded-player.css` (563 lines, polished)

Reusing it means: the broadcast looks **identical** to the in-app
expanded player, no second design system to maintain, no second set
of API calls.

## The `/live` route

New file: `app/live/page.tsx`. Server component that:

1. Reads `?broadcast=1` from search params. When present, renders in
   "encoder mode": no fullscreen button, no scrollbars, no header,
   no `<Nav>` / `<Footer>`. When absent, renders in "preview mode"
   for a human visitor browsing to <https://numaradio.com/live>.
2. Mounts a new client component `<BroadcastStage>`.

`<BroadcastStage>` is a thin wrapper that:

- Mounts the existing `<PlayerProvider>` (so `usePlayer`, `useBroadcast`,
  `useNowPlaying`, `useFallbackArtworkUrl` all work)
- Sets `<audio>` muted in encoder mode (the encoder pulls audio from
  Icecast directly — we never want the page producing sound)
- Renders `<ExpandedPlayerDesktop>` inside a fixed 1920×1080 frame
- Adds the broadcast chrome (see below)

### Broadcast-mode chrome (only when `?broadcast=1`)

Layered absolute-positioned elements over the booth:

- **Top-left**: animated "ON AIR · LIVE" chip (reuse `LiveChip` from
  numaradio-videos primitives, or extract one). Pulses with the same
  `prefers-reduced-motion`-honoring animation as the player card.
- **Top-right**: listener count pill — "{N} tuned in", reads from
  `/api/station/listeners` every 15s. The Listeners API already
  exists and is used by `/shoutouts`.
- **Bottom strip** (full width, ~80px tall, semi-transparent over a
  scanline gradient): persistent CTA — **"REQUEST AT NUMARADIO.COM"**
  with the wordmark + a small "type a message, hear it on air"
  subtitle. This is the **whole point** of the broadcast — convert
  watchers to participants.
- **Time-of-day tint**: thin teal/orange overlay layer whose opacity
  + hue shifts with `timeOfDayFor(new Date().getHours())` from
  `lib/schedule.ts`. Morning = warm, late night = cool. Refreshes
  hourly.

### Strip-outs (always, even in preview mode)

The expanded player has interactive elements that make no sense on a
broadcast where viewers can't click:

- Play/pause button → hide
- Volume slider → hide
- Connecting/error status text → hide (always show "LIVE")
- Share/Vote buttons on artwork → hide
- Click-to-expand handler on the card → noop

Implement as a `data-broadcast="true"` attribute on the booth
container plus CSS rules in `_expanded-player.css` that hide those
controls when the attribute is set. Avoids forking the component.

### Fullscreen button (preview mode only)

A small floating ⛶ button bottom-right when `?broadcast=1` is
**absent**. Calls `document.documentElement.requestFullscreen()`.
Hidden by CSS in encoder mode. This is for human visitors browsing
to <https://numaradio.com/live> — the encoder doesn't need it.

## Sizing and overflow

- Outer container: `width: 1920px; height: 1080px` fixed — the
  encoder's Chromium runs at exactly this resolution, so nothing
  overflows.
- Use `overflow: hidden` defensively.
- Bump base font size ~1.4× via a CSS scope `[data-broadcast]
  { font-size: 1.4em }` — TV/phone-distance legibility.
- `_expanded-player.css` already uses fluid units in many places;
  add a `@media (min-width: 1900px)` block (or the data-attribute
  scope) for the broadcast layout adjustments.

## Headless encoder service

New file: `deploy/systemd/numa-youtube-encoder.service`.

```ini
[Unit]
Description=Numa Radio — YouTube 24/7 broadcast encoder
After=network-online.target numa-liquidsoap.service
Wants=network-online.target

[Service]
Type=simple
User=marku
EnvironmentFile=/etc/numa/env
ExecStartPre=/bin/sh -c 'pkill -f "Xvfb :99" || true; pkill -f "chromium.*--display=:99" || true'
ExecStart=/usr/local/bin/numa-youtube-encoder.sh
Restart=on-failure
RestartSec=15s
StartLimitBurst=5
StartLimitIntervalSec=300

[Install]
WantedBy=multi-user.target
```

The shim `numa-youtube-encoder.sh` (lives in `deploy/scripts/`,
installed to `/usr/local/bin/`) does:

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${YOUTUBE_STREAM_KEY:?required}"
: "${BROADCAST_URL:=https://numaradio.com/live?broadcast=1}"
: "${ICECAST_URL:=https://api.numaradio.com/stream}"

# Start virtual display
Xvfb :99 -screen 0 1920x1080x24 &
XVFB_PID=$!
trap 'kill $XVFB_PID 2>/dev/null || true' EXIT

# Wait for X to come up
for _ in $(seq 1 20); do
  xdpyinfo -display :99 >/dev/null 2>&1 && break
  sleep 0.5
done

# Headless Chromium — kiosk, autoplay allowed (audio is muted via the
# page anyway), no error dialogs, hardware accel disabled (WSL2)
DISPLAY=:99 chromium \
  --kiosk \
  --no-first-run \
  --no-default-browser-check \
  --autoplay-policy=no-user-gesture-required \
  --disable-gpu \
  --disable-dev-shm-usage \
  --window-size=1920,1080 \
  --window-position=0,0 \
  --user-data-dir=/var/lib/numa/chromium-broadcast \
  "$BROADCAST_URL" &
CHROME_PID=$!
trap 'kill $CHROME_PID $XVFB_PID 2>/dev/null || true' EXIT

# Give the page time to mount, hydrate, and load artwork
sleep 8

# Encode + push to YouTube. -re on the audio input keeps timing
# real-time. fflags +genpts compensates for any input clock drift.
exec ffmpeg -hide_banner -loglevel warning \
  -f x11grab -framerate 30 -video_size 1920x1080 -i :99 \
  -re -i "$ICECAST_URL" \
  -map 0:v -map 1:a \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -b:v 4500k -maxrate 4500k -bufsize 9000k \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 44100 -ac 2 \
  -f flv "rtmp://a.rtmp.youtube.com/live2/${YOUTUBE_STREAM_KEY}"
```

Key points:

- **`exec ffmpeg`** at the end — ffmpeg becomes PID 1 of the service,
  systemd's `Restart=on-failure` actually catches encoder crashes.
- **Cleanup `trap`** kills Xvfb + Chromium when ffmpeg dies, so we
  don't leak zombies on restart.
- **`Restart=on-failure` + `StartLimitBurst=5`** — same pattern
  hardened in the 2026-04-25 stack audit. Don't infinite-loop into a
  broken encoder.
- **`/etc/numa/env`** holds `YOUTUBE_STREAM_KEY=...`. Already
  chmod 0600 from the audit pass.

## Env vars to add to `/etc/numa/env`

```
YOUTUBE_STREAM_KEY=xxxx-xxxx-xxxx-xxxx-xxxx
```

Plus optional overrides:

```
BROADCAST_URL=https://numaradio.com/live?broadcast=1   # default fine
ICECAST_URL=https://api.numaradio.com/stream           # default fine
```

YouTube stream key: get from <https://studio.youtube.com> → Go Live →
Stream → copy stream key. **Do not commit. Do not put in `.env.local`
either** — server-only secret.

## Sudoers / install

Add a line to `deploy/systemd/numa-nopasswd.sudoers` so the operator
can `systemctl restart numa-youtube-encoder` without a password (this
is going to be needed often during initial tuning):

```
marku ALL=(root) NOPASSWD: /bin/systemctl restart numa-youtube-encoder.service
```

Install steps (one-time):

```bash
sudo apt-get update
sudo apt-get install -y xvfb chromium-browser ffmpeg
sudo install -m 0755 deploy/scripts/numa-youtube-encoder.sh /usr/local/bin/
sudo install -m 0644 deploy/systemd/numa-youtube-encoder.service /etc/systemd/system/
sudo install -d -o marku -g marku /var/lib/numa/chromium-broadcast
sudo systemctl daemon-reload
sudo systemctl enable numa-youtube-encoder
sudo systemctl start numa-youtube-encoder
```

## Verification

After install:

```bash
# 1. Service status
systemctl status numa-youtube-encoder

# 2. Live ffmpeg logs
journalctl -u numa-youtube-encoder -f

# 3. The "is the page rendering" sanity check (on Orion):
DISPLAY=:99 import -window root /tmp/broadcast.png
# Then `scp` /tmp/broadcast.png to a desktop and look at it. Should
# show the booth with current track + Lena quote.

# 4. The truth: open https://studio.youtube.com → live dashboard.
# Stream health should report Excellent.
```

## Music rights

User has **Suno Pro** — commercial rights covered. MiniMax music-2.6
output is owned by us under the API commercial terms. Both safe to
broadcast.

YouTube Content ID is **not** the issue — it might still false-flag
AI music against unrelated tracks. If that happens, file a dispute
with the Suno/MiniMax licence info in the description.

## Known risks / future work

- **Discovery is hard.** Lofi Girl took 4+ years. Best lever: cut
  60-second highlights from the broadcast, run them as Shorts. The
  marketing-videos repo already has the primitives.
- **Single point of failure.** If Orion goes down, the YouTube
  stream dies. v1.1 idea: move the encoder to a £5/mo VPS that just
  pulls `api.numaradio.com/stream` and `numaradio.com/live`. Removes
  the dependency.
- **Stream-key rotation.** YouTube can revoke keys. Document the
  rotation procedure in `HANDOFF.md` after first deploy.
- **Channel verification.** YouTube Live requires a verified channel
  for >12hr archives, custom thumbnails, and certain monetization.
  One-time setup, do before going live.
- **DVR / archive.** First-pass: live only, no archive. v1.1: enable
  YouTube's "DVR" so viewers can scrub back, and decide whether to
  preserve the archive after each stream ends (each archive is a
  potential watch-later video).

## Build sequence

1. **PR 1 — Frontend `/live` route** (no infra changes; safe to
   ship and preview before any encoder exists)
   - `app/live/page.tsx` (server component, reads `?broadcast=1`)
   - `app/_components/BroadcastStage.tsx` (client wrapper)
   - CSS additions in `_expanded-player.css` for `[data-broadcast]`
     scope
   - Reuse `LiveChip`-style primitive (extract from numaradio-videos
     or recreate inline — small enough either way)
   - Smoke: load `/live` in a real browser at 1920×1080, confirm no
     scrollbars, no broken interactions, fullscreen button works.

2. **PR 2 — Encoder service**
   - `deploy/scripts/numa-youtube-encoder.sh`
   - `deploy/systemd/numa-youtube-encoder.service`
   - Sudoers update
   - Install instructions in `HANDOFF.md`
   - Smoke: service running for 30 min, YouTube Studio reports
     Excellent stream health, broadcast.png screenshot looks right.

3. **PR 3 — Polish (optional, after 24-hour soak)**
   - Time-of-day tint
   - "Next up" strip pulling from rotation chips API
   - Subscribe/follow nudge that fades in every ~5 min
   - Adjustments based on what looks bad on actual YouTube playback

## Out of scope for v1

- Multi-bitrate output
- Live captions (Lena's TTS could feed these — interesting v2)
- Per-show scenes (e.g. switch background by `currentShow`)
- Failover encoder
- Streaming to Twitch/Kick simultaneously (restream.io would do it
  in one config change, but defer until single-platform is solid)

## Decision points / questions for operator

- **Channel name** for the YouTube stream — same as `numaradio.com`
  branding, or a separate handle?
- **Stream title format** — static "🔴 Numa Radio · 24/7 AI Indie ·
  Type a request at numaradio.com", or rotate by show?
- **Thumbnail** — use the canonical Lena portrait? (most natural)
