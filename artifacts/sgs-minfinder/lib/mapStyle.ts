import basemapStyle from "./basemap-style.json";

// The style body lives in basemap-style.json rather than here because it has
// two consumers that must not drift: the map renders it inline (below), and the
// tile server publishes the very same file at BASEMAP_STYLE_URL for offline
// packs. MapLibre keys cached resources by URL, so if the two disagreed about a
// source's `url` the pack would cache tiles under one key while the map asked
// for another — createPack would report success and the map would still be
// blank offline, which is the worst way for a paid feature to fail.
//
// Do NOT hand-edit this JSON. basemap/build/06-style.sh generates it and writes
// both copies in the same step, which is what makes the two impossible to drift
// rather than merely unlikely to.
export const BASEMAP_STYLE = basemapStyle;

/** Style-spec fields of a source that the pack estimator needs. */
export interface StyleSource {
  type: string;
  url?: string;
  tileSize?: number;
  minzoom?: number;
  maxzoom?: number;
}

// Every source in the generated style declares minzoom/maxzoom inline (see the
// comment on `d["sources"]` in 06-style.sh). That is what lets lib/tileCache.ts
// size an offline pack without fetching five TileJSON documents — a question
// the user asks precisely when their connection is worst.
export const BASEMAP_SOURCES = BASEMAP_STYLE.sources as unknown as Record<
  string,
  StyleSource
>;

// SymbolLayer text (cluster counts + point status codes) needs a glyphs source.
// Now served from our own tile server alongside the tiles, so label text works
// fully offline and no third party can take the labels down. This closes the
// former TODO(prod) about depending on fonts.openmaptiles.org at runtime.
export const LABEL_FONT = ["Open Sans Bold"];

// MapView.mapStyle accepts a style URL or a JSON string; stringify the object.
// Rendering deliberately uses the inline copy so the map never needs the network
// to draw itself — a cold start in the bush still gets a styled map.
export const BASEMAP_STYLE_JSON = JSON.stringify(BASEMAP_STYLE);

// OfflineManager.createPack, unlike MapView.mapStyle, accepts ONLY a URL: it is
// handed straight to MLNTilePyramidOfflineRegion / OfflineTilePyramidRegionDefinition.
// Passing inline JSON here silently loses the style (NSURL rejects it, MapLibre
// substitutes its own default) and then hard-aborts the process in mbgl's
// unguarded style parser. A file:// URL is not an alternative — the offline
// downloader is wired to the Network file source only.
//
// Derived from the style's own glyphs URL rather than written out again, so
// changing BASEMAP_HOST in basemap/config.env moves every URL together. The
// alternative — a second literal hostname — is the exact kind of copy that goes
// stale silently.
export const BASEMAP_STYLE_URL = `${BASEMAP_STYLE.glyphs.replace(
  /\/glyphs\/.*$/,
  "",
)}/style.json`;

// Bumped when a pack's contents stop being comparable to older ones. Packs
// written before v2 were created by passing inline style JSON to createPack,
// which MapLibre silently rejected in favour of its own demo style. v2 packs
// hold Esri raster tiles keyed to server.arcgisonline.com, which this build no
// longer requests at all — so they are dead weight that would wrongly promise
// offline coverage. Both are deleted on sight rather than shown.
//
// Lives here rather than in a screen because two surfaces have to agree on it:
// the Offline list (which deletes stale packs) and the map's offline-coverage
// overlay (which must not outline an area that holds no tiles).
export const PACK_STYLE_VERSION = 3;
