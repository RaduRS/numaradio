#!/usr/bin/env bash
# install-docker-ce.sh
#
# One-shot migration from Docker Desktop (Windows user-mode app) to Docker
# Engine (Docker CE) running inside the WSL distro as a systemd unit. See
# docs/superpowers/specs/2026-04-21-docker-in-wsl-design.md for the full
# design.
#
# PREREQUISITE (do this BEFORE running the script):
#   On Windows, open Docker Desktop → Settings → Resources → WSL
#   Integration, and UNCHECK the Ubuntu distro. Click "Apply & restart".
#   This stops Docker Desktop from proxying /var/run/docker.sock and
#   shadowing /usr/bin/docker.
#
# USAGE (from inside the WSL Ubuntu distro):
#   cd ~/saas/numaradio
#   ./deploy/install-docker-ce.sh
#
# Idempotent: re-running is safe. The script detects existing state and
# skips steps that are already done.

set -euo pipefail

log()  { printf "\033[1;34m[install-docker-ce]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[install-docker-ce WARN]\033[0m %s\n" "$*" >&2; }
die()  { printf "\033[1;31m[install-docker-ce ERROR]\033[0m %s\n" "$*" >&2; exit 1; }

# --------------------------- Preconditions ---------------------------

if [[ "$EUID" -eq 0 ]]; then
  die "Do not run this as root. Run as your normal WSL user; the script uses sudo where needed."
fi

if ! command -v sudo >/dev/null 2>&1; then
  die "sudo is required but not installed."
fi

if ! grep -qE "^\s*systemd\s*=\s*true" /etc/wsl.conf 2>/dev/null; then
  die "/etc/wsl.conf does not have [boot] systemd=true. Add it, then run 'wsl --shutdown' from Windows and reopen the distro."
fi

if [[ -d /mnt/wsl/docker-desktop ]]; then
  warn "Docker Desktop's WSL integration is STILL ACTIVE (/mnt/wsl/docker-desktop exists)."
  warn "Open Docker Desktop → Settings → Resources → WSL Integration and uncheck this distro, then rerun."
  die  "Aborting to avoid socket/CLI conflict with Docker Desktop."
fi

log "Preconditions OK. Acquiring sudo (you'll be prompted once)…"
sudo -v
# Keep the sudo timestamp fresh while the script runs.
( while true; do sleep 60; sudo -n true >/dev/null 2>&1 || exit; done ) &
SUDO_KEEPALIVE_PID=$!
trap 'kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true' EXIT

# ------------------------ Docker CE apt repo -------------------------

if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  log "Installing Docker apt GPG key…"
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
else
  log "Docker apt GPG key already present."
fi

if [[ ! -f /etc/apt/sources.list.d/docker.list ]]; then
  log "Adding Docker apt source…"
  CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
  ARCH="$(dpkg --print-architecture)"
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
else
  log "Docker apt source already present."
fi

log "Updating apt package index…"
sudo apt-get update -y

# --------------------------- Install -------------------------------

log "Installing docker-ce, docker-ce-cli, containerd.io, buildx, compose…"
sudo apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

# --------------------------- Group membership ----------------------

if id -nG "$USER" | grep -qw docker; then
  log "User $USER already in docker group."
else
  log "Adding $USER to docker group (takes effect on next login / newgrp)…"
  sudo usermod -aG docker "$USER"
fi

# --------------------------- Service -------------------------------

log "Enabling and starting docker.service…"
sudo systemctl enable --now docker

log "Confirming service state…"
sudo systemctl is-enabled docker
sudo systemctl is-active  docker

# --------------------------- Verify --------------------------------

log "docker version output:"
docker version || true

log "Checking that dockerd is native (not Docker Desktop)…"
if docker info 2>&1 | grep -q "Operating System:.*Docker Desktop"; then
  die "docker info still reports 'Docker Desktop'. WSL integration is still active — disable it and rerun."
fi
docker info 2>&1 | grep -E "^\s*(Server Version|Operating System|Kernel Version|Name):" | head -5 || true

log "Running hello-world smoke test…"
# Use sudo for the first run since group membership hasn't taken effect in
# this shell. After a fresh login the plain `docker` command will work.
sudo docker run --rm hello-world | tail -15

# --------------------------- lazydocker ----------------------------

if ! command -v lazydocker >/dev/null 2>&1; then
  log "Installing lazydocker (terminal UI for Docker)…"
  # Official install script from lazydocker upstream. Installs to
  # ~/.local/bin by default; fall back to /usr/local/bin if PATH misses it.
  curl -fsSL https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash || \
    warn "lazydocker install failed — not critical. Install manually later if wanted."
else
  log "lazydocker already installed."
fi

# --------------------------- NanoClaw reload -----------------------

if systemctl --user list-unit-files nanoclaw.service >/dev/null 2>&1; then
  log "Restarting nanoclaw.service (user unit) to pick up the new dockerd…"
  systemctl --user restart nanoclaw
  sleep 3
  if systemctl --user is-active nanoclaw >/dev/null; then
    log "nanoclaw is active."
  else
    warn "nanoclaw failed to become active — check 'journalctl --user -u nanoclaw -n 50 --no-pager'."
  fi
else
  warn "No nanoclaw.service found under --user systemd; skipping restart step."
fi

# --------------------------- Summary -------------------------------

cat <<EOF

===============================================================
Migration to Docker Engine in WSL complete.

Verify end-to-end:
  1. docker info | head            # should NOT say 'Docker Desktop'
  2. systemctl --user status nanoclaw --no-pager | head
  3. Send a test message to @nanoOrion_bot → agent replies
  4. Acceptance test: reboot Windows without logging in, then from
     your phone submit a shoutout with 'fuck' in it → Telegram ping
     arrives within ~90s.

Useful day-to-day commands:
  docker ps                        # running containers
  docker logs -f <name>            # stream container logs
  docker events                    # real-time events
  lazydocker                       # full-screen TUI

If you want to free RAM on Windows, you can now uninstall Docker
Desktop entirely (optional).
===============================================================
EOF
