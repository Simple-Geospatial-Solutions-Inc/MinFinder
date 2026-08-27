#!/usr/bin/env sh
# deploy.sh — push $BASEMAP_OUT_DIR to the VPS and restart the tile server.
#
# Copies basemap.pmtiles, terrain.pmtiles, contours.pmtiles, roads.pmtiles,
# context.pmtiles, glyphs/, sprite*, style.json and preview.html to
# $DEPLOY_DIR on the host serving
# $BASEMAP_HOST, then restarts the pmtiles systemd unit so go-pmtiles
# reopens the replaced archives (its header/directory cache would otherwise
# hold offsets into the old files).
#
# One-time VPS setup is described at the top of serve/pmtiles.service and
# serve/Caddyfile.example; this script only ships data to an already
# configured host.
#
# Requires on the host: ssh; rsync if available (preferred — incremental,
# resumable), otherwise falls back to tar-over-ssh (Git Bash on Windows
# ships ssh + tar but not rsync).
#
# Env overrides (defaults below):
#   DEPLOY_SSH   ssh destination, default deploy@$BASEMAP_HOST
#   DEPLOY_DIR   target directory on the VPS, default /srv/basemap
#   DEPLOY_SUDO  set to "" if the ssh user may systemctl without sudo
set -eu

# Fail with a hint (not a cryptic shell error) when config.env has not been
# created from the example yet — same guard as 01-vector-tiles.sh.
if [ ! -f "$(dirname "$0")/../config.env" ]; then
  echo "deploy: config.env not found in basemap/." >&2
  echo "  Create it first: cp config.env.example config.env" >&2
  exit 1
fi
. "$(dirname "$0")/../config.env"

# Relative BASEMAP_* dirs are resolved against the basemap/ directory so the
# result is the same no matter where this script is invoked from.
cd "$(dirname "$0")/.."

DEPLOY_SSH="${DEPLOY_SSH:-deploy@$BASEMAP_HOST}"
DEPLOY_DIR="${DEPLOY_DIR:-/srv/basemap}"
DEPLOY_SUDO="${DEPLOY_SUDO-sudo}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/minfinder_tiles}"

# Every ssh below passes the key explicitly instead of relying on the
# operator's ~/.ssh/config. DEPLOY_SSH is deliberately an ADDRESS, not the
# public tile hostname (a CDN-proxied name does not answer on port 22), and a
# `Host tiles.example.ca` block then stops matching -- so the identity silently
# stops being supplied and every command fails with
# "Permission denied (publickey)" against a box you can ssh to by hand.
# The containerised rsync below already passes -i for exactly this reason;
# these calls need to agree with it.
ssh_vps() {
  ssh -i "$DEPLOY_SSH_KEY" -o StrictHostKeyChecking=accept-new "$DEPLOY_SSH" "$@"
}

if [ ! -f "$BASEMAP_OUT_DIR/basemap.pmtiles" ]; then
  echo "deploy: ERROR: $BASEMAP_OUT_DIR/basemap.pmtiles not found — run the build first." >&2
  exit 1
fi
for f in terrain.pmtiles contours.pmtiles glyphs/Open\ Sans\ Bold/0-255.pbf sprite.json sprite.png; do
  if [ ! -e "$BASEMAP_OUT_DIR/$f" ]; then
    echo "deploy: WARNING: $BASEMAP_OUT_DIR/$f is missing; deploying anyway." >&2
  fi
done

# preview.html is a source file, not a build output, so it is copied into the
# output tree here rather than living there. It must be INSIDE the synced tree:
# rsync runs with --delete, so a copy scp'd straight to the box would be wiped
# by the next deploy. Serving it means every deploy ends with a real browser
# smoke test at https://<host>/preview.html that exercises the style, glyphs,
# sprites, TileJSON and all five tilesets at once.
cp ./preview.html "$BASEMAP_OUT_DIR/preview.html"

echo "==> Deploying $BASEMAP_OUT_DIR -> $DEPLOY_SSH:$DEPLOY_DIR"
ssh_vps "mkdir -p '$DEPLOY_DIR'"

# Transfer. rsync is strongly preferred: the payload is ~10 GB, and rsync is
# both incremental (a re-deploy after a monthly basemap rebuild re-sends only
# basemap.pmtiles) and resumable via --partial.
#
# -z is deliberately NOT used: .pmtiles archives are already internally gzipped,
# so wire compression burns CPU for no gain.
if command -v rsync >/dev/null 2>&1; then
  rsync -av --partial --delete --chmod=D755,F644 --filter='P /style.json' \
    "$BASEMAP_OUT_DIR"/ "$DEPLOY_SSH:$DEPLOY_DIR/"
elif command -v podman >/dev/null 2>&1; then
  # Git Bash on Windows ships ssh and tar but NOT rsync, and the tar fallback
  # below cannot detect a sender-side pipe failure (POSIX sh has no pipefail) --
  # unacceptable for a multi-GB transfer that would fail silently. Since the
  # build already requires podman, borrow rsync from a container instead.
  #
  # The key is copied to /tmp and chmod 600 inside the container because a
  # bind mount from Windows presents permissions ssh rejects as too open.
  echo "    rsync not on PATH; using containerized rsync via podman."
  key_abs=$(cd "$(dirname "$DEPLOY_SSH_KEY")" && (pwd -W 2>/dev/null || pwd))/$(basename "$DEPLOY_SSH_KEY")
  out_abs=$(cd "$BASEMAP_OUT_DIR" && (pwd -W 2>/dev/null || pwd))
  MSYS_NO_PATHCONV=1 podman run --rm \
    -v "$out_abs:/out:ro" \
    -v "$key_abs:/keys/id:ro" \
    docker.io/library/alpine:3.20 sh -c '
      set -eu
      apk add --no-cache rsync openssh-client >/dev/null
      cp /keys/id /tmp/id && chmod 600 /tmp/id
      rsync -av --partial --delete --chmod=D755,F644 --filter="P /style.json" \
        -e "ssh -i /tmp/id -o StrictHostKeyChecking=accept-new" \
        /out/ '"$DEPLOY_SSH:$DEPLOY_DIR"'/
    '
else
  # Last resort. Not incremental, and a failure of the SENDING side of the pipe
  # is invisible here -- verify with the smoke test below, never the exit status.
  echo "    WARNING: no rsync and no podman; falling back to tar over ssh."
  echo "    This is a full re-upload and cannot detect send-side failure."
  ( cd "$BASEMAP_OUT_DIR" && tar -cf - . ) | ssh_vps "tar -xf - -C '$DEPLOY_DIR'"
fi

# --- Ownership/permissions -------------------------------------------------
# rsync -a preserves source modes, and from a Windows build host those arrive
# ubuntu-owned and unreadable by anyone else -- go-pmtiles (running as the
# `pmtiles` system user) would then 404 every tile. Force the split the box is
# set up for: ubuntu owns and writes, pmtiles reads via the group. --chmod
# above handles file modes; this fixes group ownership and the directory.
#
# The directory is 755, NOT 750. Caddy serves glyphs/ and sprite* straight off
# disk as the `caddy` user, which is in neither ubuntu nor pmtiles -- at 750 it
# cannot traverse the directory and every static asset 403s while tiles keep
# working, which is a confusing way to fail. The content is public map data
# served to the internet anyway, so world-readable costs nothing.
echo "==> Fixing ownership for the pmtiles service user"
ssh_vps "$DEPLOY_SUDO chown -R ubuntu:pmtiles '$DEPLOY_DIR' && $DEPLOY_SUDO chmod 755 '$DEPLOY_DIR'"

echo "==> Restarting pmtiles service"
# Restart (not reload): go-pmtiles must reopen the replaced .pmtiles files.
# Brief (<1s) tile outage; clients retry and cached tiles keep maps alive.
ssh_vps "$DEPLOY_SUDO systemctl restart pmtiles"
ssh_vps "$DEPLOY_SUDO systemctl is-active pmtiles" || {
  echo "deploy: ERROR: pmtiles service failed to come back — check: ssh $DEPLOY_SSH journalctl -u pmtiles -n 50" >&2
  exit 1
}

echo "==> Smoke test"
# TileJSON is the cheapest end-to-end check: Caddy -> go-pmtiles -> archive.
code=$(curl -s -o /dev/null -w '%{http_code}' "https://$BASEMAP_HOST/basemap.json") || code=000
if [ "$code" = "200" ]; then
  echo "    https://$BASEMAP_HOST/basemap.json -> 200 OK"
else
  echo "deploy: WARNING: https://$BASEMAP_HOST/basemap.json returned $code (DNS/Caddy not set up yet?)" >&2
fi

echo "==> Deploy complete."
