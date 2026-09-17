#!/usr/bin/env sh
# 06-style.sh — assemble $BASEMAP_OUT_DIR/style.json, the MapLibre style the app
# renders and OfflineManager.createPack downloads.
#
# WHY ADAPT RATHER THAN AUTHOR. The Esri raster basemap this replaces was 12
# lines of style because Esri did the cartography and shipped it as pictures.
# A vector basemap has no cartography until someone writes it, and hand-written
# cartography looks like a regression next to a professionally designed raster
# map -- that was measured, not guessed. So the base is osm-bright (129 layers,
# maintained by OpenMapTiles), and this script only:
#   1. repoints its sources/glyphs/sprite at our own server,
#   2. remaps its font stacks onto the ones we self-host,
#   3. adds hillshade + contour layers it has no source for,
#   4. sets the attribution our data licences require.
#
# LICENCE. osm-bright is BSD-3-Clause (code) + CC-BY 4.0 (design). Both are
# satisfied by keeping the copyright notice below and crediting OpenMapTiles in
# the attribution string, which the app surfaces on the map.
#
# Requires on the host: curl, and python3 or python. No containers needed.
set -eu

if [ ! -f "$(dirname "$0")/../config.env" ]; then
  echo "06-style: config.env not found in basemap/." >&2
  echo "  Create it first: cp config.env.example config.env" >&2
  exit 1
fi
BASEMAP_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$BASEMAP_DIR"
. "$BASEMAP_DIR/config.env"

FORCE="${FORCE:-0}"
OUT_PATH="$BASEMAP_OUT_DIR/style.json"

# Pinned so a rebuild is reproducible; bump deliberately after reviewing the
# upstream diff. See https://github.com/openmaptiles/osm-bright-gl-style
BRIGHT_REPO="openmaptiles/osm-bright-gl-style"
BRIGHT_COMMIT="master"
BRIGHT_URL="https://raw.githubusercontent.com/$BRIGHT_REPO/$BRIGHT_COMMIT/style.json"

if [ -f "$OUT_PATH" ] && [ "$FORCE" != "1" ]; then
  echo "==> $OUT_PATH already exists — skipping (FORCE=1 to rebuild)."
  exit 0
fi

mkdir -p "$BASEMAP_OUT_DIR"

# Windows ships a python3.exe stub that opens the Microsoft Store instead of
# running anything, so `command -v` is not enough -- actually execute it.
PY=""
for c in python3 python py; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c "pass" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "06-style: no working python found (tried python3, python, py)." >&2
  exit 1
fi

echo "==> Fetching base style: $BRIGHT_URL"
curl -fsSL -o "$BASEMAP_OUT_DIR/.base-style.json" "$BRIGHT_URL"

echo "==> Adapting for https://$BASEMAP_HOST"
BASEMAP_HOST="$BASEMAP_HOST" OUT_PATH="$OUT_PATH" BASEMAP_OUT_DIR="$BASEMAP_OUT_DIR" "$PY" - <<'PYEOF'
import json, os

host = os.environ["BASEMAP_HOST"]
outp = os.environ["OUT_PATH"]
outd = os.environ["BASEMAP_OUT_DIR"]
base = f"https://{host}"

d = json.load(open(os.path.join(outd, ".base-style.json"), encoding="utf-8"))

# --- 1. sources -----------------------------------------------------------
# The vector source keeps the id "openmaptiles" because all 129 upstream layers
# reference it by that name; only the URL changes.
# Every source declares minzoom/maxzoom INLINE, even though its TileJSON also
# carries them. Three reasons, all load-bearing:
#   1. The app reads them straight out of the bundled style to size an offline
#      pack (lib/tileCache.ts). Without them it would have to fetch five
#      TileJSONs over the network to answer a question asked while offline.
#   2. mbgl clamps its tile cover to these values. Declared inline, the clamp
#      holds even when the TileJSON fetch fails -- which is exactly the state a
#      device is in when it opens a downloaded pack in the bush.
#   3. Inline values win over the TileJSON, so this file is the single place
#      the zoom ranges are stated.
# THEY MUST MATCH THE ARCHIVES. Verify after any rebuild:
#   curl -s https://$BASEMAP_HOST/<tileset>.json | grep -o '"[a-z]*zoom":[0-9]*'
d["sources"] = {
    # Planetiler writes z0-14 (01-vector-tiles.sh).
    "openmaptiles": {"type": "vector", "url": f"{base}/basemap.json",
                     "minzoom": 0, "maxzoom": 14},
    # CONTOUR_MIN_Z / CONTOUR_MAX_Z in 04-contours.sh.
    # minzoom 12, NOT the 9 the archive's own TileJSON reports. MEASURED: every
    # contour tile at z9-11 comes back 204 No Content -- tippecanoe dropped them
    # all, because 20 m contours at those zooms are a solid mass and
    # --drop-densest-as-needed duly dropped the lot. Declaring 9 would make mbgl
    # request three zoom levels of guaranteed-empty tiles on every offline
    # download. Nothing renders below z12 either way; this just stops us asking.
    "contours":     {"type": "vector", "url": f"{base}/contours.json",
                     "minzoom": 12, "maxzoom": 14},
    # rio-rgbify wrote Mapbox terrain-RGB: -10000 + (R*65536 + G*256 + B) * 0.1.
    # maxzoom 11 is the real ceiling (GLO-30 is 30 m/px); MapLibre overzooms it.
    # This cap is also what keeps offline packs affordable: terrain PNGs run
    # ~250-420 KB against 1-30 KB for a vector tile, so they are ~60% of a
    # pack's bytes even stopping at z11. Raising it would be very expensive.
    "terrain": {
        "type": "raster-dem", "url": f"{base}/terrain.json",
        "encoding": "mapbox", "tileSize": 512, "minzoom": 0, "maxzoom": 11,
    },
    # BC forest tenure + oil & gas roads (07-bcdata.sh). Kept as SEPARATE
    # sources rather than merged into the OSM extract so they refresh on their
    # own cadence -- the provincial data changes when tenures change, not when
    # the monthly OSM rebuild runs.
    "bcroads":   {"type": "vector", "url": f"{base}/roads.json",
                  "minzoom": 9, "maxzoom": 14},
    "bccontext": {"type": "vector", "url": f"{base}/context.json",
                  "minzoom": 5, "maxzoom": 14},
}

d["glyphs"] = base + "/glyphs/{fontstack}/{range}.pbf"
d["sprite"] = base + "/sprite"

# --- 2. fonts -------------------------------------------------------------
# openmaptiles/fonts publishes no prebuilt "Noto Sans" glyph pack (only
# "Klokantech Noto Sans"), so remap onto the Open Sans stacks 05-glyphs.sh
# installs. A font a style requests but the server cannot serve renders as
# NOTHING -- the labels just silently vanish -- so this must stay exhaustive.
FONT_MAP = {
    "Noto Sans Regular": "Open Sans Regular",
    "Noto Sans Bold":    "Open Sans Bold",
    "Noto Sans Italic":  "Open Sans Italic",
}
remapped = set()
for layer in d["layers"]:
    fonts = (layer.get("layout") or {}).get("text-font")
    if not fonts:
        continue
    new = []
    for f in fonts:
        if f in FONT_MAP:
            remapped.add(f)
        new.append(FONT_MAP.get(f, f))
    layer["layout"]["text-font"] = new

unknown = set()
INSTALLED = {"Open Sans Bold", "Open Sans Regular", "Open Sans Semibold", "Open Sans Italic"}
for layer in d["layers"]:
    for f in (layer.get("layout") or {}).get("text-font", []):
        if f not in INSTALLED:
            unknown.add(f)
if unknown:
    raise SystemExit(
        "06-style: style requests fonts we do not self-host: "
        + ", ".join(sorted(unknown))
        + "\n  Add them to FONT_STACKS in config.env, or extend FONT_MAP here."
    )

# --- 3. hillshade + contours ---------------------------------------------
# Insertion point matters. Hillshade must sit ABOVE landcover/water fills so it
# shades them, but BELOW roads and every label, or it greys out the information
# people actually navigate by. The first transportation layer is that boundary.
def first_index(pred, default):
    for i, l in enumerate(d["layers"]):
        if pred(l):
            return i
    return default

roads_at = first_index(lambda l: l.get("source-layer") == "transportation", len(d["layers"]))

hillshade = {
    "id": "hillshade", "type": "hillshade", "source": "terrain",
    "paint": {
        "hillshade-exaggeration": 0.4,
        "hillshade-shadow-color": "#6B6558",
        "hillshade-highlight-color": "#FFFFFF",
        "hillshade-accent-color": "#8A8578",
    },
}

# idx == 1 marks index (CONTOUR_INDEX_M) contours; everything else is a minor
# line at CONTOUR_INTERVAL_M. Minors only from z12 -- below that they collapse
# into a solid brown mass over BC's relief.
contour_minor = {
    "id": "contour-minor", "type": "line", "source": "contours",
    "source-layer": "contours", "minzoom": 12,
    "filter": ["!=", ["get", "idx"], 1],
    "paint": {"line-color": "#9C7A50", "line-width": 0.5, "line-opacity": 0.4},
}
contour_index = {
    # minzoom 12 matches the source: there is no contour data below it, so a
    # lower value here would promise index lines the archive cannot draw.
    "id": "contour-index", "type": "line", "source": "contours",
    "source-layer": "contours", "minzoom": 12,
    "filter": ["==", ["get", "idx"], 1],
    "paint": {"line-color": "#8A6A42", "line-width": 0.9, "line-opacity": 0.55},
}
contour_label = {
    "id": "contour-label", "type": "symbol", "source": "contours",
    "source-layer": "contours", "minzoom": 13,
    "filter": ["==", ["get", "idx"], 1],
    "layout": {
        "symbol-placement": "line", "text-field": ["concat", ["to-string", ["get", "elev"]], " m"],
        "text-font": ["Open Sans Regular"], "text-size": 10,
        "text-max-angle": 25, "symbol-spacing": 320,
    },
    "paint": {"text-color": "#7A5C38", "text-halo-color": "#F8F4EC", "text-halo-width": 1.3},
}

# Resource roads sit directly ABOVE the OSM road layers, not below: where both
# datasets have the same road, the provincial geometry is the surveyed one. The
# dashed casing makes the ~80% that OSM lacks visually distinct from mapped
# roads, so a user can tell "surveyed tenure road" from "someone drove this".
resource_roads = {
    "id": "resource-road", "type": "line", "source": "bcroads",
    "source-layer": "resource_roads", "minzoom": 9,
    "layout": {"line-cap": "round", "line-join": "round"},
    "paint": {
        "line-color": "#B5651D",
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.4, 12, 1.1, 14, 2.0],
        "line-opacity": 0.85,
        "line-dasharray": [4, 1.5],
    },
}
resource_road_label = {
    "id": "resource-road-label", "type": "symbol", "source": "bcroads",
    "source-layer": "resource_roads", "minzoom": 13,
    "layout": {
        "symbol-placement": "line", "text-field": ["get", "MAP_LABEL"],
        "text-font": ["Open Sans Regular"], "text-size": 10,
        "text-max-angle": 30, "symbol-spacing": 400,
    },
    "paint": {"text-color": "#8A4A12", "text-halo-color": "#F8F4EC", "text-halo-width": 1.3},
}

parks = {
    "id": "bc-park", "type": "fill", "source": "bccontext",
    "source-layer": "parks", "minzoom": 5,
    "paint": {"fill-color": "#7FA86B", "fill-opacity": 0.18,
              "fill-outline-color": "#5E8A4C"},
}
# Bedrock geology ships in the style but HIDDEN. Two reasons it must be in the
# style rather than added at runtime: createPack only downloads sources the
# published style references, so a runtime-added source would be missing
# offline -- exactly when a prospector needs it. And visibility is a layout
# property the app flips with setLayoutProperty, no restyle required.
bedrock = {
    "id": "bedrock-geology", "type": "fill", "source": "bccontext",
    "source-layer": "bedrock", "minzoom": 5,
    "layout": {"visibility": "none"},
    "paint": {"fill-color": "#B08D57", "fill-opacity": 0.35,
              "fill-outline-color": "#7A5C38"},
}

d["layers"][roads_at:roads_at] = [parks, bedrock, hillshade, contour_minor, contour_index]
# Contour labels go last so every basemap label wins collision against them --
# a place name is more useful than an elevation figure when they overlap.
# Oil & gas permit roads. Same treatment as forest roads but a cooler brown --
# they cover northeast BC, where forest tenure does not reach, so in practice
# the two rarely appear together and the distinction is informational.
og_roads = {
    "id": "og-road", "type": "line", "source": "bcroads",
    "source-layer": "og_roads", "minzoom": 9,
    "layout": {"line-cap": "round", "line-join": "round"},
    "paint": {
        "line-color": "#9C6B3F",
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.4, 12, 1.1, 14, 2.0],
        "line-opacity": 0.85, "line-dasharray": [4, 1.5],
    },
}
# Sanctioned recreation trails: foot access, so dotted and thinner than
# anything driveable. Getting this distinction wrong would be dangerous -- a
# user must never read a hiking trail as something a truck can take.
rec_lines = {
    "id": "rec-line", "type": "line", "source": "bcroads",
    "source-layer": "rec_lines", "minzoom": 11,
    "layout": {"line-cap": "round", "line-join": "round"},
    "paint": {
        "line-color": "#6B8E4E",
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 14, 1.4],
        "line-opacity": 0.9, "line-dasharray": [1, 2],
    },
}

d["layers"].append(resource_roads)
d["layers"].append(og_roads)
d["layers"].append(rec_lines)
d["layers"].append(resource_road_label)
d["layers"].append(contour_label)

# --- 4. attribution -------------------------------------------------------
# ODbL requires crediting OpenStreetMap; osm-bright's CC-BY design licence
# requires crediting OpenMapTiles; Copernicus requires its DEM statement.
# Each clause is a licence condition, not decoration:
#   ODbL              -> credit OpenStreetMap contributors
#   CC-BY 4.0         -> credit OpenMapTiles (osm-bright's design licence)
#   Copernicus        -> the "modified Copernicus DEM data" statement
#   OGL-Canada 2.0    -> MRDEM-30, the bare-earth elevation source (02-dem.sh)
#   OGL-BC            -> the provincial road/park/geology layers (07-bcdata.sh)
# Mirrored in the app (about.tsx, offline.tsx, legal/, SUBMISSION.md) — keep in step.
ATTR = ("© OpenStreetMap contributors, © OpenMapTiles, "
        "Contains modified Copernicus DEM data, "
        "Contains information licensed under the Open Government Licence – Canada "
        "and the Open Government Licence – British Columbia")
for s in d["sources"].values():
    s["attribution"] = ATTR

d["name"] = "MinFinder Topo"
d["metadata"] = {
    "minfinder:base": f"osm-bright-gl-style@{os.environ.get('BRIGHT_COMMIT', 'master')}",
    "minfinder:note": "Generated by basemap/build/06-style.sh — do not hand-edit.",
}

with open(outp, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(d, fh, indent=2, ensure_ascii=False)

print(f"    layers: {len(d['layers'])}  fonts remapped: {', '.join(sorted(remapped)) or 'none'}")
PYEOF

rm -f "$BASEMAP_OUT_DIR/.base-style.json"
echo "==> Wrote $OUT_PATH"

# --- 5. keep the app's bundled copy in step ---------------------------------
# The app has TWO consumers of this style and they must not drift:
#   - MapView renders an INLINE copy, so a cold start in the field with no
#     signal can still draw the map.
#   - createPack is handed the published URL, because it accepts only a URL.
# MapLibre keys cached resources by URL. If the bundled copy and the published
# one disagree about a source's `url`, the pack caches tiles under one key and
# the map asks for another -- the download "succeeds" and the map is still
# blank offline, which is the worst possible failure for a paid feature.
# Writing both from here makes that drift impossible by construction, so do NOT
# hand-copy style.json into the app.
APP_STYLE="$BASEMAP_DIR/../artifacts/sgs-minfinder/lib/basemap-style.json"
if [ -d "$(dirname "$APP_STYLE")" ]; then
  cp "$OUT_PATH" "$APP_STYLE"
  echo "==> Synced app copy: $APP_STYLE"
else
  echo "==> NOTE: app lib/ not found; skipped bundled-style sync." >&2
fi
