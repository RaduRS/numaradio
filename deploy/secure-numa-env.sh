#!/usr/bin/env bash
#
# Locks down /etc/numa/env so only root can read the secrets it
# contains (ICECAST_SOURCE_PASSWORD, INTERNAL_API_SECRET, etc.). On
# many Ubuntu setups the file lands at mode 0644 by default, which
# means any local user (or any compromised non-root process) can
# read the secrets.
#
# Run on Orion as root:
#   sudo bash deploy/secure-numa-env.sh
#
# Idempotent — safe to re-run.

set -euo pipefail

ENV_FILE=/etc/numa/env

if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE does not exist — nothing to do."
  exit 0
fi

chown root:root "$ENV_FILE"
chmod 0600 "$ENV_FILE"

echo "$ENV_FILE → root:root, mode 0600"
ls -l "$ENV_FILE"
