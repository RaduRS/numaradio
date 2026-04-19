# Numa Radio — minimal live stream
#
# Reads /etc/numa/playlist.m3u (auto-refreshed by a separate cron later) and
# pipes the audio to Icecast at mount /numa.
#
# Required env: ICECAST_SOURCE_PASSWORD (the password you set when installing
# Icecast — see docs/SERVER_SETUP.md step 1).

settings.frame.audio.samplerate.set(44100)
settings.log.stdout.set(true)
settings.log.level.set(3)

playlist_file = "/etc/numa/playlist.m3u"

# Reload whenever the file changes on disk — no restart required.
source = playlist.reloadable(reload_mode="watch", playlist_file)

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
