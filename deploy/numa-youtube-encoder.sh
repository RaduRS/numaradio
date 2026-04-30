#!/usr/bin/env bash
# Numa Radio → YouTube live encoder
#
# Pipes a headless Chromium of /live?broadcast=1 plus the Icecast
# audio stream into YouTube's RTMP ingest. Designed to run under
# systemd as numa-youtube-encoder.service on Orion (WSL2 Ubuntu).
#
# Env (loaded from /etc/numa/env via the systemd unit):
#   YOUTUBE_STREAM_KEY  required. Get from studio.youtube.com → Go Live.
#   BROADCAST_URL       optional. Defaults to numaradio.com/live?broadcast=1.
#   ICECAST_URL         optional. Defaults to http://localhost:8000/stream
#                       (Icecast runs on the same box, so we skip the
#                        Cloudflare round-trip for the encoder's own pull).
#   YOUTUBE_RTMP_URL    optional. Defaults to YouTube primary ingest.
#   ENCODER_VIDEO_BITRATE  optional. kbps for libx264, default 4500.
#   ENCODER_AUDIO_BITRATE  optional. kbps for AAC, default 192.
#   ENCODER_FRAMERATE      optional. default 30.
#
# Smoke-test (write to a local file instead of pushing to YouTube):
#   YOUTUBE_STREAM_KEY=smoke ./numa-youtube-encoder.sh --smoke
#   produces /tmp/numa-encoder-smoke.flv. Stop with Ctrl-C, inspect
#   with `ffprobe`. Useful before exposing a real key to the service.

set -euo pipefail

SMOKE=0
if [[ "${1:-}" == "--smoke" ]]; then
  SMOKE=1
fi

# ── Config ──────────────────────────────────────────────────────────
: "${YOUTUBE_STREAM_KEY:?YOUTUBE_STREAM_KEY is required (set in /etc/numa/env)}"
BROADCAST_URL="${BROADCAST_URL:-https://numaradio.com/live?broadcast=1}"
# Default to local Icecast on the same box. Going via api.numaradio.com
# routes WSL → Cloudflare → Cloudflare → nginx → local Icecast, and
# Cloudflare periodically EOFs long-lived audio streams (~every 2-4h).
# Each EOF stalls ffmpeg's mux briefly which YouTube interprets as
# "not receiving enough video" → DEGRADED. localhost has no such limit.
ICECAST_URL="${ICECAST_URL:-http://localhost:8000/stream}"
YOUTUBE_RTMP_URL="${YOUTUBE_RTMP_URL:-rtmp://a.rtmp.youtube.com/live2}"
ENCODER_VIDEO_BITRATE="${ENCODER_VIDEO_BITRATE:-4500}"
ENCODER_AUDIO_BITRATE="${ENCODER_AUDIO_BITRATE:-192}"
ENCODER_FRAMERATE="${ENCODER_FRAMERATE:-30}"

DISPLAY_NUM=":99"
WIDTH=1920
HEIGHT=1080
USER_DATA_DIR="/var/lib/numa/chromium-broadcast"

# ── Browser binary ──────────────────────────────────────────────────
# Try google-chrome-stable first (Google's apt repo, most reliable on
# Ubuntu/WSL2), fall back to chromium / chromium-browser.
if command -v google-chrome-stable >/dev/null 2>&1; then
  CHROME_BIN="google-chrome-stable"
elif command -v chromium >/dev/null 2>&1; then
  CHROME_BIN="chromium"
elif command -v chromium-browser >/dev/null 2>&1; then
  CHROME_BIN="chromium-browser"
else
  echo "FATAL: no chromium / google-chrome binary on PATH" >&2
  exit 1
fi

# ── Cleanup trap ────────────────────────────────────────────────────
# Track every child PID we spawn; kill them all on exit so a service
# restart leaves no orphaned Xvfb / Chromium / ffmpeg processes.
declare -a CHILDREN=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${CHILDREN[@]:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  # Belt-and-braces: any straggler matching our display.
  pkill -f "Xvfb ${DISPLAY_NUM}" 2>/dev/null || true
  pkill -f "${CHROME_BIN}.*--display=${DISPLAY_NUM}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── 1. Virtual display ──────────────────────────────────────────────
echo "[encoder] starting Xvfb on ${DISPLAY_NUM} at ${WIDTH}x${HEIGHT}" >&2
Xvfb "${DISPLAY_NUM}" -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp >&2 &
CHILDREN+=("$!")

# Wait for X to come up.
for _ in $(seq 1 20); do
  if DISPLAY="${DISPLAY_NUM}" xdpyinfo >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
if ! DISPLAY="${DISPLAY_NUM}" xdpyinfo >/dev/null 2>&1; then
  echo "FATAL: Xvfb didn't come up on ${DISPLAY_NUM}" >&2
  exit 1
fi

# ── 2. Headless Chromium ────────────────────────────────────────────
echo "[encoder] launching ${CHROME_BIN} -> ${BROADCAST_URL}" >&2
mkdir -p "${USER_DATA_DIR}"
DISPLAY="${DISPLAY_NUM}" "${CHROME_BIN}" \
  --kiosk \
  --no-first-run \
  --no-default-browser-check \
  --autoplay-policy=no-user-gesture-required \
  --disable-gpu \
  --disable-software-rasterizer \
  --disable-dev-shm-usage \
  --disable-features=Translate,InfoBars,MediaRouter \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --hide-scrollbars \
  --window-size="${WIDTH},${HEIGHT}" \
  --window-position=0,0 \
  --user-data-dir="${USER_DATA_DIR}" \
  --check-for-update-interval=31536000 \
  "${BROADCAST_URL}" \
  >/dev/null 2>&1 &
CHILDREN+=("$!")

# Give the page time to mount, hydrate, fetch Lena's quote + artwork.
echo "[encoder] waiting 10s for page hydration..." >&2
sleep 10

# ── 3. ffmpeg → RTMP ────────────────────────────────────────────────
# GOP = framerate × 2 → keyframe every 2 seconds (YouTube wants 2-4s).
GOP=$(( ENCODER_FRAMERATE * 2 ))
VBITRATE_K="${ENCODER_VIDEO_BITRATE}k"
VBUFSIZE_K="$(( ENCODER_VIDEO_BITRATE * 2 ))k"
ABITRATE_K="${ENCODER_AUDIO_BITRATE}k"

if [[ "$SMOKE" == "1" ]]; then
  TARGET="/tmp/numa-encoder-smoke.flv"
  echo "[encoder] SMOKE mode → writing ${TARGET} (Ctrl-C to stop)" >&2
else
  TARGET="${YOUTUBE_RTMP_URL}/${YOUTUBE_STREAM_KEY}"
  echo "[encoder] streaming → ${YOUTUBE_RTMP_URL}/<redacted>" >&2
fi

# `exec` so ffmpeg becomes the foreground process — systemd's
# Restart=on-failure then catches encoder crashes correctly. Cleanup
# trap still fires on signals because trap is inherited.
# thread_queue_size: ffmpeg's default of 8 frames is too small once
# x11grab is reading 1920x1080 raw frames from a software-rasterized
# Chromium — Chrome's render loop briefly stalls when the page does
# heavy CSS work (blur, gradients), the input queue overflows, and the
# stream stutters. 1024 video frames + 512 audio chunks gives enough
# headroom to ride through render hiccups. Output to RTMP is unchanged;
# YouTube sees a smoother CFR feed.
exec ffmpeg \
  -hide_banner -loglevel warning \
  -thread_queue_size 1024 \
  -f x11grab -framerate "${ENCODER_FRAMERATE}" -video_size "${WIDTH}x${HEIGHT}" -i "${DISPLAY_NUM}" \
  -thread_queue_size 512 \
  -re -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i "${ICECAST_URL}" \
  -map 0:v -map 1:a \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -b:v "${VBITRATE_K}" -maxrate "${VBITRATE_K}" -bufsize "${VBUFSIZE_K}" \
  -g "${GOP}" -keyint_min "${GOP}" -sc_threshold 0 \
  -pix_fmt yuv420p -profile:v high -level 4.1 \
  -c:a aac -b:a "${ABITRATE_K}" -ar 44100 -ac 2 \
  -f flv "${TARGET}"
