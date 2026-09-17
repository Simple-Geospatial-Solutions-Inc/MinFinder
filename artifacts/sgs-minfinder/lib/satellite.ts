import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The optional satellite basemap: Esri World Imagery streamed at view time.
 *
 * This lives OUTSIDE basemap-style.json on purpose. OfflineManager.createPack
 * downloads every source declared in the style it is handed, and
 * lib/tileCache.ts prices every source in BASEMAP_SOURCES — so a satellite
 * source in the shared style would be bulk-downloaded into every offline pack.
 * That is exactly what Esri's terms forbid and why the Esri raster basemap was
 * replaced by the self-hosted topo (see basemap/README.md). Mounted as a
 * runtime <RasterSource> on the map instead, the imagery is drawn online only:
 * packs never see it, pack estimates never count it, and nothing beyond
 * MapLibre's ordinary ambient tile cache (transient, browser-style) is kept.
 *
 * Offline there is no special handling: tiles that fail to load simply draw
 * nothing, and the topo basemap underneath — including downloaded packs —
 * shows through. The on-map credit chip (components/SatelliteCredit.tsx)
 * carries the "online only" hint when expanded.
 */
export type Basemap = "topo" | "satellite";

const KEY = "sgs:map:basemap_v1";

export const DEFAULT_BASEMAP: Basemap = "topo";

function isBasemap(v: string | null): v is Basemap {
  return v === "topo" || v === "satellite";
}

export async function loadBasemap(): Promise<Basemap> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return isBasemap(v) ? v : DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP;
  }
}

export async function saveBasemap(basemap: Basemap): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, basemap);
  } catch {
    // ignore persistence errors — the in-memory choice still holds for the session
  }
}

export function otherBasemap(basemap: Basemap): Basemap {
  return basemap === "topo" ? "satellite" : "topo";
}

// Provider details, kept together so swapping providers is a one-place change.
// Esri World Imagery: 256 px JPEG tiles, LODs 0–23, no API key. A different
// host from the retired basemap (server.arcgisonline.com), so it can never
// collide with the v2 pack tiles that lib/mapStyle.ts deletes on sight.
export const SATELLITE_TILES = [
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];

// mbgl's tile unit is 512, so a 256 px source is fetched one zoom deeper than
// the map zoom (see MBGL_TILE_UNIT in lib/tileCache.ts). Harmless here — the
// source is never packed — but it is why data use is ~4 tiles per screen tile.
export const SATELLITE_TILE_SIZE = 256;

// Esri publishes up to level 23 in cities but far less over rural BC, and
// where a level is missing the service does NOT 404 — it returns HTTP 200 with
// a grey "Map data not yet available" JPEG (2.5 KB, identical everywhere),
// which MapLibre then draws like any other tile. The cap is what stops that:
// past it MapLibre overzooms the last real level instead of asking for one
// that comes back as the placeholder. Probed Aug 2026 on a 97-point grid over
// BC: level 18 is real imagery everywhere except north of ~59°N (Atlin, Lower
// Post) and open ocean; level 19 is the placeholder at 89 of 97 points, i.e.
// everywhere outside towns. So 18 — the finest level rural BC actually has.
// Remember the 256 px tile unit: this is the *tile* level, first requested at
// map zoom ~17.5, so the far north will still show placeholders from ~16.5 up;
// capping at 17 would fix that strip at the cost of a full level everywhere.
export const SATELLITE_MAX_ZOOM = 18;

// Verbatim from the service's copyrightText (…/World_Imagery/MapServer?f=pjson),
// with "Source:" swapped for "Imagery:" so it reads correctly beside our own
// basemap credits. Esri requires this to be shown on the map while imagery is.
export const SATELLITE_ATTRIBUTION =
  "Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community";

export const SATELLITE_TERMS_URL =
  "https://www.esri.com/en-us/legal/terms/data-attributions";

// Where the imagery sits in the topo style's layer stack. Everything below
// contour-minor is a fill or the hillshade — background, landcover, water,
// buildings, parks, geology — and opaque imagery replaces all of it, hillshade
// included (shading real imagery with a DEM darkens it twice). Everything from
// the contours up — roads, boundaries, BC resource roads, every label — stays on
// top, which is what makes this a hybrid. The one casualty is the faint bc-park
// tint; anchoring at "bc-park" would keep it but put the hillshade over the
// imagery, which is worse.
export const SATELLITE_ANCHOR_LAYER = "contour-minor";
