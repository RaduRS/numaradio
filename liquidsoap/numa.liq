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

playlist_file = "/etc/numa/playlist.m3u"

# Reload whenever the file changes on disk — no restart required.
source = playlist.reloadable(reload_mode="watch", playlist_file)

# ─── Now-playing notification ─────────────────────────────────────
# POST { sourceUrl } to the API on every track boundary so the website can
# show truthful elapsed time. Fire-and-forget; we ignore failures so a
# transient API blip never affects audio playback.

api_url = environment.get(
  default="https://numaradio.com/api/internal/track-started",
  "NUMA_TRACK_API_URL"
)

def notify_track_started(metadata) =
  url = metadata["filename"]
  if url != "" then
    log.important("[numa] track started: " ^ url)
    secret = environment.get(default="", "INTERNAL_API_SECRET")
    if secret == "" then
      log.severe("[numa] INTERNAL_API_SECRET not set — skipping notify")
    else
      body = json.stringify({sourceUrl=url})
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
          log.severe("[numa] track-started POST failed: " ^ string(response.status_code))
        end
      catch err do
        log.severe("[numa] track-started POST error: " ^ string(err))
      end
    end
  end
end

source.on_track(notify_track_started)

# mksafe wraps the source so a stall or empty playlist falls back to silence
# instead of disconnecting Icecast.
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
