import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { lonLatToTile } from "./geo";

// Esri World Topographic basemap via ArcGIS Location Platform.
// Requires an API key (free developer tier, ~2M tiles/month).
// Falls back to CARTO Voyager when no key is configured.
const ARCGIS_KEY = process.env.EXPO_PUBLIC_ARCGIS_API_KEY;
export const TILE_TEMPLATE_REMOTE = ARCGIS_KEY
  ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}?token=${ARCGIS_KEY}`
  : "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";

export const TILE_CACHE_DIR =
  Platform.OS === "web"
    ? ""
    : `${FileSystem.documentDirectory}tiles`;

const REGIONS_FILE =
  Platform.OS === "web" ? "" : `${FileSystem.documentDirectory}offline-regions.json`;

export interface OfflineRegion {
  id: string;
  name: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  minZoom: number;
  maxZoom: number;
  tileCount: number;
  createdAt: number;
}

async function ensureDir(path: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

export async function listRegions(): Promise<OfflineRegion[]> {
  if (Platform.OS === "web") return [];
  try {
    const info = await FileSystem.getInfoAsync(REGIONS_FILE);
    if (!info.exists) return [];
    const text = await FileSystem.readAsStringAsync(REGIONS_FILE);
    return JSON.parse(text) as OfflineRegion[];
  } catch {
    return [];
  }
}

async function saveRegions(regions: OfflineRegion[]): Promise<void> {
  if (Platform.OS === "web") return;
  await FileSystem.writeAsStringAsync(
    REGIONS_FILE,
    JSON.stringify(regions, null, 2),
  );
}

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

export interface DownloadProgress {
  done: number;
  total: number;
  failed: number;
}

export async function downloadRegion(
  region: Omit<OfflineRegion, "id" | "tileCount" | "createdAt">,
  onProgress?: (p: DownloadProgress) => void,
  shouldCancel?: () => boolean,
): Promise<OfflineRegion> {
  if (Platform.OS === "web") {
    throw new Error("Offline tile download is not supported on web.");
  }
  await ensureDir(TILE_CACHE_DIR);

  const total = countTilesInRegion(
    region.minLat,
    region.maxLat,
    region.minLon,
    region.maxLon,
    region.minZoom,
    region.maxZoom,
  );

  let done = 0;
  let failed = 0;

  for (let z = region.minZoom; z <= region.maxZoom; z++) {
    const a = lonLatToTile(region.minLon, region.maxLat, z);
    const b = lonLatToTile(region.maxLon, region.minLat, z);
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);

    for (let x = x0; x <= x1; x++) {
      const zxDir = `${TILE_CACHE_DIR}/${z}/${x}`;
      await ensureDir(`${TILE_CACHE_DIR}/${z}`);
      await ensureDir(zxDir);
      for (let y = y0; y <= y1; y++) {
        if (shouldCancel?.()) {
          return {
            ...region,
            id: Date.now().toString(36),
            tileCount: done,
            createdAt: Date.now(),
          };
        }
        const dest = `${zxDir}/${y}.png`;
        const info = await FileSystem.getInfoAsync(dest);
        if (info.exists) {
          done++;
        } else {
          const url = TILE_TEMPLATE_REMOTE.replace("{z}", String(z))
            .replace("{x}", String(x))
            .replace("{y}", String(y));
          try {
            const res = await FileSystem.downloadAsync(url, dest, {
              headers: { "User-Agent": "SGSMinFinder/1.0" },
            });
            if (res.status === 200) {
              done++;
            } else {
              failed++;
            }
          } catch {
            failed++;
          }
        }
        if (onProgress && (done + failed) % 8 === 0) {
          onProgress({ done, total, failed });
        }
      }
    }
  }

  onProgress?.({ done, total, failed });

  const newRegion: OfflineRegion = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: region.name,
    minLat: region.minLat,
    maxLat: region.maxLat,
    minLon: region.minLon,
    maxLon: region.maxLon,
    minZoom: region.minZoom,
    maxZoom: region.maxZoom,
    tileCount: done,
    createdAt: Date.now(),
  };
  const all = await listRegions();
  all.push(newRegion);
  await saveRegions(all);
  return newRegion;
}

export async function deleteRegion(id: string): Promise<void> {
  const all = await listRegions();
  const next = all.filter((r) => r.id !== id);
  await saveRegions(next);
  // Note: tiles remain in the shared cache (they may overlap with other regions).
}

export async function clearAllTiles(): Promise<void> {
  if (Platform.OS === "web") return;
  const info = await FileSystem.getInfoAsync(TILE_CACHE_DIR);
  if (info.exists) {
    await FileSystem.deleteAsync(TILE_CACHE_DIR, { idempotent: true });
  }
  await saveRegions([]);
}
