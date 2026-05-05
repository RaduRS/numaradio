#!/usr/bin/env bash
#
# Locks down env files so only the relevant service user can read
# the secrets they contain. On many Ubuntu setups files land at
# mode 0644 by default → any local user or compromised non-root
# process can read INTERNAL_API_SECRET, DATABASE_URL,
# RESEND_API_KEY, YOUTUBE_OAUTH_*, etc.
#
# Run on Orion as root:
#   sudo bash deploy/secure-numa-env.sh
#
# Idempotent — safe to re-run.

set -euo pipefail

# /etc/numa/env: shared system env — root:root 0600. Read by
# numa-liquidsoap, numa-queue-daemon, numa-song-worker, the encoder.
ROOT_ENV=/etc/numa/env
if [ -f "$ROOT_ENV" ]; then
  chown root:root "$ROOT_ENV"
  chmod 0600 "$ROOT_ENV"
  echo "$ROOT_ENV → root:root, mode 0600"
  ls -l "$ROOT_ENV"
else
  echo "$ROOT_ENV does not exist — skipping."
fi

# Dashboard env: read by numa-dashboard.service which runs as
# user `marku`. Lock to marku:marku 0600 — only the dashboard
# process can read DATABASE_URL / INTERNAL_API_SECRET /
# RESEND_API_KEY / YOUTUBE_OAUTH_*, not other local users.
DASH_ENV=/home/marku/saas/numaradio/dashboard/.env.local
if [ -f "$DASH_ENV" ]; then
  chown marku:marku "$DASH_ENV"
  chmod 0600 "$DASH_ENV"
  echo "$DASH_ENV → marku:marku, mode 0600"
  ls -l "$DASH_ENV"
else
  echo "$DASH_ENV does not exist — skipping."
fi
