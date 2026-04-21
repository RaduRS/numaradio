# Docker Engine inside WSL — unattended boot for NanoClaw

**Date:** 2026-04-21
**Status:** Approved, ready for implementation plan

## Problem

NanoClaw's container runtime is **Docker Desktop for Windows**, which is a
user-mode Windows app. After a Windows reboot with no logged-in session,
Docker Desktop does not start, so `docker info` fails inside the Ubuntu
WSL distro, so NanoClaw crash-loops, so the Telegram moderator-approval
bot is unreachable. This violates the same "survive an unattended
reboot" property the radio stack (Icecast / Liquidsoap / cloudflared /
dashboard) already has.

The existing `Start WSL (Numa Radio)` Windows scheduled task keeps the
WSL distro alive at boot via a persistent `wsl.exe … /bin/sleep infinity`
attachment (see `2026-04-21-wsl-autostart-design.md`). Any daemon that
runs *inside* that distro as a systemd service therefore starts with
the distro. Docker Engine can be one of those daemons.

## Constraints

- **Parallel with the rest of the stack.** Icecast, Liquidsoap,
  cloudflared, `numa-dashboard`, `numa-queue-daemon`, and NanoClaw all
  run as systemd units inside WSL. Docker Engine should join them, not
  live on the Windows host.
- **Zero NanoClaw config churn.** The socket path (`/var/run/docker.sock`)
  and CLI (`docker`) are the same before and after. NanoClaw must not
  need any code or environment change.
- **Reversible.** If the change breaks anything, we can re-enable
  Docker Desktop's WSL integration and be back to the old state in a
  few minutes.
- **Minimal scope.** Replace the container runtime only. No other
  systemd units change. No changes to NanoClaw, the dashboard, the
  queue daemon, or Liquidsoap.

## Architecture

**Before:**
```
Windows user session ──► Docker Desktop (HyperV utility VM)
                           └── WSL integration mounts /mnt/wsl/docker-desktop
                                 └── /usr/bin/docker symlink
                                 └── /var/run/docker.sock proxy
                                       └── NanoClaw
```

**After:**
```
Start WSL (Numa Radio) scheduled task (S4U, no login)
  └── Ubuntu WSL distro (systemd=true)
        ├── Icecast, Liquidsoap, cloudflared, numa-dashboard, numa-queue-daemon
        ├── dockerd (docker.service, system systemd unit)  ← NEW
        │     └── /var/run/docker.sock
        └── nanoclaw (systemd --user unit)  ── connects via /var/run/docker.sock
```

`dockerd` becomes one more citizen of the WSL distro, reached through
the existing autostart path. NanoClaw's container-runtime check
(`docker info`) now talks to a local dockerd whose lifetime is bound to
the distro, not to any Windows user session.

## Components

### 1. Remove Docker Desktop's grip on the WSL distro

**Manual step on Windows** (operator, not automated):

Docker Desktop → Settings → Resources → WSL Integration → **uncheck**
the Ubuntu distro. This removes the `/mnt/wsl/docker-desktop` mount,
deletes the `/usr/bin/docker` symlink inside the distro, and stops
Docker Desktop from proxying `/var/run/docker.sock`.

Uninstalling Docker Desktop entirely is **optional** — it frees
Windows-side RAM and removes the autostart-on-login tray icon, but is
not required for this design. If the operator keeps Docker Desktop for
other work on Windows, unchecking WSL integration is enough to end its
involvement with the radio stack.

### 2. Install Docker CE inside Ubuntu WSL

Standard Docker-upstream apt repo (not `docker.io` from Ubuntu
universe — the upstream repo ships the same docker-ce, docker-ce-cli,
containerd.io, docker-buildx-plugin, docker-compose-plugin versions the
rest of the world uses):

```bash
# Add Docker's GPG key
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repo
echo \
  "deb [arch=$(dpkg --print-architecture) \
   signed-by=/etc/apt/keyrings/docker.asc] \
   https://download.docker.com/linux/ubuntu \
   $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

### 3. Wire Docker into the WSL boot

```bash
# Make sure systemd is on in WSL (precondition: it already is, because
# nanoclaw runs as a --user unit — that wouldn't work otherwise).
grep -q "^systemd=true" /etc/wsl.conf || {
  echo "ERROR: /etc/wsl.conf is missing [boot] systemd=true"
  exit 1
}

# Grant the operator group membership (so docker commands don't need sudo).
sudo usermod -aG docker marku
# Note: group membership takes effect on next login / `newgrp docker`.

# Enable + start the daemon as a system service.
sudo systemctl enable --now docker
sudo systemctl is-enabled docker    # expect: enabled
sudo systemctl is-active  docker    # expect: active
```

### 4. Verify

```bash
docker version                      # both client and server should appear
docker info | head -20              # no Docker-Desktop mention
docker run --rm hello-world         # prints the canonical message
```

Then rotate NanoClaw onto the new socket:

```bash
systemctl --user restart nanoclaw
journalctl --user -u nanoclaw -n 30 --no-pager | \
  grep -i "container runtime" | head -3
# expect: no "Failed to reach container runtime" entries
```

Finally, end-to-end — send any message to `@nanoOrion_bot`. The agent
should reply within ~10 s, which confirms NanoClaw successfully spun
up a container session on the new dockerd.

### 5. Install a lightweight TUI for visibility

Docker Desktop's Dashboard window is the only thing going away
functionally; give the operator a comparable terminal experience:

```bash
# Docker-upstream apt repo does NOT include lazydocker; use its
# install-script variant.
curl https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash
```

Then `lazydocker` in any terminal opens a full-screen TUI with live
containers / images / logs / stats. Optional but highly recommended.

## Image migration

Any container images or build caches NanoClaw previously relied on
live in Docker Desktop's storage (the HyperV VM's disk, invisible to
Ubuntu WSL's filesystem). The new dockerd has an empty
`/var/lib/docker`. On the first agent session after the switch,
NanoClaw will rebuild/pull its Claude Code container image — typically
2–5 minutes, one-time. No data loss. No persistent volumes are
involved for NanoClaw (session data lives under `~/nanoclaw/data`,
which is on the WSL filesystem, not inside Docker).

## Error handling & edge cases

- **Docker Desktop still enabled at the same time** — symptom: the
  `/var/run/docker.sock` path might end up pointing at Docker Desktop's
  proxy instead of the new dockerd. Mitigation: verify `docker info`
  shows a native Linux dockerd (not "Docker Desktop") before restarting
  NanoClaw. If it still shows Desktop, uncheck WSL integration and
  re-run.
- **`systemd=true` missing from `/etc/wsl.conf`** — script aborts loudly.
  Operator edits the file and runs `wsl --shutdown` once from Windows.
- **`docker.service` fails to start** — most common cause is
  iptables-legacy vs iptables-nft conflict on some kernel flavours.
  `journalctl -u docker.service` usually says so explicitly;
  `sudo update-alternatives --config iptables` to pick `iptables-nft`
  resolves it.
- **NanoClaw can't see the socket** — usually `marku` not yet in the
  `docker` group in the current shell. `newgrp docker` or a fresh
  `systemctl --user daemon-reload && systemctl --user restart nanoclaw`
  picks up the new group.
- **Containers left behind from previous attempts** — harmless under
  the new dockerd (it simply doesn't know about them). Remove by
  restarting Docker Desktop and running `docker system prune` there
  before handing over, or ignore.

## Testing

There are no new code paths — this is an ops change — so the test
plan is live verification:

1. `docker run --rm hello-world` succeeds.
2. `systemctl is-enabled docker` → `enabled`.
3. NanoClaw starts cleanly: `systemctl --user status nanoclaw` shows
   `active (running)`, no "Failed to reach container runtime" in the
   last 30 log lines.
4. Telegram `@nanoOrion_bot` responds to a test message within ~10 s.
5. **Unattended-reboot test.** Reboot Windows and do NOT log in.
   Verify from a phone or second machine:
   - `curl -sI https://api.numaradio.com/stream` returns 200 (existing
     behavior, should not regress).
   - Submit a shoutout containing "fuck" on numaradio.com → Telegram
     DM from `@nanoOrion_bot` arrives within ~90 s.
   Both without anyone touching the Orion host. This is the
   acceptance test for the whole change.

## Rollback

If any step fails or something else breaks:

```bash
# Stop native dockerd.
sudo systemctl disable --now docker
```

Then on Windows, re-check the Ubuntu distro under Docker Desktop →
Settings → Resources → WSL Integration. Docker Desktop's
`/mnt/wsl/docker-desktop` mount reappears; `/var/run/docker.sock` is
proxied to it again.

```bash
systemctl --user restart nanoclaw
```

Back to the pre-change state. No data loss because no radio-critical
state lived inside Docker.

## Out of scope

- No changes to NanoClaw itself, the dashboard, the queue daemon,
  Liquidsoap, or Icecast.
- No new monitoring / alerting. The unattended-reboot test above is
  the single acceptance criterion.
- No migration of Docker Desktop images (we accept the one-time
  rebuild of NanoClaw's container image).
- No change to the public-facing radio URL or certificates.
- No change to the `Start WSL (Numa Radio)` scheduled task — it
  already keeps the WSL distro alive, which is all we need.
