# Numa Radio — Server Setup (WSL2 Ubuntu)

This doc takes the home mini-server (WSL2 Ubuntu) from "fresh" to "Numa Radio is
streaming live at `api.numaradio.com/stream`". It covers Phase 1 tasks 12–14.

After completing this, listeners can hit play in any browser and hear the seed
catalog on a loop. Queue planner, host inserts, requests etc. come in later phases.

## Prerequisites

- WSL2 with Ubuntu 22.04 or 24.04 (`wsl --install -d Ubuntu` from PowerShell if not done)
- Internet access from inside WSL
- This repo cloned somewhere like `~/numaradio` (`git clone <repo-url>`)
- `.env.local` in the repo root populated with the same values as the Mac
  (`DATABASE_URL`, `B2_*`, `MINIMAX_API_KEY`, `DEEPGRAM_API_KEY`)
- A Cloudflare account that owns `numaradio.com`

## 1. Install Icecast2

Icecast is the streaming server. It accepts an audio source from Liquidsoap and
serves it to listeners over HTTP.

```bash
sudo apt update
sudo apt install -y icecast2
```

The installer prompts you for passwords. Generate randoms:

```bash
openssl rand -hex 16   # use one for source password
openssl rand -hex 16   # another for admin password
```

- "Configure Icecast2?" → **Yes**
- Source password → paste your random hex; **save it**, Liquidsoap needs it
- Relay password → reuse the source password (we don't relay)
- Admin password → paste your second random hex (web admin only)
- Hostname → `localhost`

Enable + start:

```bash
sudo systemctl enable --now icecast2
sudo systemctl status icecast2     # active (running)
```

Verify it's listening:

```bash
curl -s http://localhost:8000/status-json.xsl | head -c 200
```

The web admin is at `http://localhost:8000/admin/`.

## 2. Install Liquidsoap

```bash
sudo apt install -y liquidsoap
liquidsoap --version    # should print 2.x.x
```

If you hit "encoder mp3 not available" later, install plugins:

```bash
sudo apt install -y liquidsoap-plugin-mp3 liquidsoap-plugin-icecast
```

## 3. Minimal Liquidsoap config — proof-of-life

The repo already has `liquidsoap/numa.liq` (will be added in the next commit).
For first boot, hand-write the playlist:

```bash
sudo mkdir -p /etc/numa
sudo nano /etc/numa/playlist.m3u
```

Paste one B2 URL per line. To get the URL of an ingested track from the Mac:

```bash
# from the Mac, in the repo:
DATABASE_URL=... node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.trackAsset.findMany({ where: { assetType: 'audio_stream' } })
    .then(rows => { rows.forEach(r => console.log(r.publicUrl)); p.\$disconnect(); });
"
```

Or just use Prisma Studio on either machine (`npx prisma studio`) — open the
`TrackAsset` table, filter by `assetType = audio_stream`, copy `publicUrl`.

For the first proof, one URL is enough.

Save the password from step 1 to a file Liquidsoap can read:

```bash
sudo mkdir -p /etc/numa
sudo nano /etc/numa/env
# Contents:  ICECAST_SOURCE_PASSWORD=<your-source-password-from-step-1>
```

Run Liquidsoap manually first to verify:

```bash
set -a && . /etc/numa/env && set +a
liquidsoap ~/numaradio/liquidsoap/numa.liq
```

In another shell, verify it's airing:

```bash
curl -sI http://localhost:8000/numa | head -5
# HTTP/1.0 200 OK
# Content-Type: audio/mpeg
```

Listen with `mpv http://localhost:8000/numa` or any browser.

## 4. Cloudflare Tunnel — expose `api.numaradio.com/stream`

Install cloudflared:

```bash
curl -fL --output cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared --version
```

Authenticate (opens browser on the Windows host):

```bash
cloudflared tunnel login
# Choose numaradio.com when prompted
```

Create the tunnel:

```bash
cloudflared tunnel create numaradio
# It prints a UUID — note it
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <UUID-from-create>
credentials-file: /home/<your-username>/.cloudflared/<UUID>.json

ingress:
  - hostname: api.numaradio.com
    path: /stream
    service: http://localhost:8000/numa
  - hostname: api.numaradio.com
    service: http_status:404
```

(The path rewrite means `https://api.numaradio.com/stream` proxies to
`http://localhost:8000/numa`. We don't expose Icecast's web admin externally.)

Point DNS at the tunnel:

```bash
cloudflared tunnel route dns numaradio api.numaradio.com
```

Run it:

```bash
cloudflared tunnel run numaradio
```

From the Mac (or any device), verify externally:

```bash
curl -sI https://api.numaradio.com/stream | head -5
# HTTP/2 200
# content-type: audio/mpeg
```

🎧 Open `https://api.numaradio.com/stream` in any browser. You should hear Numa.

## 5. Run as services (survive reboots / WSL restarts)

### Liquidsoap

Create `/etc/systemd/system/numa-liquidsoap.service`:

```ini
[Unit]
Description=Numa Radio — Liquidsoap
After=network.target icecast2.service
Requires=icecast2.service

[Service]
Type=simple
User=<your-username>
EnvironmentFile=/etc/numa/env
ExecStart=/usr/bin/liquidsoap /home/<your-username>/numaradio/liquidsoap/numa.liq
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now numa-liquidsoap
```

### cloudflared

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

### WSL note

WSL2 doesn't auto-start on Windows boot by default. Either:
- Enable WSL2 systemd (`/etc/wsl.conf` → `[boot] systemd=true`) and add a Windows
  Task Scheduler entry that runs `wsl -d Ubuntu -- echo started` at login, or
- Use [WSL Auto Start](https://github.com/troytse/wsl-autostart) for cleaner setup.

For MVP, manually `wsl` into Ubuntu after Windows boots and the systemd services
will be up automatically once WSL is running.

## Done

The station is live and reachable at `https://api.numaradio.com/stream`.

## Phase 2 next steps (not in this doc)

- Write `scripts/refresh-playlist.ts` to regenerate `/etc/numa/playlist.m3u` from
  `tracks` rows in Neon on a cron (every 5 min). Liquidsoap watches the file and
  reloads on change — zero restart needed.
- Wire Liquidsoap to emit playback events (track-started / track-ended) back to
  the API so `now_playing` updates in Neon.
- Build the queue planner that maintains forward `staged` segments.
