import { lonLatToTile } from "./geo";

// Esri World Topographic basemap — free public tile service, no API key needed.
// {z}/{y}/{x} (XYZ) ordering. Consumed by the MapLibre raster source in
// lib/mapStyle.ts (online) and by MapLibre offline packs built from that style.
export const TILE_TEMPLATE_REMOTE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}";

// Pre-download tile-count estimate for the offline picker. MapLibre's
// OfflineManager has no cheap pre-count, so we estimate the same way the old
// manual downloader did (Web-Mercator XYZ tile math) to keep the "Estimated
// tiles" UI and the size guard.
export function countTilesInRegion(
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  minZoom: number,
  maxZoom: number,
): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const a = lonLatToTile(minLon, maxLat, z);
    const b = lonLatToTile(maxLon, minLat, z);
    const w = Math.abs(b.x - a.x) + 1;
    const h = Math.abs(b.y - a.y) + 1;
    total += w * h;
  }
  return total;
}
