// Builds data/sensitive-areas.json: the areas where a new community mine is held for staff review
// before it goes public (provincial parks, ecological reserves, protected areas, conservancies and
// First Nations reserves). Run from artifacts/minfinder-api when the boundaries change, a few
// times a year at most:
//
//   node scripts/build-sensitive-areas.ts
//
// Source: BC's open WFS (openmaps.gov.bc.ca). Parks, ecological reserves, protected areas and
// conservancies are Open Government Licence – British Columbia; reserve boundaries (CLAB) are
// Natural Resources Canada's, Open Government Licence – Canada. Recreation areas are left out:
// some mineral exploration is allowed in them.
//
// Boundaries are simplified to about 10 m and rounded to 5 decimals (about 1 m), which keeps the
// file small; a point a few metres from a boundary can land on either side.
import { writeFileSync } from "node:fs";

const WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs";
const LAYERS = [
  {
    type: "WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW",
    name: (p: any) => p.PROTECTED_LANDS_NAME,
    kind: (p: any) => ({ "PROVINCIAL PARK": "Provincial park", "ECOLOGICAL RESERVE": "Ecological reserve", "PROTECTED AREA": "Protected area" })[p.PROTECTED_LANDS_DESIGNATION as string],
  },
  { type: "WHSE_TANTALIS.TA_CONSERVANCY_AREAS_SVW", name: (p: any) => p.CONSERVANCY_AREA_NAME, kind: () => "Conservancy" },
  { type: "WHSE_ADMIN_BOUNDARIES.CLAB_INDIAN_RESERVES", name: (p: any) => p.ENGLISH_NAME, kind: () => "First Nations reserve" },
];
const TOLERANCE = 0.0001; // degrees, about 11 m north-south and 7 m east-west at BC's latitudes

type Pt = [number, number];

// Douglas-Peucker, iterative so a long coastline can't blow the stack.
function simplify(ring: Pt[]): Pt[] {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let far = -1;
    let farD = TOLERANCE;
    for (let i = a + 1; i < b; i++) {
      // A closed ring starts and ends on the same point: measure from that point instead.
      const d = len
        ? Math.abs(dy * ring[i][0] - dx * ring[i][1] + bx * ay - by * ax) / len
        : Math.hypot(ring[i][0] - ax, ring[i][1] - ay);
      if (d > farD) [far, farD] = [i, d];
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring; // a small ring that collapsed keeps its real outline
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;

async function fetchLayer(type: string): Promise<any[]> {
  const out: any[] = [];
  for (let start = 0; ; start += 200) {
    const url = `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeName=pub:${type}&outputFormat=json&srsName=EPSG:4326&sortBy=OBJECTID&count=200&startIndex=${start}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${type}: HTTP ${r.status}`);
    const page = (await r.json()) as { features: any[] };
    out.push(...page.features);
    if (page.features.length < 200) return out;
  }
}

const areas = [];
for (const layer of LAYERS) {
  const features = await fetchLayer(layer.type);
  let kept = 0;
  for (const f of features) {
    const kind = layer.kind(f.properties);
    if (!kind || !f.geometry) continue;
    const polys: Pt[][][] = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = polys.map((poly) => poly.map((ring) => simplify(ring).flatMap(([x, y]) => [round(x), round(y)])));
    const xs = rings.flat(2).filter((_, i) => i % 2 === 0);
    const ys = rings.flat(2).filter((_, i) => i % 2 === 1);
    areas.push({
      kind,
      name: String(layer.name(f.properties) ?? "").trim(),
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      polys: rings,
    });
    kept++;
  }
  console.log(`${layer.type}: ${kept} of ${features.length}`);
}

const file = new URL("../data/sensitive-areas.json", import.meta.url);
writeFileSync(file, JSON.stringify({ built: new Date().toISOString().slice(0, 10), areas }));
console.log(`wrote ${areas.length} areas`);
