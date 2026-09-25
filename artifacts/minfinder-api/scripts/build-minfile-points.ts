// Writes assets/minfile-points.json, {MINFILNO: [lat, lon, name]}, from the app's bundled MINFILE
// database. The server uses it to refuse field reports on unknown mines and to measure how far a
// reported point sits from the published one; the name is for the moderation page. Rerun whenever the app's minfile.db is rebuilt:
//
//   node scripts/build-minfile-points.ts
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = new URL("../../sgs-minfinder/assets/db/minfile.db", import.meta.url);
const out = new URL("../assets/minfile-points.json", import.meta.url);

const db = new DatabaseSync(src, { readOnly: true });
const rows = db
  .prepare("SELECT TRIM(MINFILNO) AS m, LATITUDE AS lat, LONGITUDE AS lon, TRIM(NAME1) AS name FROM minfile_occurrences WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL")
  .all() as { m: string; lat: number; lon: number; name: string | null }[];
db.close();

// 6 decimals is ~0.1 m, far finer than MINFILE's own precision.
const points: Record<string, [number, number, string]> = {};
for (const r of rows) points[r.m] = [+r.lat.toFixed(6), +r.lon.toFixed(6), r.name ?? ""];
if (rows.length < 10_000) throw new Error(`only ${rows.length} occurrences with coordinates, expected ~15,000`);
writeFileSync(out, JSON.stringify(points));
console.log(`wrote ${rows.length} points to ${out.pathname}`);
