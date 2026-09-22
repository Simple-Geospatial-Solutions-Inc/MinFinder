// Pure rules: distances, limits and the trust tier. No I/O here, so test/api.test.ts can pin
// every threshold the pitch promised without a database or a network.
//
// The numbers are starting guesses (see the Community Mines pitch, "Open questions"). They live
// on the server on purpose: retuning them after the beta is a deploy, not an app release.

export const LIMITS = {
  maxAccuracyM: 30, // GPS accuracy the shutter demands; re-checked here
  maxNudgeM: 50, // pin may sit this far from where the phone stood
  userRadiusM: 100, // one submission per user per this radius
  duplicateRadiusM: 30, // someone else's public mine this close = confirm it, don't duplicate
  onSiteVoteM: 150, // a vote cast this close counts as on-site
  maxAgeDays: 30, // offline trips can queue captures this long
  futureSkewMs: 5 * 60_000,
  maxTravelKmh: 150, // faster than this between one user's captures is not walking
  submissionsPerDay: 10,
  votesPerDay: 60,
  probationCount: 3, // an account's first N submissions wait for staff
  photoDupMaxBits: 4, // dHash Hamming distance at or below this = same photo
  maxPhotos: 3,
  maxPhotoBytes: 12 * 1024 * 1024,
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

// A lat/lon box that contains every point within `m` metres, so SQL can prefilter with an index
// before distanceM() makes the exact call.
export function bboxAround(lat: number, lon: number, m: number) {
  const dLat = m / 111_320;
  const dLon = m / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

// Speed implied by two captures. The time floor stops two photos taken a second apart, a few
// metres apart, from reading as supersonic.
export function travelKmh(distM: number, dtMs: number): number {
  return distM / 1000 / (Math.max(Math.abs(dtMs), 60_000) / 3_600_000);
}

export type Tier = "pending" | "unverified" | "confirmed" | "verified" | "hidden";

export interface TierInput {
  approved: boolean; // false while the author's probation holds it for review
  staffVerified: boolean;
  net: number; // sum of votes, on-site ones counting double
  onSiteUp: number; // on-site upvotes from accounts other than the author
  reports: number;
}

export function tier(m: TierInput): Tier {
  if (!m.approved) return "pending";
  if (m.net <= -3 || m.reports >= 2) return "hidden";
  if (m.staffVerified) return "verified";
  if (m.net >= 3 && m.onSiteUp >= 1) return "confirmed";
  return "unverified";
}

export function isPublic(t: Tier): boolean {
  return t !== "pending" && t !== "hidden";
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
