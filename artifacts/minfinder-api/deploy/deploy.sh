#!/usr/bin/env sh
# deploy.sh — ship the Community Mines API to the VPS and restart it.
#
# Copies src/, assets/, package.json and package-lock.json to /srv/minfinder-api/app, installs the
# production dependencies there with `npm ci` (so sharp gets its linux-x64 binaries, not the
# ones on this machine), then restarts minfinder-api. One-time box setup is in the header of
# minfinder-api.service; this only updates an already-installed service.
#
# The box installs from package-lock.json, not pnpm-lock.yaml: the workspace lockfile can't
# be installed from outside the workspace. After changing a dependency, refresh it with
#   (cd artifacts/minfinder-api && npm install --package-lock-only --ignore-scripts)
#
# tar over ssh rather than rsync: Git Bash on Windows ships ssh and tar but no rsync.
#
# Env overrides:
#   DEPLOY_SSH      ssh destination, default ubuntu@51.222.206.236
#   DEPLOY_SSH_KEY  default ~/.ssh/minfinder_tiles
set -eu
cd "$(dirname "$0")/.."

DEPLOY_SSH="${DEPLOY_SSH:-ubuntu@51.222.206.236}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/minfinder_tiles}"
ssh_vps() { ssh -i "$DEPLOY_SSH_KEY" -o StrictHostKeyChecking=accept-new "$DEPLOY_SSH" "$@"; }

node --test test/*.test.ts >/dev/null || { echo "deploy: tests fail — not shipping." >&2; exit 1; }

# Unpack into a fresh directory and swap it in, so a failed npm ci never leaves the live app
# half-updated.
tar -cf - src assets package.json package-lock.json | ssh_vps '
  set -eu
  sudo rm -rf /srv/minfinder-api/app.new
  sudo mkdir -p /srv/minfinder-api/app.new
  sudo tar -C /srv/minfinder-api/app.new -xf -
  cd /srv/minfinder-api/app.new
  sudo npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  sudo rm -rf /srv/minfinder-api/app.old
  [ -d /srv/minfinder-api/app ] && sudo mv /srv/minfinder-api/app /srv/minfinder-api/app.old
  sudo mv /srv/minfinder-api/app.new /srv/minfinder-api/app
  sudo systemctl restart minfinder-api
  sleep 2
  systemctl is-active minfinder-api
  curl -fsS http://127.0.0.1:8084/v1/health; echo
'
echo "deploy: done. Roll back on the box with: sudo rm -rf /srv/minfinder-api/app && sudo mv /srv/minfinder-api/app.old /srv/minfinder-api/app && sudo systemctl restart minfinder-api"
