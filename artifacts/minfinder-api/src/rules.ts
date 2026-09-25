// Pure rules: distances, limits and a report's status. No I/O here, so test/api.test.ts can pin
// every threshold the pitch promised without a database or a network.
//
// The numbers are starting guesses (see the Community Mines pitch, "Open questions"). They live
// on the server on purpose: retuning them after the beta is a deploy, not an app release.

export const LIMITS = {
  maxAccuracyM: 30, // GPS accuracy the app demands before it records a fix; re-checked here
  maxNudgeM: 30, // a located working's pin may sit this far from where the phone stood
  // A verdict on someone's point counts when the responder stood this close. Both fixes are at
  // most maxAccuracyM out, so they can read up to 60 m apart at the same spot; 75 m is that
  // plus a margin. Checks on not_found use the report's own search radius instead.
  onSiteM: 75,
  searchRadiiM: [50, 150, 300], // "I searched within ..." choices on a not_found
  farAckM: 300, // a point further than this from the published one needs the author's say-so
  maxFromPublishedM: 10_000, // further than this is a different mine
  maxAgeDays: 30, // offline trips can queue captures and verdicts this long
  futureSkewMs: 5 * 60_000,
  maxTravelKmh: 150, // faster than this between one user's captures is not walking
  submissionsPerDay: 10,
  responsesPerDay: 60,
  probationCount: 3, // an account's first N contributions wait for staff
  photoDupMaxBits: 4, // dHash Hamming distance at or below this = same photo
  maxPhotos: 3,
  maxPhotoBytes: 12 * 1024 * 1024,
  maxTextChars: 1000,
  halfLifeDays: 730, // a verdict loses half its weight every two years
} as const;

// ponytail: BC's bounding box, not its outline — it admits slivers of AK, WA, ID, MT and AB.
// Swap in the provincial polygon (point-in-polygon on BC's boundary) if junk lands there.
const BC_BBOX = { minLat: 48.2, maxLat: 60.0, minLon: -139.1, maxLon: -114.0 };

export function inBC(lat: number, lon: number): boolean {
  return lat >= BC_BBOX.minLat && lat <= BC_BBOX.maxLat && lon >= BC_BBOX.minLon && lon <= BC_BBOX.maxLon;
}

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

// Speed implied by two captures. The time floor stops two photos taken a second apart, a few
// metres apart, from reading as supersonic.
export function travelKmh(distM: number, dtMs: number): number {
  return distM / 1000 / (Math.max(Math.abs(dtMs), 60_000) / 3_600_000);
}

export type Status = "pending" | "unconfirmed" | "disputed" | "collapsed" | "confirmed" | "verified" | "hidden";

export interface StatusInput {
  approved: boolean; // false while probation or a hold keeps it for staff
  staffVerified: boolean;
  reports: number; // abuse flags, separate from accuracy verdicts
  kind: "location" | "not_found" | "note";
  capturedAt: number; // the author's fix: their capture is the first on-site confirm
  verdicts: [value: number, capturedAt: number][]; // other visitors' on-site +1 / -1
}

/** How much a visit made at `at` still counts at `now`: 1 today, 0.5 after one half-life. */
export function weight(at: number, now: number): number {
  return 0.5 ** (Math.max(0, now - at) / (LIMITS.halfLifeDays * 86_400_000));
}

// Agreement, not a score (iNaturalist's Research Grade): the share of weighted on-site visits that
// agree with the report. Notes have no visits, so they stay unconfirmed and sort by "Helpful".
export function status(c: StatusInput, now = Date.now()): Status {
  if (!c.approved) return "pending";
  if (c.reports >= 2) return "hidden";
  if (c.staffVerified) return "verified";
  if (c.kind === "note") return "unconfirmed";
  const visits: [number, number][] = [[1, c.capturedAt], ...c.verdicts];
  let agree = 0;
  let total = 0;
  for (const [v, at] of visits) {
    const w = weight(at, now);
    total += w;
    if (v > 0) agree += w;
  }
  const share = agree / total;
  const confirms = visits.filter(([v]) => v > 0).length;
  if (visits.length >= 2 && share < 1 / 3) return "collapsed";
  if (confirms >= 2 && share > 2 / 3) return "confirmed";
  if (visits.length >= 2 && share <= 2 / 3) return "disputed";
  return "unconfirmed";
}

export function isPublic(s: Status): boolean {
  return s !== "pending" && s !== "hidden";
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
