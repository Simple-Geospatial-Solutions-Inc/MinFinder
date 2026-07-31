import esriStyle from "./esri-style.json";

// The style body lives in esri-style.json rather than here because it has two
// consumers that must not drift: the map renders it inline (below), and GitHub
// Pages publishes the exact same file as ESRI_STYLE_URL for offline packs.
// MapLibre keys cached resources by URL, so the raster tile template has to be
// byte-identical in both or downloaded tiles won't be reused by the map.
export const ESRI_STYLE = esriStyle;

// SymbolLayer text (cluster counts + point status codes) needs a MapLibre
// glyphs (font PBF) source. This free CDN serves standard font stacks; MapLibre
// caches glyphs, and offline packs created from this style download them too.
// TODO(prod): consider self-hosting / bundling glyphs for guaranteed uptime and
// fully-offline label text.
export const GLYPHS_URL = ESRI_STYLE.glyphs;
export const LABEL_FONT = ["Open Sans Bold"];

export const ESRI_RASTER_LAYER_ID = "esri-topo-layer";

// MapView.mapStyle accepts a style URL or a JSON string; stringify the object.
// Rendering deliberately uses the inline copy so the map never needs the
// network to draw itself.
export const ESRI_STYLE_JSON = JSON.stringify(ESRI_STYLE);

// OfflineManager.createPack, unlike MapView.mapStyle, accepts ONLY a URL: it is
// handed straight to MLNTilePyramidOfflineRegion / OfflineTilePyramidRegionDefinition.
// Passing inline JSON here silently loses the style (NSURL rejects it, MapLibre
// substitutes its own default) and then hard-aborts the process in mbgl's
// unguarded style parser. A file:// URL is not an alternative — the offline
// downloader is wired to the Network file source only.
export const ESRI_STYLE_URL =
  "https://simple-geospatial-solutions-inc.github.io/MinFinder/style.json";
