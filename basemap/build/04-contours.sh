#!/usr/bin/env sh
# 04-contours.sh — derive vector contour lines from the DEM mosaic:
#   $BASEMAP_DATA_DIR/dem/dem.vrt  ->  $BASEMAP_OUT_DIR/contours.pmtiles
#
# Pipeline (all inside pinned container images):
#   1. gdal_contour  — lines every CONTOUR_INTERVAL_M metres, elevation stored
#                      in attribute "elev"; GeoPackage intermediate (binary,
#                      far smaller than GeoJSON for millions of lines).
#   2. ogr2ogr       — adds idx=1/0 marking every CONTOUR_INDEX_M-metre "index"
#                      contour, so the style can draw index lines heavier;
#                      converts to FlatGeobuf, which tippecanoe reads natively.
#   3. tippecanoe    — tiles to PMTiles directly (layer "contours", z9-14).
#
# Tile attributes: elev (whole metres, for labelling), idx (1 = index contour,
# 0 = minor contour).
#
# Requires on the host: podman. Idempotent: skips finished outputs unless FORCE=1.
set -eu

# Fail with a hint (not a cryptic shell error) when config.env has not been
# created from the example yet — same guard as 01-vector-tiles.sh.
if [ ! -f "$(dirname "$0")/../config.env" ]; then
  echo "04-contours: config.env not found in basemap/." >&2
  echo "  Create it first: cp config.env.example config.env" >&2
  exit 1
fi
. "$(dirname "$0")/../config.env"

# Relative BASEMAP_* dirs resolve against the basemap/ directory no matter
# where the script is invoked from.
cd "$(dirname "$0")/.."

FORCE="${FORCE:-0}"

# Pinned GDAL image. alpine-normal (not -small) so the GPKG driver and the
# SQLite SQL dialect used below are certainly built in. To check for a newer
# release see https://github.com/OSGeo/gdal/pkgs/container/gdal — tags follow
# alpine-normal-<gdal version>; latest stable as of 2026-08 is 3.13.3.
GDAL_IMAGE="ghcr.io/osgeo/gdal:alpine-normal-3.13.3"

# Pinned tippecanoe image. Felt publishes no official image; this one is
# auto-rebuilt from upstream felt/tippecanoe releases and tagged to match
# them (https://github.com/openwatersio/tippecanoe). To check for a newer
# release see https://github.com/felt/tippecanoe/releases — 2.79.0 is the
# latest as of 2026-08.
TIPPECANOE_IMAGE="ghcr.io/openwatersio/tippecanoe:2.79.0"

# Tiny helper image; used only to copy between a podman volume and the
# bind mount on Windows (see the tippecanoe step below).
ALPINE_IMAGE="docker.io/library/alpine:3.20"

# Contours are useless zoomed way out and extremely dense zoomed in: index
# contours start at CONTOUR_MIN_Z; minor contours join at MINOR_MIN_Z (see the
# tippecanoe feature filter below).
#
# CONTOUR_MIN_Z was 9, which produced an archive that ADVERTISED z9 and served
# 204 No Content for every tile below z12 -- --drop-densest-as-needed discarded
# the lot, since 20 m contours over BC relief are a solid mass at those zooms.
# A dishonest minzoom is not free: mbgl believes the TileJSON and requests three
# whole zoom levels of empty tiles for every offline pack. Nothing rendered
# below z12 before this change and nothing renders below it now; the archive
# just stops claiming otherwise. Keep this in step with the `contours` source
# minzoom in 06-style.sh.
CONTOUR_MIN_Z=12
CONTOUR_MAX_Z=14
MINOR_MIN_Z=12

DEM_DIR="$BASEMAP_DATA_DIR/dem"
VRT_PATH="$DEM_DIR/dem.vrt"
SCRATCH_DIR="$BASEMAP_DATA_DIR/contours"
GPKG_PATH="$SCRATCH_DIR/contours.gpkg"
FGB_PATH="$SCRATCH_DIR/contours.fgb"
OUT_PATH="$BASEMAP_OUT_DIR/contours.pmtiles"

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

# --- 1. gdal_contour: DEM -> contour lines every CONTOUR_INTERVAL_M metres --
if [ -f "$GPKG_PATH" ] && [ "$FORCE" != "1" ]; then
  echo "==> $GPKG_PATH already exists — skipping gdal_contour."
else
  # Stage to .part.gpkg and mv on success: gdal_contour streams features into
  # the GeoPackage, so an interrupted run leaves a partial file that a later
  # run must not mistake for a finished one. (The staging name keeps the .gpkg
  # extension so the GPKG driver stays happy.)
  rm -f "$GPKG_PATH" "$SCRATCH_DIR/contours.part.gpkg"
  echo "==> gdal_contour: ${CONTOUR_INTERVAL_M} m contours from $VRT_PATH (slow; BC is big)"
  # -i: contour interval in DEM units (metres). -a: write each line's
  # elevation into attribute "elev". -nln: fix the layer name so the SQL in
  # step 2 can rely on it. Note: GLO-30 is a DSM with ocean at 0 m and no
  # nodata, so a dense 0 m contour along the coastline is expected.
  MSYS_NO_PATHCONV=1 podman run --rm \
    -v "$host_dem_dir:/dem:ro" \
    -v "$host_scratch_dir:/scratch" \
    "$GDAL_IMAGE" \
    gdal_contour \
      -i "$CONTOUR_INTERVAL_M" \
      -a elev \
      -nln contour \
      -f GPKG \
      /dem/dem.vrt /scratch/contours.part.gpkg
  mv "$SCRATCH_DIR/contours.part.gpkg" "$GPKG_PATH"
fi

# --- 2. ogr2ogr: tag index contours, convert to FlatGeobuf -----------------
if [ -f "$FGB_PATH" ] && [ "$FORCE" != "1" ]; then
  echo "==> $FGB_PATH already exists — skipping ogr2ogr."
else
  # Same staging pattern as step 1: never leave a partial .fgb under the
  # final name after an interrupted run.
  rm -f "$FGB_PATH" "$SCRATCH_DIR/contours.part.fgb"
  echo "==> ogr2ogr: tagging every ${CONTOUR_INDEX_M} m line with idx=1, writing FlatGeobuf"
  # SQLite dialect so we can compute idx with the % (modulo) operator; the
  # comparison yields integer 1/0. "geom" is the default geometry column name
  # in a GDAL-created GeoPackage. elev is cast to whole metres — the interval
  # is integral, and integers tile smaller and label cleaner than floats.
  MSYS_NO_PATHCONV=1 podman run --rm \
    -v "$host_scratch_dir:/scratch" \
    "$GDAL_IMAGE" \
    ogr2ogr \
      -f FlatGeobuf \
      /scratch/contours.part.fgb /scratch/contours.gpkg \
      -nln contours \
      -dialect SQLite \
      -sql "SELECT geom, CAST(elev AS INTEGER) AS elev, ((CAST(elev AS INTEGER) % $CONTOUR_INDEX_M) = 0) AS idx FROM contour"
  mv "$SCRATCH_DIR/contours.part.fgb" "$FGB_PATH"
fi

# --- 3. tippecanoe: FlatGeobuf -> contours.pmtiles --------------------------
echo "==> tippecanoe: tiling z${CONTOUR_MIN_Z}-${CONTOUR_MAX_Z} -> $OUT_PATH"
# Contours are extremely dense, and by default tippecanoe silently thins tiles
# that blow its 200k-feature / 500KB limits — which severs contour lines. So:
#   --no-feature-limit / --no-tile-size-limit  guarantee nothing is dropped;
#   -j feature filter keeps low-zoom tiles sane INTENTIONALLY instead: below
#      z$MINOR_MIN_Z only index contours (idx=1) are tiled, from z$MINOR_MIN_Z
#      every contour is ("$zoom" is evaluated per tile at tiling time);
#   -y whitelists elev+idx so no stray attributes bloat the tiles;
#   -f overwrites a stale output from an interrupted run.
# tippecanoe infers PMTiles output from the .pmtiles extension — no separate
# mbtiles->pmtiles conversion step is needed here. Output is staged to a
# -n names the tileset explicitly. Without it tippecanoe derives the TileJSON
# `name` and `description` from the OUTPUT PATH -- which here is the staging
# name -- so contours.json shipped announcing itself as
# "/out/contours.part.pmtiles". Cosmetic, but it is the string clients read.
# .part.pmtiles name (still ending in .pmtiles so tippecanoe picks the PMTiles
# writer) and mv'd on success, so an interrupted run can never leave a partial
# archive under $OUT_PATH for the exists-check at the top to trust.
FILTER='{ "contours": [ "any", [ ">=", "$zoom", '"$MINOR_MIN_Z"' ], [ "==", "idx", 1 ] ] }'
#
# WINDOWS PERFORMANCE TRAP -- same one documented in 03-terrain-rgb.sh, and it
# bites here too. tippecanoe writes the PMTiles archive INCREMENTALLY, not once
# at the end, so on Windows every write crosses the 9p/drvfs bridge into the WSL
# VM and throughput decays as the archive grows. Measured on a real run:
#   1.43 MB/s -> 0.93 -> 0.45, progress falling to 0.09%/min at z14.
# Only the OUTPUT needs to move: the .fgb input is read sequentially, which the
# bridge serves at ~250 MB/s, and tippecanoe's own temp files already live on
# the container filesystem. So keep /scratch bind-mounted and put /out on a
# podman volume, then copy the finished archive across in one sequential pass.
rm -f "$OUT_PATH" "$BASEMAP_OUT_DIR/contours.part.pmtiles"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    TC_VOL=minfinder-tippecanoe-scratch
    podman volume create "$TC_VOL" >/dev/null 2>&1 || true
    echo "    Windows host: writing archive to VM-native ext4 (volume $TC_VOL)"
    MSYS_NO_PATHCONV=1 podman run --rm \
      -v "$host_scratch_dir:/scratch:ro" \
      -v "$TC_VOL:/out" \
      "$TIPPECANOE_IMAGE" \
      tippecanoe \
        -o /out/contours.part.pmtiles \
        -f \
        -l contours \
        -n contours \
        -Z "$CONTOUR_MIN_Z" \
        -z "$CONTOUR_MAX_Z" \
        -y elev \
        -y idx \
        --no-feature-limit \
        --no-tile-size-limit \
        -j "$FILTER" \
        /scratch/contours.fgb
    # One sequential copy across the bridge (~250 MB/s), not millions of
    # random writes.
    MSYS_NO_PATHCONV=1 podman run --rm \
      -v "$TC_VOL:/vol:ro" -v "$host_out_dir:/out" \
      "$ALPINE_IMAGE" cp /vol/contours.part.pmtiles /out/contours.part.pmtiles
    # Free the volume; it is pure scratch.
    MSYS_NO_PATHCONV=1 podman run --rm -v "$TC_VOL:/vol" \
      "$ALPINE_IMAGE" rm -f /vol/contours.part.pmtiles
    ;;
  *)
  MSYS_NO_PATHCONV=1 podman run --rm \
    -v "$host_scratch_dir:/scratch:ro" \
    -v "$host_out_dir:/out" \
    "$TIPPECANOE_IMAGE" \
    tippecanoe \
      -o /out/contours.part.pmtiles \
      -f \
      -l contours \
      -n contours \
      -Z "$CONTOUR_MIN_Z" \
      -z "$CONTOUR_MAX_Z" \
      -y elev \
      -y idx \
      --no-feature-limit \
      --no-tile-size-limit \
      -j "$FILTER" \
      /scratch/contours.fgb
    ;;
esac
mv "$BASEMAP_OUT_DIR/contours.part.pmtiles" "$OUT_PATH"

echo "==> Wrote $OUT_PATH"
