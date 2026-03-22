#!/usr/bin/env bash
# Deploy by building on the server (no local Docker / RAM needed on your laptop).
# Usage: ./scripts/deploy-droplet.sh
#
# Safe for open source: no API keys, hosts, or paths are baked in except optional
# defaults you override with env vars. Secrets stay in ~/.ssh and server .env (never committed).
#
# Optional:
#   CLIRA_SSH_HOST   SSH Host from ~/.ssh/config (default: digital-ocean-droplet — change this)
#   CLIRA_REMOTE_DIR absolute path on server (default: ~/Clira on the server)

set -euo pipefail

SSH_HOST="${CLIRA_SSH_HOST:-digital-ocean-droplet}"

run_remote() {
  local remote_cmd

  if [[ -z "${CLIRA_REMOTE_DIR:-}" ]]; then
    remote_cmd='set -euo pipefail; cd ~/Clira; git pull --ff-only; DOCKER_BUILDKIT=1 docker compose up --build -d'
    ssh "$SSH_HOST" "bash -lc $(printf '%q' "$remote_cmd")"
  else
    printf -v remote_cmd 'set -euo pipefail; cd %q; git pull --ff-only; DOCKER_BUILDKIT=1 docker compose up --build -d' "$CLIRA_REMOTE_DIR"
    ssh "$SSH_HOST" "bash -lc $(printf '%q' "$remote_cmd")"
  fi
}

echo "==> ${SSH_HOST}: git pull + docker compose up --build -d"
run_remote
echo "==> Done."
