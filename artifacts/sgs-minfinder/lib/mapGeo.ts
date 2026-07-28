import type { Occurrence } from "./db";

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
