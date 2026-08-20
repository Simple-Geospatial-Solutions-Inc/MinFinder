import type { Occurrence } from "./db";
import { bearingDegrees, bearingToCompass, distanceMeters } from "./geo";

// Region shape formerly imported from react-native-maps; kept app-wide for the
// offline picker and camera math.
export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

// MapLibre LngLatBounds is a flat [west, south, east, north] (GeoJSON order).
export type Bounds = [west: number, south: number, east: number, north: number];

export function regionToBounds(r: Region): Bounds {
  return [
    r.longitude - r.longitudeDelta / 2,
    r.latitude - r.latitudeDelta / 2,
    r.longitude + r.longitudeDelta / 2,
    r.latitude + r.latitudeDelta / 2,
  ];
}

// Approximate Web-Mercator zoom level for a given latitude span (degrees).
// Used to drive MapLibre's Camera where the old code used latitudeDelta.
export function deltaToZoom(latitudeDelta: number): number {
  const d = Math.min(Math.max(latitudeDelta, 0.0006), 180);
  return Math.max(0, Math.min(20, Math.log2(360 / d)));
}

// --- Offline-region bounds helpers -----------------------------------------
// Downloaded regions are MapLibre offline packs, which carry nothing but a
// [w, s, e, n] box. Everything the UI shows about a region is derived here.
//
// Note on the antimeridian: BC spans roughly -139° to -114°, and the offline
// picker's 4000-tile cap keeps a region under ~165 km across, so a box can
// never wrap ±180° through this UI. These helpers assume west < east.

// ~500m. A pack whose bounds collapsed to (nearly) a point would make
// `fitBounds` snap to maximum zoom, so widen the box to something usable first.
const MIN_SPAN_DEG = 0.005;

export function boundsCenter(b: Bounds): [lon: number, lat: number] {
  const [w, s, e, n] = b;
  return [(w + e) / 2, (s + n) / 2];
}

// Orders a bounds box and enforces a minimum span so `fitBounds` behaves.
export function normalizeBounds(b: Bounds): Bounds {
  const [lon, lat] = boundsCenter(b);
  const halfLon = Math.max(Math.abs(b[2] - b[0]) / 2, MIN_SPAN_DEG / 2);
  const halfLat = Math.max(Math.abs(b[3] - b[1]) / 2, MIN_SPAN_DEG / 2);
  return [lon - halfLon, lat - halfLat, lon + halfLon, lat + halfLat];
}

// Ground extent of a bounds box. East-west is measured along the mid-latitude,
// which is where the box is widest in ground terms for a northern-hemisphere
// region.
export function boundsSpanKm(b: Bounds): { nsKm: number; ewKm: number } {
  const [w, s, e, n] = b;
  const midLat = (s + n) / 2;
  return {
    nsKm: distanceMeters(s, w, n, w) / 1000,
    ewKm: distanceMeters(midLat, w, midLat, e) / 1000,
  };
}

// "158 × 167 km", with a decimal for boxes small enough that rounding to whole
// kilometres would read as zero.
export function formatSpanKm(b: Bounds): string {
  const { nsKm, ewKm } = boundsSpanKm(b);
  const fmt = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
  return `${fmt(ewKm)} × ${fmt(nsKm)} km`;
}

export interface BoundsProximity {
  inside: boolean;
  /** Distance to the nearest edge of the box, in km. */
  km: number;
  /** Coarse direction to the box centre, e.g. "NE". */
  octant: string;
}

// How far the user is from a region, measured to its nearest *edge* rather than
// its centre — "how far can I drive before the map goes blank" is the question
// this answers, and for a 160km box the centre distance is misleading.
export function distanceToBoundsKm(
  lat: number,
  lon: number,
  b: Bounds,
): BoundsProximity {
  const [w, s, e, n] = b;
  const inside = lat >= s && lat <= n && lon >= w && lon <= e;
  const [cLon, cLat] = boundsCenter(b);
  const octant = bearingToCompass(bearingDegrees(lat, lon, cLat, cLon));

  if (inside) {
    // Perpendicular distance to each of the four edges.
    const km = Math.min(
      distanceMeters(lat, lon, s, lon),
      distanceMeters(lat, lon, n, lon),
      distanceMeters(lat, lon, lat, w),
      distanceMeters(lat, lon, lat, e),
    ) / 1000;
    return { inside, km, octant };
  }

  // Outside: clamp onto the box to get the closest point on its boundary.
  const nearLat = Math.min(Math.max(lat, s), n);
  const nearLon = Math.min(Math.max(lon, w), e);
  return {
    inside,
    km: distanceMeters(lat, lon, nearLat, nearLon) / 1000,
    octant,
  };
}

// Last-resort region name when reverse geocoding is unavailable: "50.71°N 121.30°W".
export function boundsToPlaceName(b: Bounds): string {
  const [lon, lat] = boundsCenter(b);
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

export interface RegionOutline {
  id: string;
  name?: string;
  bounds: Bounds;
  /** Drives the heavier gold styling for the region the user tapped. */
  focused?: boolean;
}

// Rectangles for the map's offline-coverage layers. One closed ring per region;
// `focused` is read by the layer style expressions.
export function regionsToFeatureCollection(
  regions: RegionOutline[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: regions.map((r) => {
      const [w, s, e, n] = r.bounds;
      return {
        type: "Feature",
        id: r.id,
        properties: { id: r.id, focused: !!r.focused },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s],
            ],
          ],
        },
      };
    }),
  };
}

export interface OccFeature {
  type: "Feature";
  id: number;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { id: number; STATUS_C: string };
}

export interface OccFeatureCollection {
  type: "FeatureCollection";
  features: OccFeature[];
}

// Build the GeoJSON fed to the clustered ShapeSource. `coordinates` are
// [longitude, latitude] (GeoJSON order). STATUS_C defaults to "UNK".
export function occurrencesToFeatureCollection(
  rows: Occurrence[],
): OccFeatureCollection {
  const features: OccFeature[] = [];
  for (const r of rows) {
    if (r.LATITUDE == null || r.LONGITUDE == null) continue;
    features.push({
      type: "Feature",
      id: r.id,
      geometry: { type: "Point", coordinates: [r.LONGITUDE, r.LATITUDE] },
      properties: { id: r.id, STATUS_C: r.STATUS_C ?? "UNK" },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Bounding box enclosing a set of occurrences, or null when none of them have
 * coordinates. Every other bounds helper here goes the other way (box to
 * center/span/name), so this is the one direction the file was missing.
 *
 * Pass the result through `normalizeBounds` before handing it to `fitBounds`: a
 * single occurrence yields a zero-span box, which snaps the camera to maximum
 * zoom. Assumes west < east, like the rest of this file.
 */
export function occurrencesToBounds(rows: Occurrence[]): Bounds | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const r of rows) {
    if (r.LATITUDE == null || r.LONGITUDE == null) continue;
    if (r.LONGITUDE < w) w = r.LONGITUDE;
    if (r.LONGITUDE > e) e = r.LONGITUDE;
    if (r.LATITUDE < s) s = r.LATITUDE;
    if (r.LATITUDE > n) n = r.LATITUDE;
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}
