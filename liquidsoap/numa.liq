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

# ─── Sources ───────────────────────────────────────────────────────
# Music song-requests. Unchanged semantics: preempts rotation at track
# boundary via fallback(track_sensitive=true).
priority = request.queue(id="priority")

# Lena's voice overlay. Mixed ON TOP of music; never replaces it. The
# daemon pushes shoutouts here with `overlay_queue.push <url>`.
overlay_queue = request.queue(id="overlay_queue")

# Rotation playlist — polled every 2 min in sync with the refresher's
# atomic tmp→rename.
#
# mode="normal": play the file top-to-bottom in the order we wrote it.
# (The default, "randomize", does its OWN shuffle AND reshuffles at
# cycle boundary — which is how listeners ended up hearing the same
# track twice in a row: the reshuffle had a ~1/N chance of landing
# the just-ended track first. With mode="normal" + an authoritative
# Fisher-Yates from scripts/refresh-rotation.ts, Liquidsoap respects
# our ordering. Our pool excludes the currently-playing track via
# PlayHistory + NowPlaying, so position 0 can never be the track
# that's just finishing.)
rotation = playlist(
  id="rotation",
  mode="normal",
  reload=120,
  reload_mode="seconds",
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
      try
        response = http.post(
          headers=[
            ("Content-Type", "application/json"),
            ("x-internal-secret", secret)
          ],
          data=body,
          api_url
        )
        if response.status_code != 200 then
          log.severe("[numa] track-started POST to Vercel failed: " ^ string(response.status_code))
        end
      catch err do
        log.severe("[numa] track-started POST to Vercel error: " ^ string(err))
      end
    end
    try
      _ = http.post(
        headers=[("Content-Type", "application/json")],
        data=body,
        daemon_url
      )
    catch err do
      log.severe("[numa] track-started POST to daemon error: " ^ string(err))
    end
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
    try
      r = http.post(
        headers=[
          ("Content-Type", "application/json"),
          ("x-internal-secret", secret)
        ],
        data=body,
        shoutout_started_url
      )
      if r.status_code != 200 then
        log.severe("[numa] shoutout-started POST failed: " ^ string(r.status_code))
      end
    catch err do
      log.severe("[numa] shoutout-started POST error: " ^ string(err))
    end
  end
end

def notify_shoutout_ended() =
  log.important("[numa] shoutout end")
  secret = environment.get(default="", "INTERNAL_API_SECRET")
  if secret != "" then
    try
      r = http.post(
        headers=[
          ("Content-Type", "application/json"),
          ("x-internal-secret", secret)
        ],
        data="{}",
        shoutout_ended_url
      )
      if r.status_code != 200 then
        log.severe("[numa] shoutout-ended POST failed: " ^ string(r.status_code))
      end
    catch err do
      log.severe("[numa] shoutout-ended POST error: " ^ string(err))
    end
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
  fun (_, _) -> notify_shoutout_ended()
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
# smooth_add p=0.5 → bed drops to 50% (≈ -6 dB) when voice has content.
# duration=0.5s sets the attack/release fade for the duck. Voice plays
# unducked on top.
source = smooth_add(
  duration=0.5,
  p=0.3,
  normal=music_bed,
  special=voice
)

log.important(
  "[numa] pipeline ready: api=" ^ api_url ^
  " shoutout_start=" ^ shoutout_started_url ^
  " shoutout_end=" ^ shoutout_ended_url ^
  " daemon=" ^ daemon_url
)

source = mksafe(source)

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
