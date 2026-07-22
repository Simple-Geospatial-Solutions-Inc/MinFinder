import { TILE_TEMPLATE_REMOTE } from "./tileCache";

// SymbolLayer text (cluster counts + point status codes) needs a MapLibre
// glyphs (font PBF) source. This free CDN serves standard font stacks; MapLibre
// caches glyphs, and offline packs created from this style download them too.
// TODO(prod): consider self-hosting / bundling glyphs for guaranteed uptime and
// fully-offline label text.
export const GLYPHS_URL = "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf";
export const LABEL_FONT = ["Open Sans Bold"];

const ESRI_SOURCE_ID = "esri-topo";
export const ESRI_RASTER_LAYER_ID = "esri-topo-layer";

// MapLibre style: opaque Esri World Topographic raster basemap. The occurrence
// and cluster layers are added as <MapView> children on top of this. The Esri
// URL uses {z}/{y}/{x} placeholders, which MapLibre substitutes by name.
export const ESRI_STYLE = {
  version: 8,
  glyphs: GLYPHS_URL,
  sources: {
    [ESRI_SOURCE_ID]: {
      type: "raster",
      tiles: [TILE_TEMPLATE_REMOTE],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Esri, USGS, NOAA, and the GIS User Community",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#F4F1EA" } },
    { id: ESRI_RASTER_LAYER_ID, type: "raster", source: ESRI_SOURCE_ID },
  ],
} as const;

// MapView.mapStyle accepts a style URL or a JSON string; stringify the object.
export const ESRI_STYLE_JSON = JSON.stringify(ESRI_STYLE);
