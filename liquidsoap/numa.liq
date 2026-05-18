# Numa Radio — live stream with overlay voice + crossfade + sidechain duck
#
# Sources:
#   rotation       — library shuffled playlist (/etc/numa/playlist.m3u)
#   priority       — music song-requests (dashboard /library, NanoClaw music)
#   overlay_queue  — Lena's voice (shoutouts). Mixed ON TOP of music with
#                    smooth_add: the music bed ducks to 50% when she talks.
#
# Music-to-music transitions crossfade over 5s. Voice has +3dB gain and is
# LUFS-normalized so Lena stays at a consistent loudness regardless of
# Deepgram output. See docs/superpowers/specs/2026-04-20-radio-feel-design.md.
#
# At each track boundary the relevant source POSTs to Vercel + the local
# daemon for now-playing updates. Overlay gets its own start/end hooks for
# the "• Lena on air" pill.
#
# Required env (in /etc/numa/env):
#   ICECAST_SOURCE_PASSWORD   — Icecast source password
#   INTERNAL_API_SECRET       — shared secret matching Vercel env

settings.frame.audio.samplerate.set(44100)
settings.log.stdout.set(true)
settings.log.level.set(3)

# ─── Local control socket (loopback only) ──────────────────────────
# Disable idle timeout so the queue daemon's persistent telnet connection
# doesn't churn. Loopback only, no untrusted consumers.
settings.server.telnet.set(true)
settings.server.telnet.bind_addr.set("127.0.0.1")
settings.server.telnet.port.set(1234)
settings.server.timeout.set(-1.)

playlist_file = "/etc/numa/playlist.m3u"

# ─── Retry-aware CDN fetcher ───────────────────────────────────────
# Cloudflare occasionally returns 522 (origin connection timeout) when
# fetching B2-backed track URLs — a single failed fetch with healthy
# fetches seconds before and after. Liquidsoap's built-in https
# protocol uses curl but gives up after one attempt, silently skipping
# the m3u line. With a ~60% one-artist catalog, every skipped breaker
# stitches two 2-runs of that artist into 4-6 in a row. We register
# our own `cdn:` protocol that wraps curl with --retry 3, then use it
# as a prefix on the rotation playlist so every URL is fetched through
# this resilient path. The built-in https protocol stays available for
# anything else (it's not used elsewhere in this script today).
def cdn_fetch(~rlog, ~maxtime=_, url) =
  outpath = file.temp("liq-cdn-", ".mp3")
  cmd =
    "curl --silent --show-error --location --fail " ^
    "--connect-timeout 5 --max-time 20 " ^
    "--retry 3 --retry-delay 1 --retry-all-errors " ^
    "--output " ^ process.quote(outpath) ^ " " ^
    process.quote(url)
  res = process.run(cmd)
  if res.status == "exit" and res.status.code == 0 then
    [outpath]
  else
    rlog("[cdn] fetch failed: status=#{res.status} code=#{res.status.code} url=#{url} stderr=#{res.stderr}")
    file.remove(outpath)
    []
  end
end
protocol.add(
  static=false,
  temporary=true,
  syntax="cdn:<https-url>",
  doc="Fetch HTTP(S) URLs via curl with retries (absorbs transient CF 522s).",
  "cdn",
  cdn_fetch
)

# ─── Sources ───────────────────────────────────────────────────────
# Music song-requests. Unchanged semantics: preempts rotation at track
# boundary via fallback(track_sensitive=true).
priority = request.queue(id="priority")

# Lena's voice overlay. Mixed ON TOP of music; never replaces it. The
# daemon pushes shoutouts here with `overlay_queue.push <url>`.
#
# DEPTH CAP: request.queue in 2.2.x has no length parameter. Today
# the per-source rate limits (booth IP limits, auto-host slot
# rotation, YouTube-chat author limit) prevent any realistic
# runaway. If a future bug ever piles items here, telnet
# `overlay_queue.queue` lists pending request IDs and `.flush`
# drops them — keep that recovery path in mind. A daemon-side
# pre-push depth check is the right place to enforce a cap.
overlay_queue = request.queue(id="overlay_queue")

# Rotation playlist. The m3u file is only rewritten by the daemon on
# cycle build / wrap / forceReshuffle (see scripts/refresh-rotation.ts),
# so Liquidsoap holds the same 161-track plan stable for the whole
# cycle and plays through it linearly.
#
# reload_mode="watch": inotify-based, only reloads when the file
# CONTENT actually changes. The previous reload_mode="seconds"
# (reload=120) re-read every 2 min and reset position to 0 when it
# saw a new mtime — which made Liquidsoap play the same 4-5 tracks at
# the head of the playlist on a loop instead of advancing through all
# 161. With watch + a stable m3u, Liquidsoap's internal position
# counter advances cleanly to the end, then loops back for the next
# cycle.
#
# mode="normal": play the file top-to-bottom in the order we wrote it.
# (Default "randomize" does its own shuffle + reshuffles at cycle
# boundary — caused back-to-back airings before this was set.)
rotation = playlist(
  id="rotation",
  mode="normal",
  reload_mode="watch",
  prefix="cdn:",
  timeout=60.,
  playlist_file
)

# ─── Now-playing notification (music) ──────────────────────────────
api_url = environment.get(
  default="https://numaradio.com/api/internal/track-started",
  "NUMA_TRACK_API_URL"
)
shoutout_started_url = environment.get(
  default="https://numaradio.com/api/internal/shoutout-started",
  "NUMA_SHOUTOUT_STARTED_URL"
)
shoutout_ended_url = environment.get(
  default="https://numaradio.com/api/internal/shoutout-ended",
  "NUMA_SHOUTOUT_ENDED_URL"
)
daemon_url = environment.get(
  default="http://127.0.0.1:4000/on-track",
  "NUMA_DAEMON_TRACK_URL"
)

# Retry helper — up to 3 attempts on transient failures (network
# error / 5xx). The 5s http.post timeout serves as natural backoff
# between attempts. A single Vercel cold-start otherwise drops the
# event entirely: track-started → NowPlaying stuck; shoutout-ended
# → orphan B2 audio + dangling QueueItem (no cleanup runs).
#
# Liquidsoap's `def rec` requires the recursive call to use an
# identical signature, so `attempts` is a required positional in the
# inner function and the public wrapper hardcodes the initial 3.
def rec post_with_retry_inner(~headers, ~data, ~attempts, url) =
  try
    r = http.post(headers=headers, data=data, timeout=5., url)
    if r.status_code >= 500 then
      if attempts > 1 then
        log.important("[numa] post 5xx (" ^ string(r.status_code) ^ "), retrying — " ^ url)
        post_with_retry_inner(headers=headers, data=data, attempts=attempts-1, url)
      else
        log.severe("[numa] post 5xx after retries: " ^ string(r.status_code) ^ " " ^ url)
      end
    elsif r.status_code != 200 then
      log.severe("[numa] post non-200: " ^ string(r.status_code) ^ " " ^ url)
    end
  catch err do
    if attempts > 1 then
      log.important("[numa] post err, retrying: " ^ string(err) ^ " " ^ url)
      post_with_retry_inner(headers=headers, data=data, attempts=attempts-1, url)
    else
      log.severe("[numa] post err after retries: " ^ string(err) ^ " " ^ url)
    end
  end
end

def post_with_retry(~headers, ~data, url) =
  post_with_retry_inner(headers=headers, data=data, attempts=3, url)
end

def notify_track_started(metadata) =
  filename = metadata["filename"]
  source_url = metadata["source_url"]
  initial_uri = metadata["initial_uri"]
  title = metadata["title"]
  artist = metadata["artist"]
  src = if source_url != "" then source_url
        elsif initial_uri != "" then initial_uri
        else filename end
  log.important(
    "[numa] track: src=" ^ src ^
    " filename=" ^ filename ^
    " source_url=" ^ source_url ^
    " initial_uri=" ^ initial_uri ^
    " title=" ^ title ^
    " artist=" ^ artist
  )
  if src != "" or title != "" then
    secret = environment.get(default="", "INTERNAL_API_SECRET")
    body = json.stringify({sourceUrl=src, title=title, artist=artist})
    if secret == "" then
      log.severe("[numa] INTERNAL_API_SECRET not set — skipping Vercel notify")
    else
      post_with_retry(
        headers=[
          ("Content-Type", "application/json"),
          ("x-internal-secret", secret)
        ],
        data=body,
        api_url
      )
    end
    post_with_retry(
      headers=[("Content-Type", "application/json")],
      data=body,
      daemon_url
    )
  end
end

# ─── Shoutout-started / ended notifications (voice overlay) ────────
# Fired on the overlay source, NOT through the normal track pipeline —
# shoutouts must never touch NowPlaying.
def notify_shoutout_started(metadata) =
  source_url = metadata["source_url"]
  initial_uri = metadata["initial_uri"]
  filename = metadata["filename"]
  title = metadata["title"]
  artist = metadata["artist"]
  src = if source_url != "" then source_url
        elsif initial_uri != "" then initial_uri
        else filename end
  log.important("[numa] shoutout start: src=" ^ src)
  secret = environment.get(default="", "INTERNAL_API_SECRET")
  if secret != "" then
    body = json.stringify({sourceUrl=src, title=title, artist=artist})
    post_with_retry(
      headers=[
        ("Content-Type", "application/json"),
        ("x-internal-secret", secret)
      ],
      data=body,
      shoutout_started_url
    )
  end
end

def notify_shoutout_ended(metadata) =
  source_url = metadata["source_url"]
  initial_uri = metadata["initial_uri"]
  filename = metadata["filename"]
  src = if source_url != "" then source_url
        elsif initial_uri != "" then initial_uri
        else filename end
  log.important("[numa] shoutout end: src=" ^ src)
  secret = environment.get(default="", "INTERNAL_API_SECRET")
  if secret != "" then
    # Pass sourceUrl in the body so the Vercel route can resolve the
    # trackId without depending on NowSpeaking. That makes a
    # double-fire (Liquidsoap retry, network blip) idempotent —
    # cleanup runs from the body either time, instead of relying on
    # state that the first fire already cleared.
    body = json.stringify({sourceUrl=src})
    post_with_retry(
      headers=[
        ("Content-Type", "application/json"),
        ("x-internal-secret", secret)
      ],
      data=body,
      shoutout_ended_url
    )
  end
end

# ─── Hooks ─────────────────────────────────────────────────────────
# Music track-boundary notifications — keep hooked on the concrete sources
# (fallback/cross wrappers don't emit on playlist-internal transitions).
priority.on_track(notify_track_started)
rotation.on_track(notify_track_started)

# Overlay: start on each new overlay track; end when the current overlay
# track finishes (remaining seconds reach 0). on_track fires per item;
# end-of-track is signaled via source.on_end which wraps the source and
# returns a new one — we reassign so the mix uses the wrapped version.
overlay_queue.on_track(notify_shoutout_started)
# delay=0.2: fire when ≤0.2 s of audio remains, so the pill clears just
# before the voice actually ends (imperceptible). Default is 5 s, which
# for a ~6 s shoutout fires almost immediately — wrong for our UI signal.
overlay_queue = source.on_end(
  delay=0.2,
  overlay_queue,
  fun (_, m) -> notify_shoutout_ended(m)
)

# ─── Music bed: fallback + 5s crossfade ────────────────────────────
# track_sensitive=true: music-level switches (priority vs rotation) still
# wait for a track boundary, matching today's behavior. cross(5.) applies
# a 5-second crossfade to all music-to-music transitions inside the bed.
music_bed = fallback(track_sensitive=true, [priority, rotation])
music_bed = crossfade(duration=5., music_bed)

# ─── Voice overlay: broadcast-style compressor + limiter ──────────
# Measured on 2026-04-20: Deepgram Aura output sits ~11 dB below music
# in RMS (-28.6 dBFS vs -17.4 dBFS). A pure amplify to catch up (+14 dB)
# would blow past 0 dBFS on peaks. `normalize` caps at gain_max=12 and
# its up=10s attack means short clips never reach target.
#
# Proper fix: compress + limit. pre_gain=14 lifts the average to music
# level; threshold=-12 + ratio=4 tames peaks that would otherwise clip;
# gain=2 puts voice clearly above the ducked bed; limit catches any
# stragglers at -1 dBFS.
voice = compress(
  attack=5.,
  release=100.,
  threshold=-12.,
  ratio=4.,
  knee=3.,
  pre_gain=14.,
  gain=2.,
  overlay_queue
)
voice = limit(threshold=-1., voice)

# ─── Mix: voice rides on top, bed ducks while she speaks ───────────
# smooth_add p=0.3 → bed drops to ≈30% (≈ -10 dB) when voice has
# content. duration=0.5s sets the attack/release fade for the duck.
# Voice plays unducked on top. Originally documented as p=0.5 / -6 dB;
# the ear preferred a deeper duck during testing on 2026-04-20.
source = smooth_add(
  duration=0.5,
  p=0.3,
  normal=music_bed,
  special=voice
)

# ─── Master safety net (post-ingest-loudnorm backstop) ─────────────
# Every music track is normalised to -14 LUFS at ingest via
# lib/loudnorm.ts. This is the backstop for outliers (a track that
# slipped past the ingest path, voice content that doesn't go through
# loudnorm, a future audio source). Gain envelope is intentionally
# tight (max +6 / min -12 dB) so we don't pump on already-normalised
# content — only catch real outliers.
source = normalize(target=-14., window=1., gain_max=6., gain_min=-12., source)

# Brick-wall to prevent any clipping reaching Icecast. Voice already
# has its own limit() at line 267; this is the master.
source = limit(threshold=-1., source)

log.important(
  "[numa] pipeline ready: api=" ^ api_url ^
  " shoutout_start=" ^ shoutout_started_url ^
  " shoutout_end=" ^ shoutout_ended_url ^
  " daemon=" ^ daemon_url
)

source = mksafe(source)

# Decouple Icecast output from the source clock. Under WSL2 the main clock
# periodically falls 1-3s behind realtime (~22 catchup events/hr observed
# 2026-04-30 and 2026-04-29 — chronic, hardware-level). Without buffering,
# those stalls reach Icecast → ffmpeg's audio mux waits → video stops
# flowing to YouTube → "videoIngestionStarved", and listeners hear hiccups.
# `buffer` runs the output on its own clock with up to 10s of prebuffered
# audio; brief source-clock lag drains buffer instead of stalling output.
source = mksafe(buffer(fallible=true, buffer=3., max=10., source))

output.icecast(
  %mp3(bitrate=192, samplerate=44100, stereo=true),
  host="localhost",
  port=8000,
  password=environment.get("ICECAST_SOURCE_PASSWORD"),
  mount="/stream",
  name="Numa Radio",
  description="Always-on AI radio",
  url="https://numaradio.com",
  genre="Various",
  source
)

# ─── Rollback escape hatch (previous graph) ────────────────────────
# If smooth_add / cross cause issues, comment out the block above from
# `music_bed = ...` through `source = smooth_add(...)` and uncomment:
#
# source = fallback(track_sensitive=true, [priority, rotation])
# source = mksafe(source)
#
# Then `sudo systemctl restart numa-liquidsoap`. Shoutouts will replace
# music at track boundaries (pre-2026-04-20 behavior).
