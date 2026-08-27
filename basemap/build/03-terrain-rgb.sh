#!/usr/bin/env sh
# 03-terrain-rgb.sh — encode the DEM mosaic as terrain-RGB raster tiles:
#   $BASEMAP_DATA_DIR/dem/dem.vrt  ->  $BASEMAP_OUT_DIR/terrain.pmtiles
#
# The app's MapLibre style reads terrain.pmtiles as a raster-dem source with
# encoding "mapbox", so tiles MUST use the Mapbox terrain-RGB formula:
#   height_m = -10000 + (R*256*256 + G*256 + B) * 0.1
# which is exactly rio rgbify with base -10000 and interval 0.1.
# PNG only: rio-rgbify's webp output is lossy, and any lossy compression
# corrupts the decoded elevations (visible as hillshade "noise").
#
# Zoom range: hillshade does not need the basemap's full z14, and z11 is not a
# compromise — it is the correct match for the source data. MEASURED on the
# first real build: rio-rgbify emits 512x512 PNG tiles, so ground resolution at
# latitude 54 is 156543*cos(lat)/2^(z+1):
#     z10 = 44.9 m/px   z11 = 22.5 m/px   z12 = 11.2 m/px
# GLO-30 is 30 m/px, so z11 already slightly oversamples it and z12 oversamples
# by ~2.7x — pure interpolation of data that does not exist. That interpolation
# is expensive: a z0-12 build measured 15 GB, of which z12 alone was 11.2 GB
# (72,380 tiles averaging 152 KB). z0-11 is ~4.4 GB for the same real detail.
#
# Beware the 256px version of this arithmetic (156543*cos(lat)/2^z), which puts
# the native match at z12 and is what an earlier revision of this file assumed.
# It is wrong here: these tiles are 512px.
#
# MapLibre overzooms a raster-dem source past its maxzoom automatically, so
# hillshade still renders at every viewing zoom.
#
# Requires on the host: podman (see WHY CONTAINERS in the README); everything
# heavy runs inside pinned images. Idempotent: skips finished outputs unless
# FORCE=1.
set -eu

# Fail with a hint (not a cryptic shell error) when config.env has not been
# created from the example yet — same guard as 01-vector-tiles.sh.
if [ ! -f "$(dirname "$0")/../config.env" ]; then
  echo "03-terrain-rgb: config.env not found in basemap/." >&2
  echo "  Create it first: cp config.env.example config.env" >&2
  exit 1
fi
. "$(dirname "$0")/../config.env"

# Relative BASEMAP_* dirs resolve against the basemap/ directory no matter
# where the script is invoked from.
cd "$(dirname "$0")/.."

FORCE="${FORCE:-0}"

# Local rio-rgbify image built from containers/rgbify.Containerfile (no official
# image exists). The tag tracks the pinned rio-rgbify version — bump both
# together. Version pins and how to check for newer ones live in that file.
RGBIFY_IMAGE="localhost/minfinder-rgbify:0.4.0"

# Pinned pmtiles CLI for the mbtiles->pmtiles conversion. To check for a
# newer release see https://hub.docker.com/r/protomaps/go-pmtiles/tags
# (v1.31.2 is the latest as of 2026-08).
PMTILES_IMAGE="docker.io/protomaps/go-pmtiles:v1.31.2"

# Tiny helper image; used only to copy between a bind mount and a podman
# volume on Windows (see the convert step below).
ALPINE_IMAGE="docker.io/library/alpine:3.20"

TERRAIN_MIN_Z=0
TERRAIN_MAX_Z=11
RGBIFY_JOBS="${RGBIFY_JOBS:-4}"   # rio-rgbify worker processes; raise on big machines

DEM_DIR="$BASEMAP_DATA_DIR/dem"
VRT_PATH="$DEM_DIR/dem.vrt"
SCRATCH_DIR="$BASEMAP_DATA_DIR/terrain"
MBTILES_PATH="$SCRATCH_DIR/terrain.mbtiles"
OUT_PATH="$BASEMAP_OUT_DIR/terrain.pmtiles"

if [ ! -f "$VRT_PATH" ]; then
  echo "ERROR: $VRT_PATH not found — run build/02-dem.sh first." >&2
  exit 1
fi

if [ -f "$OUT_PATH" ] && [ "$FORCE" != "1" ]; then
  echo "==> $OUT_PATH already exists — nothing to do (set FORCE=1 to rebuild)."
  exit 0
fi

mkdir -p "$SCRATCH_DIR" "$BASEMAP_OUT_DIR"

# Absolute host path for bind mounts. Under Git Bash (MSYS/MinGW)
# `pwd` yields /c/... which the Windows podman machine may not accept in -v, so use the
# Windows-style path from `pwd -W` there.
abs_host_dir() (
  cd "$1" || exit 1
  case "$(uname -s)" in
    MINGW*|MSYS*) pwd -W ;;
    *) pwd ;;
  esac
)

host_dem_dir=$(abs_host_dir "$DEM_DIR")
host_scratch_dir=$(abs_host_dir "$SCRATCH_DIR")
host_out_dir=$(abs_host_dir "$BASEMAP_OUT_DIR")

echo "==> Building $RGBIFY_IMAGE from containers/rgbify.Containerfile (cached after first run)"
podman build -f containers/rgbify.Containerfile -t "$RGBIFY_IMAGE" containers

# MSYS_NO_PATHCONV=1 stops Git Bash from rewriting container-side paths
# (/dem, /scratch, /out) into Windows paths; it is a harmless no-op on Linux.

# Ownership of bind-mount output is handled by rootless Podman itself: the
# container's root maps to the invoking host user, so files land owned by you.
# Do NOT add --user "$(id -u):$(id -g)" here — under rootless Podman that maps
# into the subuid range and produces files owned by an unmapped high UID,
# which is the opposite of what --user does under Docker.
#
# On an SELinux host (Fedora/RHEL) bind mounts additionally need a :z suffix,
# e.g. -v "$DATA_ABS:/data:z". Omitted by default: relabelling the multi-GB
# DEM directory is slow, and Podman on Windows/WSL has no SELinux.

if [ -f "$MBTILES_PATH" ] && [ "$FORCE" != "1" ]; then
  echo "==> $MBTILES_PATH already exists — skipping rio rgbify."
else
  # Write to a staging name and mv on success: rio-rgbify streams tiles into
  # the sqlite file as it goes, so an interrupted run leaves a PARTIAL mbtiles
  # that a later run must not mistake for a finished one. The staging name
  # keeps the .mbtiles extension because rio-rgbify dispatches on it.
  rm -f "$MBTILES_PATH" "$SCRATCH_DIR/terrain.part.mbtiles"
  echo "==> Encoding terrain-RGB tiles z${TERRAIN_MIN_Z}-${TERRAIN_MAX_Z} from $VRT_PATH (this is the slow step)"
  # /dem is mounted read-only; dem.vrt references its source tiles with paths
  # relative to itself, so it resolves at any mount point.
  MSYS_NO_PATHCONV=1 podman run --rm \
    -v "$host_dem_dir:/dem:ro" \
    -v "$host_scratch_dir:/scratch" \
    "$RGBIFY_IMAGE" \
    rio rgbify \
      -b -10000 \
      -i 0.1 \
      --min-z "$TERRAIN_MIN_Z" \
      --max-z "$TERRAIN_MAX_Z" \
      --format png \
      -j "$RGBIFY_JOBS" \
      /dem/dem.vrt /scratch/terrain.part.mbtiles
  mv "$SCRATCH_DIR/terrain.part.mbtiles" "$MBTILES_PATH"
fi

echo "==> Converting $MBTILES_PATH -> $OUT_PATH ($PMTILES_IMAGE)"
# Metadata compatibility (verified against rio-rgbify 0.4.0 mbtiler.py and
# go-pmtiles v1.31.2 convert.go): rio-rgbify writes the `format`=png metadata
# row that pmtiles needs for the tile type; it writes no `bounds`/`minzoom`/
# `maxzoom`, which is fine — convert derives the zoom range from the tile ids
# and falls back to whole-world bounds (harmless for a raster-dem source).
# Default deduplication is kept on: flat ocean tiles are byte-identical and
# dedupe shrinks them to a single copy.
# convert streams straight into its output file (os.Create truncates, so it
# overwrites), meaning an interrupted run leaves a partial archive — stage to
# a .part name and mv on success so the exists-check above never trusts one.
#
# WINDOWS PERFORMANCE TRAP (measured, not theoretical). On Windows the host
# bind mount is a 9p/drvfs bridge into the WSL VM. `convert` does many small
# random writes into a growing archive, and every one pays that crossing, so
# throughput DECAYS as the file grows: a real run fell 4 -> 3 -> 2 tiles/s over
# four tiles, ETA climbing 1h14m -> 2h55m for 24,515 tiles. The identical
# convert on the VM's native ext4 (a named volume) took 2m59s -- ~60x faster --
# and the two sequential copies either side cost ~55s combined. Sequential I/O
# over the bridge runs at ~250 MB/s; only random I/O collapses.
# On Linux the bind mount IS the native filesystem, so convert in place.
rm -f "$OUT_PATH" "$BASEMAP_OUT_DIR/terrain.part.pmtiles"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    PM_VOL=minfinder-pmtiles-scratch
    podman volume create "$PM_VOL" >/dev/null 2>&1 || true
    echo "    Windows host: staging convert on VM-native ext4 (volume $PM_VOL)"
    MSYS_NO_PATHCONV=1 podman run --rm       -v "$host_scratch_dir:/scratch:ro" -v "$PM_VOL:/vol"       "$ALPINE_IMAGE" cp /scratch/terrain.mbtiles /vol/terrain.mbtiles
    MSYS_NO_PATHCONV=1 podman run --rm -v "$PM_VOL:/vol"       "$PMTILES_IMAGE" convert --quiet /vol/terrain.mbtiles /vol/terrain.pmtiles
    MSYS_NO_PATHCONV=1 podman run --rm       -v "$PM_VOL:/vol:ro" -v "$host_out_dir:/out"       "$ALPINE_IMAGE" cp /vol/terrain.pmtiles /out/terrain.part.pmtiles
    # Free the ~10 GB of scratch the volume now holds.
    MSYS_NO_PATHCONV=1 podman run --rm -v "$PM_VOL:/vol"       "$ALPINE_IMAGE" rm -f /vol/terrain.mbtiles /vol/terrain.pmtiles
    ;;
  *)
    podman run --rm       -v "$host_scratch_dir:/scratch:ro"       -v "$host_out_dir:/out"       "$PMTILES_IMAGE"       convert /scratch/terrain.mbtiles /out/terrain.part.pmtiles
    ;;
esac
mv "$BASEMAP_OUT_DIR/terrain.part.pmtiles" "$OUT_PATH"

echo "==> Wrote $OUT_PATH"
