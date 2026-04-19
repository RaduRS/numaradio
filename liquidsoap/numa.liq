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
  # playlist.reloadable pre-downloads HTTP items to /tmp, so "filename" is the
  # local cache path, not the original B2 URL. Prefer fields that retain the
  # original remote URL; include title/artist so the API can fall back to an
  # ID3 lookup when no URL field is useful.
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
    if secret == "" then
      log.severe("[numa] INTERNAL_API_SECRET not set — skipping notify")
    else
      body = json.stringify({sourceUrl=src, title=title, artist=artist})
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

# Liquidsoap 2.2.4 method form: returns unit, mutates the source in place.
# The callback fires on every track boundary even without a reassignment.
source.on_track(notify_track_started)
log.important("[numa] notify pipeline ready, api=" ^ api_url)

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
