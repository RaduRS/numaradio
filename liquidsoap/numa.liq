# Numa Radio — minimal live stream
#
# Reads /etc/numa/playlist.m3u (auto-refreshed by a separate cron later) and
# pipes the audio to Icecast at mount /stream.
#
# At each track boundary, POSTs to /api/internal/track-started so the website
# can show a truthful elapsed/duration progress bar.
#
# Required env (in /etc/numa/env):
#   ICECAST_SOURCE_PASSWORD   — Icecast source password from setup step 1
#   INTERNAL_API_SECRET       — shared secret matching Vercel env

settings.frame.audio.samplerate.set(44100)
settings.log.stdout.set(true)
settings.log.level.set(3)

# ─── Local control socket (loopback only) ──────────────────────────
# settings.server.timeout defaults to 30s and causes idle telnet
# connections to drop — which makes the queue daemon's reconnect loop
# thrash (re-hydrating staged items every ~30s). Loopback-only with no
# untrusted consumers, so disable the timeout entirely.
settings.server.telnet.set(true)
settings.server.telnet.bind_addr.set("127.0.0.1")
settings.server.telnet.port.set(1234)
settings.server.timeout.set(-1.)

playlist_file = "/etc/numa/playlist.m3u"

# ─── Sources ───────────────────────────────────────────────────────
priority = request.queue(id="priority")

rotation = playlist.reloadable(
  id="rotation",
  reload_mode="watch",
  playlist_file
)

# ─── Now-playing notification ──────────────────────────────────────
api_url = environment.get(
  default="https://numaradio.com/api/internal/track-started",
  "NUMA_TRACK_API_URL"
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
    # Also notify the local daemon. Loopback-only, no auth needed.
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

# ─── Composite source with track-boundary safety ───────────────────
# track_sensitive=true: sources only switch at track boundaries. A
# priority push mid-song waits for the current song to finish. A
# rotation reload mid-song also waits.
source = fallback(track_sensitive=true, [priority, rotation, blank()])

source.on_track(notify_track_started)
log.important("[numa] notify pipeline ready, api=" ^ api_url ^ " daemon=" ^ daemon_url)

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
