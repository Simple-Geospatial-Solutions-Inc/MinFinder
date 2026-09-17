#!/usr/bin/env sh
# 05-glyphs.sh — fetch prebuilt SDF glyph PBFs and map sprites into
#   $BASEMAP_OUT_DIR/glyphs/{fontstack}/{range}.pbf
#   $BASEMAP_OUT_DIR/sprite.json / sprite.png / sprite@2x.json / sprite@2x.png
#
# We download prebuilt glyphs instead of running a font toolchain: the PBFs
# are deterministic build artifacts and the openmaptiles/fonts project already
# publishes them, so pulling a pinned copy is both simpler and more
# reproducible than pinning node + fontnik ourselves.
#
# Glyph source: openmaptiles/fonts gh-pages branch (one directory + zip per
# fontstack, each zip containing "<Stack Name>/<start>-<end>.pbf" for all 256
# Unicode ranges). Pinned to a specific commit so a gh-pages rebuild upstream
# can never silently change our output.
#
# Sprite source: protomaps/basemaps-assets (sprites/v4/<flavor>{,@2x}.{json,png}),
# likewise pinned to a commit. We rename the flavor to the app-facing names
# sprite.json / sprite.png (+ @2x).
#
# Requires on the host: curl, and one of unzip / python3 / python.
# No container runtime needed here — this stage is downloads only.
set -eu

# Fail with a hint (not a cryptic shell error) when config.env has not been
# created from the example yet — same guard as 01-vector-tiles.sh.
if [ ! -f "$(dirname "$0")/../config.env" ]; then
  echo "05-glyphs: config.env not found in basemap/." >&2
  echo "  Create it first: cp config.env.example config.env" >&2
  exit 1
fi
. "$(dirname "$0")/../config.env"

# Relative BASEMAP_* dirs are resolved against the basemap/ directory so the
# result is the same no matter where this script is invoked from.
cd "$(dirname "$0")/.."

FORCE="${FORCE:-0}"

# Pinned gh-pages commit of https://github.com/openmaptiles/fonts.
# To check for a newer one:  git ls-remote https://github.com/openmaptiles/fonts gh-pages
# (pinned 2026-08-24)
FONTS_REPO="openmaptiles/fonts"
FONTS_COMMIT="025ff2b2f84cc0fdf11f7b1d74b3a784595fe7a4"

# Font stacks to install, comma-separated because the names contain spaces.
# "Open Sans Bold" is REQUIRED: it is the stack the app requests
# (LABEL_FONT in artifacts/sgs-minfinder/lib/mapStyle.ts). The extras are
# cheap (~250 KB each) and cover regular/semibold/italic labelling if the
# style ever needs them.
FONT_STACKS="${FONT_STACKS:-Open Sans Bold,Open Sans Regular,Open Sans Semibold,Open Sans Italic}"

# Pinned commit of https://github.com/protomaps/basemaps-assets.
# To check for a newer one:  git ls-remote https://github.com/protomaps/basemaps-assets main
# (pinned 2026-08-24)
SPRITES_REPO="protomaps/basemaps-assets"
SPRITES_COMMIT="028c18f713baecad011301ff7a69acc39bcc2ae7"
# Which sprite flavor to publish as sprite.* — v4 flavors: light, dark,
# grayscale, white, black.
SPRITE_FLAVOR="${SPRITE_FLAVOR:-light}"

GLYPH_DIR="$BASEMAP_OUT_DIR/glyphs"
mkdir -p "$GLYPH_DIR" "$BASEMAP_DATA_DIR/glyphs-tmp"

# Extract a zip with whatever the host has. Git Bash usually ships unzip,
# but a minimal Linux VPS may only have python3, so try each in turn.
extract_zip() { # $1 = zip file, $2 = destination directory
  if command -v unzip >/dev/null 2>&1; then
    unzip -oq "$1" -d "$2"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$1" "$2"
  elif command -v python >/dev/null 2>&1; then
    python -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$1" "$2"
  else
    echo "05-glyphs: ERROR: need unzip, python3 or python on PATH to extract $1" >&2
    exit 1
  fi
}

# URL-encode the only character that appears in fontstack names (space).
urlenc() {
  printf '%s' "$1" | sed 's/ /%20/g'
}

echo "==> Installing glyph PBFs into $GLYPH_DIR"

# POSIX sh has no arrays; walk the comma-separated list with a while/case loop.
rest="$FONT_STACKS"
while [ -n "$rest" ]; do
  case "$rest" in
    *,*) stack="${rest%%,*}"; rest="${rest#*,}" ;;
    *)   stack="$rest";       rest="" ;;
  esac
  # Trim surrounding spaces the list may carry after commas.
  stack=$(printf '%s' "$stack" | sed 's/^ *//; s/ *$//')
  [ -n "$stack" ] || continue

  # 0-255.pbf exists in every stack, so its presence is a good completeness marker.
  if [ -s "$GLYPH_DIR/$stack/0-255.pbf" ] && [ "$FORCE" != "1" ]; then
    echo "    $stack: already present, skipping (set FORCE=1 to re-download)."
    continue
  fi

  zip_url="https://raw.githubusercontent.com/$FONTS_REPO/$FONTS_COMMIT/$(urlenc "$stack").zip"
  zip_tmp="$BASEMAP_DATA_DIR/glyphs-tmp/stack.zip"
  echo "    $stack: downloading $zip_url"
  curl -fsSL --retry 3 --retry-delay 2 -o "$zip_tmp" "$zip_url"

  # The zip already contains a top-level "<Stack Name>/" directory holding the
  # 256 range PBFs, so extracting into glyphs/ lands files exactly at
  # glyphs/{fontstack}/{range}.pbf.
  extract_zip "$zip_tmp" "$GLYPH_DIR"
  rm -f "$zip_tmp"

  if [ ! -s "$GLYPH_DIR/$stack/0-255.pbf" ]; then
    echo "05-glyphs: ERROR: expected $GLYPH_DIR/$stack/0-255.pbf after extraction; zip layout changed?" >&2
    exit 1
  fi
  n=$(ls "$GLYPH_DIR/$stack" | wc -l | tr -d ' ')
  echo "    $stack: installed ($n range files)."
done

echo "==> Installing sprites into $BASEMAP_OUT_DIR (flavor: $SPRITE_FLAVOR)"

if [ -s "$BASEMAP_OUT_DIR/sprite.json" ] && [ -s "$BASEMAP_OUT_DIR/sprite@2x.png" ] && [ "$FORCE" != "1" ]; then
  echo "    sprites already present, skipping (set FORCE=1 to re-download)."
else
  sprite_base="https://raw.githubusercontent.com/$SPRITES_REPO/$SPRITES_COMMIT/sprites/v4"
  # src suffix -> published name (rename flavor to the app-facing "sprite").
  for pair in \
    "$SPRITE_FLAVOR.json sprite.json" \
    "$SPRITE_FLAVOR.png sprite.png" \
    "$SPRITE_FLAVOR@2x.json sprite@2x.json" \
    "$SPRITE_FLAVOR@2x.png sprite@2x.png"
  do
    src="${pair%% *}"
    dest="${pair##* }"
    echo "    $src -> $dest"
    # @ needs no escaping in URLs; only the download failing should stop us (-f).
    # Download to a temp name first: an interrupted transfer must not leave a
    # truncated file at the final path, or the re-run check above would treat
    # the sprites as complete.
    sprite_tmp="$BASEMAP_DATA_DIR/glyphs-tmp/sprite.part"
    curl -fsSL --retry 3 --retry-delay 2 -o "$sprite_tmp" "$sprite_base/$(urlenc "$src")"
    mv -f "$sprite_tmp" "$BASEMAP_OUT_DIR/$dest"
  done
fi

rmdir "$BASEMAP_DATA_DIR/glyphs-tmp" 2>/dev/null || true

echo "==> 05-glyphs: done."
echo "    glyphs: $GLYPH_DIR/{fontstack}/{range}.pbf"
echo "    sprites: $BASEMAP_OUT_DIR/sprite{,@2x}.{json,png}"
