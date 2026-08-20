import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";

export interface Occurrence {
  id: number;
  MINFILNO: string | null;
  NAME1: string | null;
  NAME2: string | null;
  STATUS_C: string | null;
  STATUS_D: string | null;
  LATITUDE: number | null;
  LONGITUDE: number | null;
  UTM_ZONE: string | null;
  UTM_NORT: string | null;
  UTM_EAST: string | null;
  ELEV: string | null;
  HOSTROCK: string | null;
  DEPOSIT_CLASS: string | null;
  LAT_DEG: string | null;
  LAT_MIN: string | null;
  LAT_SEC: string | null;
  LAT_HEMI: string | null;
  LONG_DEG: string | null;
  LONG_MIN: string | null;
  LONG_SEC: string | null;
  LONG_HEMI: string | null;
  N83_ZONE: string | null;
  N83_EAST: string | null;
  N83_NORT: string | null;
}

const DB_NAME = "minfile.db";
// Bump this when the bundled DB file changes so the on-device copy is replaced.
const DB_VERSION = "3";
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function copyAssetToDocumentsAsync(): Promise<void> {
  if (Platform.OS === "web") return;
  const sqliteDir = `${FileSystem.documentDirectory}SQLite`;
  const dest = `${sqliteDir}/${DB_NAME}`;
  const versionMarker = `${sqliteDir}/${DB_NAME}.v${DB_VERSION}`;

  const dirInfo = await FileSystem.getInfoAsync(sqliteDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(sqliteDir, { intermediates: true });
  }

  const markerInfo = await FileSystem.getInfoAsync(versionMarker);
  if (markerInfo.exists) return;

  // Stale or missing copy — remove and re-copy from the bundled asset.
  const dbInfo = await FileSystem.getInfoAsync(dest);
  if (dbInfo.exists) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const asset = Asset.fromModule(require("../assets/db/minfile.db"));
  await asset.downloadAsync();
  // `localUri` first, and `||` not `??`: once expo-updates is enabled, expo-asset
  // resolves bundled assets through the updates asset store and deliberately
  // reports `asset.uri` as an EMPTY STRING (there is no remote URL to fetch) —
  // which `??` happily passes through, breaking the copy. In dev, Metro serves
  // the asset over HTTP and only `uri` is set.
  const src = asset.localUri || asset.uri;
  if (!src) {
    throw new Error("Failed to resolve bundled minfile.db asset URI");
  }
  if (/^https?:/.test(src)) {
    // Metro dev server. `downloadAsync` (not `copyAsync`) reliably writes the raw
    // bytes and avoids the binary corruption that copying from Metro's cache can
    // produce.
    await FileSystem.downloadAsync(src, dest);
  } else {
    // A local file, either embedded in the app or in the updates asset store.
    // This has to be a copy: on Android `downloadAsync` hands the URL to OkHttp,
    // which rejects anything that isn't http(s).
    await FileSystem.copyAsync({ from: src, to: dest });
  }

  // Write version marker only after a successful copy.
  await FileSystem.writeAsStringAsync(versionMarker, DB_VERSION);
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      await copyAssetToDocumentsAsync();
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      return db;
    })();
  }
  return dbPromise;
}

export interface BBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface QueryOptions {
  bbox?: BBox;
  statuses?: string[];
  limit?: number;
}

export async function queryOccurrences(
  opts: QueryOptions = {},
): Promise<Occurrence[]> {
  const db = await getDb();
  const where: string[] = ["LATITUDE IS NOT NULL", "LONGITUDE IS NOT NULL"];
  const params: (string | number)[] = [];

  if (opts.bbox) {
    where.push("LATITUDE BETWEEN ? AND ?");
    params.push(opts.bbox.minLat, opts.bbox.maxLat);
    where.push("LONGITUDE BETWEEN ? AND ?");
    params.push(opts.bbox.minLon, opts.bbox.maxLon);
  }

  if (opts.statuses && opts.statuses.length > 0) {
    const placeholders = opts.statuses.map(() => "?").join(",");
    where.push(`STATUS_C IN (${placeholders})`);
    params.push(...opts.statuses);
  }

  const limit = opts.limit ?? 5000;
  const sql = `SELECT * FROM minfile_occurrences WHERE ${where.join(" AND ")} LIMIT ${limit}`;
  return (await db.getAllAsync<Occurrence>(sql, params)) as Occurrence[];
}

export async function getOccurrenceById(id: number): Promise<Occurrence | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Occurrence>(
    "SELECT * FROM minfile_occurrences WHERE id = ?",
    [id],
  );
  return row ?? null;
}

/** One of an occurrence's names. Rank 1 is the primary name, i.e. NAME1. */
export interface OccurrenceName {
  name: string;
  rank: number;
}

/**
 * Why a search row matched, best first: an exact name, a name prefix, a name
 * substring, or only the MINFILNO.
 */
export type MatchTier = 0 | 1 | 2 | 3;

/**
 * A search result: the occurrence plus which of its names the query matched.
 * `matchedName` is null when only the MINFILNO matched — use `hitTitle` rather
 * than reading it directly.
 */
export interface SearchHit extends Occurrence {
  matchedName: string | null;
  matchedRank: number | null;
  matchTier: MatchTier;
}

export interface SearchOptions {
  statuses?: string[];
  limit?: number;
}

// `%` and `_` are LIKE wildcards and `\` is our ESCAPE character, so all three
// have to be escaped — otherwise someone typing "50%" matches every name
// containing "50".
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Search every name MINFILE records for an occurrence, not just NAME1/NAME2 —
 * most occurrences have several, and a prospector is as likely to know a
 * historical claim name as the current one.
 *
 * Deliberately separate from `queryOccurrences`, which loads all 16k rows at
 * mount and must not pay for the names join.
 *
 * Each occurrence appears at most once, tagged with the name that matched, and
 * rows come back best-first: exact name, name prefix, name substring, then a
 * MINFILNO-only hit. Within a tier the lower rank wins, so a primary-name hit
 * outranks an alias. Ordering before the LIMIT is what keeps an exact match from
 * being cut off by a flood of substring matches.
 */
export async function searchOccurrences(
  term: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  const q = term.trim();
  if (q.length === 0) return [];

  const db = await getDb();
  // `$term` is compared with `=`, not LIKE, so it must NOT be escaped. The
  // column is COLLATE NOCASE and LIKE is already case-insensitive for ASCII, so
  // nothing here folds case.
  const params: Record<string, string | number> = {
    $term: q,
    $prefix: `${escapeLike(q)}%`,
    $sub: `%${escapeLike(q)}%`,
  };

  // Narrowing the occurrence set first means the names scan joins against less.
  let statusFilter = "";
  if (opts.statuses && opts.statuses.length > 0) {
    const keys = opts.statuses.map((_, i) => `$s${i}`);
    statusFilter = `AND STATUS_C IN (${keys.join(",")})`;
    opts.statuses.forEach((code, i) => {
      params[`$s${i}`] = code;
    });
  }
  const limit = opts.limit ?? 50;

  // There is no index for `name LIKE '%...%'` and there cannot be, so this scans
  // all ~51k names. That is well under the 250 ms debounce in front of it.
  // COALESCE keeps the MINFILNO-only rows (null name and rank) from sorting to
  // the top, since SQLite sorts NULL lowest.
  const sql = `
    WITH occ AS (
      SELECT id, MINFILNO
      FROM minfile_occurrences
      WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL
        ${statusFilter}
    ),
    hits(oid, matched_name, matched_rank, tier) AS (
      SELECT n.occurrence_id, n.name, n.rank,
             CASE
               WHEN n.name = $term THEN 0
               WHEN n.name LIKE $prefix ESCAPE '\\' THEN 1
               ELSE 2
             END
      FROM minfile_names n
      JOIN occ ON occ.id = n.occurrence_id
      WHERE n.name LIKE $sub ESCAPE '\\'
      UNION ALL
      SELECT occ.id, NULL, NULL, 3
      FROM occ
      WHERE occ.MINFILNO LIKE $sub ESCAPE '\\'
    ),
    best AS (
      SELECT oid, matched_name, matched_rank, tier,
             ROW_NUMBER() OVER (
               PARTITION BY oid
               ORDER BY tier,
                        COALESCE(matched_rank, 99),
                        COALESCE(LENGTH(matched_name), 99),
                        matched_name
             ) AS rn
      FROM hits
    )
    SELECT o.*,
           b.matched_name AS matchedName,
           b.matched_rank AS matchedRank,
           b.tier         AS matchTier
    FROM best b
    JOIN minfile_occurrences o ON o.id = b.oid
    WHERE b.rn = 1
    ORDER BY b.tier,
             COALESCE(b.matched_rank, 99),
             COALESCE(LENGTH(b.matched_name), 99),
             b.matched_name
    LIMIT ${limit}`;

  return (await db.getAllAsync<SearchHit>(sql, params)) as SearchHit[];
}

/** Every name for one occurrence, primary first. */
export async function getNamesForOccurrence(
  id: number,
): Promise<OccurrenceName[]> {
  const db = await getDb();
  return await db.getAllAsync<OccurrenceName>(
    "SELECT name, rank FROM minfile_names WHERE occurrence_id = ? ORDER BY rank",
    [id],
  );
}

/** A search row's title: the name that matched, else the primary name. */
export function hitTitle(hit: SearchHit): string {
  return hit.matchedName ?? (hit.NAME1?.trim() || "Unnamed");
}

/**
 * True when the query matched an alias rather than the primary name, so the row
 * should show the primary name underneath for orientation. A rank-1 or
 * MINFILNO-only hit needs no such context.
 */
export function hitIsAlias(hit: SearchHit): boolean {
  return hit.matchedRank != null && hit.matchedRank > 1;
}

/**
 * Drop the search-only fields. Occurrence consumers should see the same shape
 * whether the user arrived from a map tap or the search bar.
 */
export function toOccurrence(hit: SearchHit): Occurrence {
  const { matchedName, matchedRank, matchTier, ...occurrence } = hit;
  return occurrence;
}

// How many occurrences fall inside a box. Used by the offline-region rows,
// which have no rows in memory (unlike the map screen) — so this counts in
// SQLite rather than materialising and measuring a result set.
export async function countOccurrencesInBbox(b: BBox): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM minfile_occurrences
     WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL
       AND LATITUDE BETWEEN ? AND ? AND LONGITUDE BETWEEN ? AND ?`,
    [b.minLat, b.maxLat, b.minLon, b.maxLon],
  );
  return r?.n ?? 0;
}

export async function countAll(): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM minfile_occurrences",
  );
  return r?.n ?? 0;
}
