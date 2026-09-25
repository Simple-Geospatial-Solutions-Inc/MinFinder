// Parks, protected areas, conservancies, ecological reserves and First Nations reserves: a new
// mine inside one is held for staff review whatever the account's history, so SGS never
// publishes a collecting target in a park or a pin on reserve land without a person looking.
// The boundaries come from assets/sensitive-areas.json (see scripts/build-sensitive-areas.ts).
import { readFileSync } from "node:fs";

export interface Area {
  kind: string;
  name: string;
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
  polys: number[][][]; // polygons -> rings -> flat [lon, lat, lon, lat, ...]
}

// Even-odd ray cast across every ring of a polygon, so holes (a private lot inside a park) count.
function inPolygon(rings: number[][], x: number, y: number): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const [xi, yi, xj, yj] = [r[i], r[i + 1], r[j], r[j + 1]];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function areaAt(areas: Area[], lat: number, lon: number): Area | null {
  for (const a of areas) {
    const [x0, y0, x1, y1] = a.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    if (a.polys.some((rings) => inPolygon(rings, lon, lat))) return a;
  }
  return null;
}

// ponytail: a linear bbox scan over ~2,700 areas, well under a millisecond per submission.
// An R-tree if the list or the traffic ever grows by orders of magnitude.
let loaded: Area[] | null = null;
function areas(): Area[] {
  loaded ??= JSON.parse(readFileSync(new URL("../assets/sensitive-areas.json", import.meta.url), "utf8")).areas as Area[];
  return loaded;
}

/** "Provincial park: GARIBALDI PARK" when the point is inside a sensitive area, else null. */
export function sensitiveAreaAt(lat: number, lon: number): string | null {
  const a = areaAt(areas(), lat, lon);
  return a ? `${a.kind}: ${a.name}` : null;
}
