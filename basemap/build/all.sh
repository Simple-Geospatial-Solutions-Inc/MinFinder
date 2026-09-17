#!/usr/bin/env sh
# all.sh — run the whole basemap pipeline in order:
#   01-vector-tiles.sh  ->  out/basemap.pmtiles
#   02-dem.sh           ->  data/dem/dem.vrt (intermediate)
#   03-terrain-rgb.sh   ->  out/terrain.pmtiles
#   04-contours.sh      ->  out/contours.pmtiles
#   05-glyphs.sh        ->  out/glyphs/, out/sprite*
#
# Each step is idempotent and skips itself if its output already exists, so
# re-running all.sh after a failure resumes where it left off. `set -e` makes
# the first failing step abort the whole run.
#
# FORCE=1 ./all.sh rebuilds EVERYTHING — including re-downloading ~6 GB of
# DEM tiles in step 02. For the routine monthly OSM refresh you almost always
# want to force only step 01 instead:  FORCE=1 build/01-vector-tiles.sh
# (see basemap/README.md).
#
# Rough budget for a full first run (4-core machine, decent connection):
#   step  wall clock       disk
#   01    ~30-90 min       ~4 GB scratch (OSM extract + helper data), ~2-3 GB out
#   02    ~15-60 min       ~6 GB scratch (246 DEM tiles; time is bandwidth-bound)
#   03    ~1-4 h           ~5-10 GB scratch (mbtiles), ~3-6 GB out   <- slowest step
#   04    ~1-3 h           ~15-30 GB scratch (gpkg + fgb), ~1-2 GB out
#   05    ~1 min           ~2 MB out
#   total: an afternoon, ~50-60 GB free disk to be safe.
set -eu

BUILD_DIR=$(cd "$(dirname "$0")" && pwd)

# Fail with a hint (not a cryptic error from the first step) when config.env
# has not been created from the example yet.
if [ ! -f "$BUILD_DIR/../config.env" ]; then
  echo "all: config.env not found in basemap/." >&2
  echo "  Create it first: cp config.env.example config.env" >&2
  exit 1
fi

# FORCE (if set) is exported so every child step sees it.
FORCE="${FORCE:-0}"
export FORCE

started=$(date)
echo "==> basemap pipeline starting (FORCE=$FORCE) at $started"

# Invoked via `sh` rather than executed: the repo is checked out on Windows
# with core.filemode=false, so the executable bit is not guaranteed.
for step in 01-vector-tiles 02-dem 03-terrain-rgb 04-contours 05-glyphs; do
  echo ""
  echo "=====================================================================>"
  echo "==> STEP $step"
  echo "=====================================================================>"
  sh "$BUILD_DIR/$step.sh"
done

echo ""
echo "==> basemap pipeline complete."
echo "    started:  $started"
echo "    finished: $(date)"
echo "    Publishable artifacts are in \$BASEMAP_OUT_DIR (see config.env)."
echo "    Next: serve/deploy.sh ships them to the VPS."
