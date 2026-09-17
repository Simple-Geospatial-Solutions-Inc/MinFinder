#!/usr/bin/env sh
# 07-bcdata.sh — openly-licensed BC government layers -> two PMTiles archives:
#   $BASEMAP_OUT_DIR/roads.pmtiles    z9-14  resource_roads, og_roads, rec_lines
#   $BASEMAP_OUT_DIR/context.pmtiles  z5-14  parks, bedrock
#
# WHY THIS EXISTS. OpenStreetMap covers BC's highways well and its backcountry
# badly. Measured over ~1,000 km2 near Smithers: 427 km of ACTIVE forest road in
# the provincial data, of which only 86 km (20%) had any OSM way within 30 m.
# Four-fifths of BC's resource roads are not in OSM -- and for a minerals app
# those are the roads that decide whether a showing is reachable. Widening the
# match tolerance to 60 m moved the result under one point, so that is a real
# coverage gap, not an artifact of the matching threshold.
#
# TWO ARCHIVES, NOT ONE, because the zoom ranges differ by an order of
# magnitude in cost. Roads and trails are pointless below z9 and there are
# ~229k of them; parks and bedrock are ~3.6k features that must be visible when
# zoomed out to plan a trip. Tiling both z5-14 would waste most of the work.
#
# LICENCE (checked per dataset, not assumed). Every layer below is license_id=2,
# "Open Government Licence - British Columbia", which permits copying,
# modifying and redistributing with attribution -- what tiling into an offline
# pack requires.
#
# BEWARE THE NEAR-MISS DATASETS. The catalogue publishes layers with nearly
# identical names and OPPOSITE rights:
#   Forest Tenure Road SEGMENT Lines        -> license_id 2   USABLE
#   Forest Tenure Road SECTION Lines        -> license_id 22  NOT USABLE
#   Digital Road Atlas (all variants)       -> license_id 22  NOT USABLE
#   Oil and Gas Road Segment PERMITS        -> license_id 2   USABLE
#   Oil and Gas Road Segment APPLICATIONS   -> license_id 51  NOT USABLE
# The DRA is the authoritative provincial road network and is the obvious thing
# to reach for; it cannot be used. ALWAYS check before adding a layer:
#   curl -s "https://catalogue.data.gov.bc.ca/api/3/action/package_show?id=<slug>" \
#     | grep -o '"license_id": "[^"]*"'
#
# DELIBERATELY NOT INCLUDED:
#   Freshwater Atlas Stream Network (OGL-BC, 4,907,440 features) -- a multi-hour
#     download and a very large tileset. OSM already carries major watercourses.
#     Revisit if stream detail proves to matter more than the cost.
#   MTA Mineral/Placer/Coal Tenure (OGL-BC) -- claims are staked and lapse
#     DAILY. Baking them into a tileset rebuilt monthly would show stale claim
#     boundaries to someone deciding where to stake, which is worse than showing
#     nothing. If claims are wanted, fetch them live in the app.
#
# Requires on the host: curl, podman, and python3/python.
set -eu

if [ ! -f "$(dirname "$0")/../config.env" ]; then
  echo "07-bcdata: config.env not found in basemap/." >&2
  echo "  Create it first: cp config.env.example config.env" >&2
  exit 1
fi
BASEMAP_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$BASEMAP_DIR"
. "$BASEMAP_DIR/config.env"

FORCE="${FORCE:-0}"
SCRATCH_DIR="$BASEMAP_DATA_DIR/bcdata"
ROADS_OUT="$BASEMAP_OUT_DIR/roads.pmtiles"
CONTEXT_OUT="$BASEMAP_OUT_DIR/context.pmtiles"

TIPPECANOE_IMAGE="ghcr.io/openwatersio/tippecanoe:2.79.0"
ALPINE_IMAGE="docker.io/library/alpine:3.20"
PAGE=10000

# layer_key | BCGW object name | CQL filter ('-' for none) | kept attributes
#
# resource_roads: ACTIVE tenure only. RETIRED roads (~30% of the dataset) are
#   deactivated, often deconstructed or bridged-out; drawing them would route
#   someone down a road that no longer exists.
# og_roads: northeast BC, where forest tenure does not reach.
# rec_lines: sanctioned recreation trails -- foot access to showings.
# parks: where you cannot stake. Negative space matters as much as roads.
# bedrock: BC Geological Survey mapping. Only 2,668 polygons but the single
#   most decision-relevant layer for prospecting.
LAYERS='
resource_roads|WHSE_FOREST_TENURE.FTEN_ROAD_SEGMENT_LINES_SVW|LIFE_CYCLE_STATUS_CODE='"'"'ACTIVE'"'"'|MAP_LABEL,FOREST_FILE_ID,ROAD_SECTION_ID,CLIENT_NAME,FEATURE_LENGTH_M
og_roads|WHSE_MINERAL_TENURE.OG_ROAD_SEGMENT_PERMIT_SP|-|
rec_lines|WHSE_FOREST_TENURE.FTEN_RECREATION_LINES_SVW|-|
parks|WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW|-|
bedrock|WHSE_MINERAL_TENURE.GEOL_BEDROCK_UNIT_POLY_SVW|-|
'

PY=""
for c in python3 python py; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c "pass" >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "07-bcdata: no working python found." >&2; exit 1; }

mkdir -p "$SCRATCH_DIR" "$BASEMAP_OUT_DIR"

# --- fetch ------------------------------------------------------------------
echo "$LAYERS" | while IFS='|' read -r key obj cql keep; do
  [ -n "$key" ] || continue
  ndjson="$SCRATCH_DIR/$key.geojsonl"
  if [ -f "$ndjson" ] && [ "$FORCE" != "1" ]; then
    echo "==> $key: already downloaded ($(wc -l < "$ndjson") features) — skipping."
    continue
  fi
  base="https://openmaps.gov.bc.ca/geo/pub/$obj/ows"
  set -- --data-urlencode "service=WFS" --data-urlencode "version=2.0.0" \
         --data-urlencode "request=GetFeature" --data-urlencode "typeName=pub:$obj"
  [ "$cql" = "-" ] || set -- "$@" --data-urlencode "CQL_FILTER=$cql"

  total=$(curl -fsSL --get "$base" "$@" --data-urlencode "resultType=hits" \
          | sed -n 's/.*numberMatched="\([0-9]*\)".*/\1/p')
  [ -n "$total" ] || { echo "07-bcdata: $key: could not read numberMatched." >&2; exit 1; }
  echo "==> $key: $total features from $obj"

  : > "$ndjson.part"
  start=0
  while [ "$start" -lt "$total" ]; do
    printf '    %s: %s / %s\n' "$key" "$start" "$total"
    # sortBy is REQUIRED for correct paging: without a stable sort key GeoServer
    # does not guarantee consistent ordering across startIndex requests, so
    # pages can silently overlap or skip features.
    curl -fsSL --get "$base" "$@" \
      --data-urlencode "outputFormat=application/json" \
      --data-urlencode "srsName=EPSG:4326" \
      --data-urlencode "sortBy=OBJECTID" \
      --data-urlencode "count=$PAGE" --data-urlencode "startIndex=$start" \
      -o "$SCRATCH_DIR/.page.json"
    KEEP_ATTRS="$keep" "$PY" - "$SCRATCH_DIR/.page.json" >> "$ndjson.part" <<'PYEOF'
import json, os, sys
# Windows Python defaults stdout to the ANSI codepage, which cannot encode the
# non-Latin characters present in some CLIENT_NAME values -- it dies mid-run
# with UnicodeEncodeError. Force UTF-8, and escape non-ASCII in the JSON so the
# output is byte-safe whatever the console is set to.
sys.stdout.reconfigure(encoding="utf-8", newline="\n")

# Newline-delimited GeoJSON: tippecanoe streams it, keeping peak memory flat
# instead of holding ~199k features as one document. KEEP_ATTRS empty means
# keep everything (the small layers carry useful attributes); otherwise the raw
# layer's ~20 columns are mostly tenure bookkeeping we do not ship.
keep = [k for k in os.environ.get("KEEP_ATTRS", "").split(",") if k]
d = json.load(open(sys.argv[1], encoding="utf-8"))
for f in d.get("features", []):
    p = f.get("properties") or {}
    if keep:
        p = {k: p[k] for k in keep if p.get(k) not in (None, "")}
    else:
        p = {k: v for k, v in p.items() if v not in (None, "") and not k.startswith("SE_ANNO")}
    f["properties"] = p
    f.pop("id", None)
    sys.stdout.write(json.dumps(f, ensure_ascii=True) + "\n")
PYEOF
    start=$((start + PAGE))
  done
  rm -f "$SCRATCH_DIR/.page.json"
  mv "$ndjson.part" "$ndjson"
  echo "    wrote $ndjson ($(wc -l < "$ndjson") features)"
done

# --- tile -------------------------------------------------------------------
host_scratch_dir=$(cd "$SCRATCH_DIR" && (pwd -W 2>/dev/null || pwd))
host_out_dir=$(cd "$BASEMAP_OUT_DIR" && (pwd -W 2>/dev/null || pwd))

# Same Windows 9p/drvfs trap documented in 04-contours.sh: tippecanoe's
# incremental archive writes decay badly across the bind mount (measured 1.43 ->
# 0.45 MB/s and still falling), so on Windows the archive is written to a podman
# volume on the VM's native ext4 and copied back in one sequential pass.
tile() {
  out_name="$1"; minz="$2"; maxz="$3"; shift 3
  echo "==> tippecanoe: $out_name z$minz-$maxz"
  rm -f "$BASEMAP_OUT_DIR/$out_name" "$BASEMAP_OUT_DIR/.part-$out_name"
  set -- -o "/out/.part-$out_name" -f -Z "$minz" -z "$maxz" \
         --drop-densest-as-needed --no-tile-size-limit "$@"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      vol=minfinder-bcdata-scratch
      podman volume create "$vol" >/dev/null 2>&1 || true
      MSYS_NO_PATHCONV=1 podman run --rm \
        -v "$host_scratch_dir:/scratch:ro" -v "$vol:/out" \
        "$TIPPECANOE_IMAGE" tippecanoe "$@"
      MSYS_NO_PATHCONV=1 podman run --rm \
        -v "$vol:/vol:ro" -v "$host_out_dir:/out" \
        "$ALPINE_IMAGE" cp "/vol/.part-$out_name" "/out/.part-$out_name"
      MSYS_NO_PATHCONV=1 podman run --rm -v "$vol:/vol" \
        "$ALPINE_IMAGE" rm -f "/vol/.part-$out_name"
      ;;
    *)
      podman run --rm \
        -v "$host_scratch_dir:/scratch:ro" -v "$host_out_dir:/out" \
        "$TIPPECANOE_IMAGE" tippecanoe "$@"
      ;;
  esac
  mv "$BASEMAP_OUT_DIR/.part-$out_name" "$BASEMAP_OUT_DIR/$out_name"
  echo "    wrote $BASEMAP_OUT_DIR/$out_name"
}

tile roads.pmtiles 9 14 \
  -L "resource_roads:/scratch/resource_roads.geojsonl" \
  -L "og_roads:/scratch/og_roads.geojsonl" \
  -L "rec_lines:/scratch/rec_lines.geojsonl"

# Parks and bedrock are polygons that must survive being zoomed out, so they
# start at z5. --coalesce-densest-as-needed merges adjacent same-attribute
# polygons at low zoom instead of dropping them outright, which keeps bedrock
# units continuous rather than punching holes in the geology.
tile context.pmtiles 5 14 \
  --coalesce-densest-as-needed \
  -L "parks:/scratch/parks.geojsonl" \
  -L "bedrock:/scratch/bedrock.geojsonl"

echo "==> Done."
echo "    Attribution required: contains information licensed under the"
echo "    Open Government Licence – British Columbia."
