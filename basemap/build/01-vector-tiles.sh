#!/usr/bin/env sh
# 01-vector-tiles.sh — build $BASEMAP_OUT_DIR/basemap.pmtiles (OSM vector tiles, z0-14)
# using Planetiler in Podman. No host toolchain needed beyond podman itself.
set -eu

# Resolve everything relative to the basemap/ directory so the script behaves
# the same no matter where it is invoked from.
BASEMAP_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$BASEMAP_DIR"
if [ ! -f "$BASEMAP_DIR/config.env" ]; then
  echo "01-vector-tiles: $BASEMAP_DIR/config.env not found." >&2
  echo "  Create it first: cp config.env.example config.env" >&2
  exit 1
fi
. "$BASEMAP_DIR/config.env"

FORCE=${FORCE:-0}

# Pinned Planetiler image. Tags are plain X.Y.Z (no "v" prefix) on GHCR.
# Check for a newer release at https://github.com/onthegomap/planetiler/releases
# or the tag list at https://github.com/onthegomap/planetiler/pkgs/container/planetiler
PLANETILER_IMAGE="ghcr.io/onthegomap/planetiler:0.10.2"

OUT_FILE="$BASEMAP_OUT_DIR/basemap.pmtiles"

if [ -f "$OUT_FILE" ] && [ "$FORCE" != "1" ]; then
  echo "01-vector-tiles: $OUT_FILE already exists, skipping (set FORCE=1 to rebuild)."
  exit 0
fi

mkdir -p "$BASEMAP_DATA_DIR" "$BASEMAP_OUT_DIR"

# Podman needs absolute host paths for -v. Under Git Bash on Windows,
# `pwd -W` prints a C:/... path (which the Windows podman machine requires); on Linux
# that flag doesn't exist and we fall back to plain pwd.
abspath() {
  ( cd "$1" && ( pwd -W 2>/dev/null || pwd ) )
}
DATA_ABS=$(abspath "$BASEMAP_DATA_DIR")
OUT_ABS=$(abspath "$BASEMAP_OUT_DIR")

# Ownership of bind-mount output is handled by rootless Podman itself: the
# container's root maps to the invoking host user, so files land owned by you.
# Do NOT add --user "$(id -u):$(id -g)" here — under rootless Podman that maps
# into the subuid range and produces files owned by an unmapped high UID,
# which is the opposite of what --user does under Docker.
#
# On an SELinux host (Fedora/RHEL) bind mounts additionally need a :z suffix,
# e.g. -v "$DATA_ABS:/data:z". Omitted by default: relabelling the multi-GB
# DEM directory is slow, and Podman on Windows/WSL has no SELinux.

# --force is only passed to Planetiler when we intend to overwrite.
PT_FORCE=""
if [ "$FORCE" = "1" ]; then
  PT_FORCE="--force"
fi

echo "01-vector-tiles: building $OUT_FILE from Geofabrik area '$BASEMAP_AREA'"
echo "  image: $PLANETILER_IMAGE  heap: $PLANETILER_XMX"
echo "  data (download cache): $DATA_ABS"
echo "  output dir:            $OUT_ABS"

# Notes on the invocation:
# - MSYS_NO_PATHCONV=1 stops Git Bash from rewriting container-side paths like
#   /data and /out into Windows paths; it is ignored on Linux.
# - Planetiler resolves its default source cache to data/sources relative to the
#   container working directory (/), i.e. /data/sources — so mounting
#   $BASEMAP_DATA_DIR at /data persists the ~1.24 GB BC extract (plus the
#   OpenMapTiles helper data: water polygons, Natural Earth, lake centerlines)
#   across runs. --download skips files that are already present and complete.
# - JAVA_TOOL_OPTIONS is the documented way to hand Planetiler a JVM heap size.
# - --output ending in .pmtiles makes Planetiler write PMTiles directly.
# - z0-14 is the OpenMapTiles default, but we pin it explicitly since the app
#   depends on maxzoom 14.
# - $PT_FORCE is intentionally unquoted: empty means
#   "no extra args", non-empty means two/one args (no spaces inside).
# - Planetiler writes to a temp name first, and we rename into place only on
#   success. Otherwise an interrupted build leaves a partial basemap.pmtiles
#   that the exists-check above would treat as complete on the next run.
#   The temp name keeps the .pmtiles extension (Planetiler picks the output
#   format from it) and stale temps are removed up front, since Planetiler
#   refuses to overwrite an existing output without --force.
TMP_FILE="$BASEMAP_OUT_DIR/.tmp-basemap.pmtiles"
rm -f "$TMP_FILE"

MSYS_NO_PATHCONV=1 podman run --rm \
  -e JAVA_TOOL_OPTIONS="-Xmx$PLANETILER_XMX" \
  -v "$DATA_ABS:/data" \
  -v "$OUT_ABS:/out" \
  "$PLANETILER_IMAGE" \
  --download \
  --area="$BASEMAP_AREA" \
  --output=/out/.tmp-basemap.pmtiles \
  --minzoom=0 \
  --maxzoom=14 \
  $PT_FORCE

mv "$TMP_FILE" "$OUT_FILE"

echo "01-vector-tiles: done -> $OUT_FILE"
