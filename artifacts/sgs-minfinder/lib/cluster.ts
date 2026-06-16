import type { Occurrence } from "./db";

export interface ClusterPoint {
  type: "point";
  id: number;
  lat: number;
  lon: number;
  occurrence: Occurrence;
}

export interface ClusterGroup {
  type: "cluster";
  id: string;
  lat: number;
  lon: number;
  count: number;
  // dominant status for colouring (mode of contained statuses, "" if mixed/none)
  dominantStatus: string | null;
  mixed: boolean;
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

export type ClusterItem = ClusterPoint | ClusterGroup;

// ~cells across the visible area. Fewer, bigger clusters == far fewer native
// Marker views, which is the dominant render cost on every zoom.
const CELLS_ACROSS = 7;

// Quantise the zoom (latitudeDelta) into discrete integer buckets. This is the
// key to a smooth map: because the grid cell size is derived from the *bucket*
// rather than the raw delta, the grid — and therefore every marker's key —
// stays byte-for-byte identical across pans and small zoom changes. That lets
// react-native-maps reuse the existing native pin views instead of unmounting
// and recreating hundreds of them on every gesture (the churn that made the map
// lag on Android and hard-crash on iOS). The grid only changes when you cross a
// bucket boundary. Half-steps (log base sqrt(2)) keep clustering granularity
// smooth without making the grid continuous again.
export function zoomBucketForDelta(latitudeDelta: number): number {
  const d = Math.min(Math.max(latitudeDelta, 0.0006), 180);
  return Math.round(Math.log2(d) * 2);
}

function cellSizeForBucket(bucket: number): number {
  const repDelta = Math.pow(2, bucket / 2);
  return Math.max(repDelta / CELLS_ACROSS, 0.0008);
}

export function clusterOccurrences(
  rows: Occurrence[],
  zoomBucket: number,
): ClusterItem[] {
  // Always cluster — at deep zoom the cell floor (~80m) means most cells
  // contain a single point and render as a solo pin. This keeps the total
  // marker count bounded at every zoom level (the 16k-pin worst case would
  // otherwise lock up Android when zooming in over a dense area).
  const cell = cellSizeForBucket(zoomBucket);
  // bucket key = `${gx}|${gy}` with running aggregates
  const buckets = new Map<
    string,
    {
      sumLat: number;
      sumLon: number;
      count: number;
      first: Occurrence;
      statusCounts: Map<string, number>;
      minLat: number;
      maxLat: number;
      minLon: number;
      maxLon: number;
    }
  >();

  for (const r of rows) {
    if (r.LATITUDE == null || r.LONGITUDE == null) continue;
    const gx = Math.floor(r.LONGITUDE / cell);
    const gy = Math.floor(r.LATITUDE / cell);
    const key = `${gx}|${gy}`;
    const b = buckets.get(key);
    const status = r.STATUS_C ?? "";
    if (!b) {
      buckets.set(key, {
        sumLat: r.LATITUDE,
        sumLon: r.LONGITUDE,
        count: 1,
        first: r,
        statusCounts: new Map([[status, 1]]),
        minLat: r.LATITUDE,
        maxLat: r.LATITUDE,
        minLon: r.LONGITUDE,
        maxLon: r.LONGITUDE,
      });
    } else {
      b.sumLat += r.LATITUDE;
      b.sumLon += r.LONGITUDE;
      b.count += 1;
      b.statusCounts.set(status, (b.statusCounts.get(status) ?? 0) + 1);
      if (r.LATITUDE < b.minLat) b.minLat = r.LATITUDE;
      if (r.LATITUDE > b.maxLat) b.maxLat = r.LATITUDE;
      if (r.LONGITUDE < b.minLon) b.minLon = r.LONGITUDE;
      if (r.LONGITUDE > b.maxLon) b.maxLon = r.LONGITUDE;
    }
  }

  const items: ClusterItem[] = [];
  for (const [key, b] of buckets) {
    if (b.count === 1) {
      items.push({
        type: "point",
        id: b.first.id,
        lat: b.first.LATITUDE!,
        lon: b.first.LONGITUDE!,
        occurrence: b.first,
      });
    } else {
      // Pick the mode status; flag "mixed" if no clear majority (>60%).
      let topStatus = "";
      let topCount = 0;
      for (const [s, c] of b.statusCounts) {
        if (c > topCount) {
          topStatus = s;
          topCount = c;
        }
      }
      const mixed = topCount / b.count < 0.6;
      items.push({
        type: "cluster",
        id: `c:${key}`,
        lat: b.sumLat / b.count,
        lon: b.sumLon / b.count,
        count: b.count,
        dominantStatus: mixed ? null : topStatus || null,
        mixed,
        bbox: {
          minLat: b.minLat,
          maxLat: b.maxLat,
          minLon: b.minLon,
          maxLon: b.maxLon,
        },
      });
    }
  }
  return items;
}
