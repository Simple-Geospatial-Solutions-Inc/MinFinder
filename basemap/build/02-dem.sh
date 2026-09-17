#!/usr/bin/env sh
# 02-dem.sh — build $BASEMAP_DATA_DIR/dem/dem.vrt, the elevation input for
# 03-terrain-rgb.sh (hillshade) and 04-contours.sh.
#
# TWO SOURCES, LAYERED. The mosaic is NRCan's MRDEM-30 bare-earth terrain model
# over Canada, with Copernicus GLO-30 underneath as a fallback.
#
#   MRDEM-30 DTM   Natural Resources Canada, OGL-Canada 2.0, 30 m.
#                  https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/
#                  A TERRAIN model: bare ground, with LiDAR substituted wherever
#                  a LiDAR project exists and a forest-removal model applied
#                  elsewhere. Canada only.
#   GLO-30         Copernicus, 30 m, global. A SURFACE model — it measures the
#                  top of the forest canopy. Kept as the base layer purely to
#                  fill in south of 49 N (Washington/Idaho/Montana, where MRDEM
#                  has no data) and any MRDEM voids.
#
# WHY THE SWITCH (measured 2026-08-27, three sites, hillshades compared visually
# alongside terrain-ruggedness figures — see docs/dem-decision.md):
#   - Inside BC's LiDAR footprint the bare-earth step removes ~42% of the
#     high-frequency energy while slope variation holds. That energy was canopy;
#     underneath it is landform — terraces, meander scars, glacial fluting —
#     that the surface model simply does not show.
#   - Outside it, the removal is a statistical model and is texture-neutral
#     (+0.7% ruggedness at Babine, -1.9% in the alpine Golden Triangle, where
#     mean canopy is 19 cm and there is nothing to remove).
#   - The biggest win is CONTOURS, not hillshade. 04-contours.sh cuts at a 20 m
#     interval, and canopy runs 7-11 m deep in forested BC — so until now every
#     contour in treed country was drawn on treetops.
#
# THE 49 N SEAM is a known, accepted artifact. Where the bare-earth MRDEM meets
# the canopy-top GLO-30 at the international border, elevations step by roughly
# the canopy height, so hillshade and contours are discontinuous along that
# line. It sits outside the app's data domain (MINFILE is BC-only) and the
# alternative — a hard nodata edge at the border — is worse.
#
# SAME GRID AS BEFORE, DELIBERATELY. MRDEM is warped onto the exact geotransform
# the GLO-30 mosaic already used rather than onto a fresh grid of its own. That
# keeps this a pure source change: tile counts, contour density, the terrain-RGB
# zoom arithmetic and the measured byte model in lib/tileCache.ts all stay
# valid. Changing the grid at the same time would confound the two, which is the
# exact mistake the source comparison itself had to correct for.
#
# Vertical datum changes with the source: GLO-30 is EGM2008, MRDEM is CGVD2013
# (the official Canadian datum, so this is a correctness gain). Measured offset
# across the three test sites was -1 m to +2 m — well inside a 20 m contour
# interval, but elevation labels do shift slightly from previous builds.
#
# Requires on the host: curl, podman, and python3/python. GDAL runs in a pinned image.
set -eu

# Fail with a hint (not a cryptic shell error) when config.env has not been
# created from the example yet — same guard as 01-vector-tiles.sh.
if [ ! -f "$(dirname "$0")/../config.env" ]; then
  echo "02-dem: config.env not found in basemap/." >&2
  echo "  Create it first: cp config.env.example config.env" >&2
  exit 1
fi
. "$(dirname "$0")/../config.env"

# Relative BASEMAP_* dirs are resolved against the basemap/ directory so the
# result is the same no matter where this script is invoked from.
cd "$(dirname "$0")/.."

FORCE="${FORCE:-0}"

# Pinned GDAL image. alpine-NORMAL rather than alpine-small: the MRDEM step
# reads a remote COG through /vsicurl, and the small image is built without the
# network virtual file systems. To check for a newer release, see
# https://github.com/OSGeo/gdal/pkgs/container/gdal (latest stable as of
# 2026-08 is 3.13.3).
GDAL_IMAGE="ghcr.io/osgeo/gdal:alpine-normal-3.13.3"

DEM_BASE_URL="https://copernicus-dem-30m.s3.amazonaws.com"
MRDEM_URL="https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif"
DEM_DIR="$BASEMAP_DATA_DIR/dem"
TILE_DIR="$DEM_DIR/tiles"
GLO_VRT="$DEM_DIR/glo30.vrt"
MRDEM_TIF="$DEM_DIR/mrdem-dtm-bc.tif"
VRT_PATH="$DEM_DIR/dem.vrt"
LIST_PATH="$DEM_DIR/tiles.txt"

PY=""
for c in python3 python py; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c "pass" >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "02-dem: no working python found." >&2; exit 1; }

mkdir -p "$TILE_DIR"

# Absolute host path for the bind mount. Under Git Bash (MSYS/MinGW) `pwd`
# yields /c/... which the Windows podman machine may not accept in -v, so use
# the Windows-style path from `pwd -W` there.
host_dem_dir=$(cd "$DEM_DIR" && pwd)
case "$(uname -s)" in
  MINGW*|MSYS*) host_dem_dir=$(cd "$DEM_DIR" && pwd -W) ;;
esac

# Ownership of bind-mount output is handled by rootless Podman itself: the
# container's root maps to the invoking host user, so files land owned by you.
# Do NOT add --user "$(id -u):$(id -g)" here — under rootless Podman that maps
# into the subuid range and produces files owned by an unmapped high UID,
# which is the opposite of what --user does under Docker.
#
# On an SELinux host (Fedora/RHEL) bind mounts additionally need a :z suffix,
# e.g. -v "$DATA_ABS:/data:z". Omitted by default: relabelling the multi-GB
# DEM directory is slow, and Podman on Windows/WSL has no SELinux.
#
# MSYS_NO_PATHCONV=1 stops Git Bash from rewriting the container-side /data
# paths into Windows paths; it is a harmless no-op on Linux.
gdal() {
  MSYS_NO_PATHCONV=1 podman run --rm \
    -e GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR \
    -v "$host_dem_dir:/data" \
    "$GDAL_IMAGE" "$@"
}

# --- 1. Copernicus GLO-30 (fallback layer) ----------------------------------

total_cells=$(( (DEM_MAX_LAT - DEM_MIN_LAT + 1) * (DEM_MAX_LON_W - DEM_MIN_LON_W + 1) ))
echo "==> Fetching Copernicus GLO-30 DEM for N${DEM_MIN_LAT}..N${DEM_MAX_LAT} / W${DEM_MIN_LON_W}..W${DEM_MAX_LON_W}"
echo "    ${total_cells} candidate cells (~246 exist for BC, ~6 GB); missing ocean cells return 404 and are skipped."

checked=0
downloaded=0
skipped=0
missing=0
total_bytes=0

lat=$DEM_MIN_LAT
while [ "$lat" -le "$DEM_MAX_LAT" ]; do
  lon=$DEM_MIN_LON_W
  while [ "$lon" -le "$DEM_MAX_LON_W" ]; do
    checked=$((checked + 1))
    # Key format (verified live): lat zero-padded to 2 digits, lon to 3.
    # e.g. Copernicus_DSM_COG_10_N54_00_W126_00_DEM/Copernicus_DSM_COG_10_N54_00_W126_00_DEM.tif
    name=$(printf 'Copernicus_DSM_COG_10_N%02d_00_W%03d_00_DEM' "$lat" "$lon")
    dest="$TILE_DIR/$name.tif"

    if [ -s "$dest" ] && [ "$FORCE" != "1" ]; then
      # Resumable: a non-empty file on disk is treated as complete.
      skipped=$((skipped + 1))
      lon=$((lon + 1))
      continue
    fi

    url="$DEM_BASE_URL/$name/$name.tif"
    tmp="$dest.part"
    # No -f: we read the HTTP status ourselves so 404 (cell does not exist)
    # can be told apart from real failures. --retry covers transient
    # timeouts/5xx. Without -f curl writes the S3 error XML to the output
    # file on 404, hence the rm below.
    http_code=$(curl -sS --retry 3 --retry-delay 2 -o "$tmp" -w '%{http_code}' "$url") || http_code=000

    if [ "$http_code" = "200" ]; then
      mv "$tmp" "$dest"
      bytes=$(wc -c < "$dest" | tr -d ' ')
      downloaded=$((downloaded + 1))
      total_bytes=$((total_bytes + bytes))
      echo "[$checked/$total_cells] got  $name.tif ($bytes bytes; ${downloaded} downloaded, ${total_bytes} bytes total)"
    elif [ "$http_code" = "404" ]; then
      rm -f "$tmp"
      missing=$((missing + 1))
      echo "[$checked/$total_cells] 404  $name (ocean cell, skipping)"
    else
      rm -f "$tmp"
      echo "ERROR: $url returned HTTP $http_code — aborting (rerun to resume)" >&2
      exit 1
    fi
    lon=$((lon + 1))
  done
  lat=$((lat + 1))
done

echo "==> Download complete: $downloaded fetched ($total_bytes bytes), $skipped already on disk, $missing missing (404)."

# --- 2. GLO-30 mosaic, which also defines the reference grid -----------------

if [ ! -f "$GLO_VRT" ] || [ "$FORCE" = "1" ] || [ "$downloaded" -gt 0 ]; then
  echo "==> Building $GLO_VRT with gdalbuildvrt"
  # The list file holds container-side paths (/data/...) because gdalbuildvrt
  # runs inside the container. ~246 inputs, so -input_file_list is used instead
  # of a giant argv. Because the inputs and the VRT share the /data prefix,
  # gdalbuildvrt records the tile paths relative to the VRT (relativeToVRT=1),
  # so the resulting VRT also resolves correctly on the host.
  : > "$LIST_PATH"
  found_any=0
  for tif in "$TILE_DIR"/*.tif; do
    [ -e "$tif" ] || continue   # glob did not match anything
    found_any=1
    echo "/data/tiles/$(basename "$tif")" >> "$LIST_PATH"
  done
  if [ "$found_any" != "1" ]; then
    echo "ERROR: no DEM tiles in $TILE_DIR — nothing to mosaic." >&2
    exit 1
  fi
  gdal gdalbuildvrt -input_file_list /data/tiles.txt /data/glo30.vrt
  echo "    $(wc -l < "$LIST_PATH" | tr -d ' ') tiles."
fi

# Read the reference grid straight out of the GLO-30 mosaic rather than
# hardcoding it, so the two can never drift apart if the bbox in config.env
# changes. A VRT is plain XML, so no GDAL round-trip is needed for this.
eval "$("$PY" - "$GLO_VRT" <<'PYEOF'
import re, sys
# newline=\n is REQUIRED here, not tidiness. Windows Python defaults
# stdout to text mode and rewrites every line ending, so each assignment below
# would reach the shell with a trailing carriage return: GRID_PX would be
# "0.00040092217723796682<CR>" and gdalwarp would reject it. Worse, that CR
# rewinds the terminal line, so GDAL prints its error and immediately
# overwrites it -- the script exits 1 having apparently printed nothing, which
# is a genuinely hard failure to diagnose. Cost an hour the first time.
sys.stdout.reconfigure(newline="\n")
xml = open(sys.argv[1], encoding="utf-8").read()
w = int(re.search(r'rasterXSize="(\d+)"', xml).group(1))
h = int(re.search(r'rasterYSize="(\d+)"', xml).group(1))
gt = [float(v) for v in re.search(r"<GeoTransform>(.*?)</GeoTransform>", xml, re.S).group(1).split(",")]
# GeoTransform is (originX, pxW, rotX, originY, rotY, pxH); pxH is negative.
print(f"GRID_MINX={gt[0]!r}")
print(f"GRID_MAXY={gt[3]!r}")
print(f"GRID_MAXX={gt[0] + w * gt[1]!r}")
print(f"GRID_MINY={gt[3] + h * gt[5]!r}")
print(f"GRID_PX={gt[1]!r}")
print(f"GRID_PY={abs(gt[5])!r}")
print(f"GRID_W={w}")
print(f"GRID_H={h}")
PYEOF
)"

# --- 3. MRDEM-30 DTM, warped onto that grid ---------------------------------

if [ -s "$MRDEM_TIF" ] && [ "$FORCE" != "1" ]; then
  echo "==> $MRDEM_TIF already exists — skipping (FORCE=1 to re-fetch)."
else
  echo "==> Warping MRDEM-30 DTM onto the reference grid (${GRID_W}x${GRID_H})"
  echo "    bbox $GRID_MINX $GRID_MINY $GRID_MAXX $GRID_MAXY"
  echo "    Reads a 78 GB remote COG windowed to BC (~7 GB over the wire) and"
  echo "    reprojects EPSG:3979 -> EPSG:4326. Expect this to take a while."
  rm -f "$MRDEM_TIF.part"
  # -r bilinear, not cubic: cubic overshoots at sharp breaks in elevation and
  # puts ringing artefacts along cliff edges, which then show up as spurious
  # closed contours in 04-contours.sh.
  #
  # NoData is carried through (-32767, MRDEM's own) rather than filled. That is
  # what lets the final VRT fall through to GLO-30 south of 49 N: gdalbuildvrt
  # emits a <NODATA> element for a source that declares one, and skips those
  # pixels instead of painting them over the layer beneath.
  gdal gdalwarp -overwrite -multi \
    --config GDAL_CACHEMAX 2048 \
    --config VSI_CACHE TRUE --config VSI_CACHE_SIZE 268435456 \
    -t_srs EPSG:4326 \
    -te "$GRID_MINX" "$GRID_MINY" "$GRID_MAXX" "$GRID_MAXY" \
    -tr "$GRID_PX" "$GRID_PY" \
    -r bilinear -ot Float32 -srcnodata -32767 -dstnodata -32767 \
    -co TILED=YES -co COMPRESS=DEFLATE -co PREDICTOR=3 \
    -co BIGTIFF=YES -co NUM_THREADS=ALL_CPUS \
    -wo NUM_THREADS=ALL_CPUS \
    "/vsicurl/$MRDEM_URL" /data/mrdem-dtm-bc.tif.part
  mv "$MRDEM_TIF.part" "$MRDEM_TIF"
  echo "    wrote $MRDEM_TIF ($(wc -c < "$MRDEM_TIF" | tr -d ' ') bytes)"
fi

# --- 4. Final mosaic: MRDEM over GLO-30 -------------------------------------

echo "==> Building $VRT_PATH (MRDEM-30 DTM over GLO-30)"
# Source ORDER IS THE POINT: gdalbuildvrt paints later sources over earlier
# ones, so GLO-30 goes first and MRDEM second. MRDEM therefore wins everywhere
# it has data, and GLO-30 shows through only where MRDEM is nodata.
gdal gdalbuildvrt -overwrite /data/dem.vrt /data/glo30.vrt /data/mrdem-dtm-bc.tif

echo "==> Wrote $VRT_PATH"
echo "    Attribution required: Contains information licensed under the"
echo "    Open Government Licence – Canada (MRDEM-30, Natural Resources Canada)"
echo "    and modified Copernicus DEM data."
