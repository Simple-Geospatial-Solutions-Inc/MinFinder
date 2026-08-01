import esriStyle from "./esri-style.json";
import { lonLatToTile } from "./geo";

// Esri World Topographic basemap — free public tile service, no API key needed.
// {z}/{y}/{x} (XYZ) ordering. Read out of the style rather than declared here so
// there is exactly one copy of the template: MapLibre matches offline-cached
// tiles by URL, so the rendered style and the published offline style must agree.
export const TILE_TEMPLATE_REMOTE = esriStyle.sources["esri-topo"].tiles[0];

// Widened from the JSON's inferred literal type: `minzoom` is absent from the
// style (mbgl defaults it to 0) but reading it keeps this in step if it is added.
const RASTER_SOURCE = esriStyle.sources["esri-topo"] as {
  tiles: string[];
  tileSize?: number;
  minzoom?: number;
  maxzoom?: number;
};

// mbgl works in 512px tile units internally, so a source with smaller tiles
// needs one extra XYZ level per halving of tile size to cover the same ground —
// its util::coveringZoomLevel() adds log2(512 / tileSize) and floors. The Esri
// basemap serves 256px tiles, so a pack requested over *style* zooms 8-13 in
// fact fetches XYZ z9-z14, roughly four times as many tiles as those style
// zooms suggest. Missing this made the picker's estimate read ~3.5x low.
const MBGL_TILE_UNIT = 512;
const TILE_SIZE = RASTER_SOURCE.tileSize ?? MBGL_TILE_UNIT;
const ZOOM_SHIFT = Math.log2(MBGL_TILE_UNIT / TILE_SIZE);

/**
 * The XYZ tile zoom levels MapLibre actually fetches for a pack requested over
 * `[minZoom, maxZoom]` style zooms — mirrors mbgl's coveringZoomRange(),
 * including the clamp to the source's own zoom range.
 */
export function tileZoomRange(
  minZoom: number,
  maxZoom: number,
): { min: number; max: number } {
  return {
    min: Math.max(Math.floor(minZoom + ZOOM_SHIFT), RASTER_SOURCE.minzoom ?? 0),
    max: Math.min(Math.floor(maxZoom + ZOOM_SHIFT), RASTER_SOURCE.maxzoom ?? 22),
  };
}

// WGS84 equatorial circumference, for ground-resolution maths.
const EQUATORIAL_CIRCUMFERENCE_M = 40075016.686;

/**
 * Ground resolution in metres per pixel of the deepest tile level a pack caches
 * when it is requested up to `maxZoom`, at latitude `lat`. Shown in the UI as
 * the point past which the basemap starts to blur.
 */
export function metersPerPixelAt(lat: number, maxZoom: number): number {
  const z = tileZoomRange(maxZoom, maxZoom).max;
  const latScale = Math.cos((lat * Math.PI) / 180);
  return (EQUATORIAL_CIRCUMFERENCE_M * latScale) / (TILE_SIZE * 2 ** z);
}

// Pre-download tile-count estimate for the offline picker. MapLibre's
// OfflineManager has no cheap pre-count, so we count the XYZ tile cover of the
// bounds ourselves over the zoom range mbgl will really use.
export function countTilesInRegion(
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  minZoom: number,
  maxZoom: number,
): number {
  const { min, max } = tileZoomRange(minZoom, maxZoom);
  let total = 0;
  for (let z = min; z <= max; z++) {
    const a = lonLatToTile(minLon, maxLat, z);
    const b = lonLatToTile(maxLon, minLat, z);
    const w = Math.abs(b.x - a.x) + 1;
    const h = Math.abs(b.y - a.y) + 1;
    total += w * h;
  }
  return total;
}
