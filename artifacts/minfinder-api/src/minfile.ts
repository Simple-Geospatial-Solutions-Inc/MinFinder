// Published MINFILE coordinates and names, {MINFILNO: [lat, lon, name]}, from assets/minfile-points.json (see
// scripts/build-minfile-points.ts). Occurrences without coordinates aren't in it: there's no
// published spot to correct or search, so the app can't open them on the map either.
import { readFileSync } from "node:fs";

let points: Record<string, [number, number, string]> | null = null;

export function publishedPoint(minfilno: string): { lat: number; lon: number; name: string } | null {
  points ??= JSON.parse(readFileSync(new URL("../assets/minfile-points.json", import.meta.url), "utf8")) as Record<string, [number, number, string]>;
  const p = points[minfilno];
  return p ? { lat: p[0], lon: p[1], name: p[2] } : null;
}
