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
const DB_VERSION = "2";
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
  // In Expo Go (dev), `asset.uri` is a Metro HTTP URL; in production it's a
  // bundled file path. `downloadAsync` handles both and reliably writes the
  // raw bytes to disk (avoids the binary-corruption issues that can occur
  // when `copyAsync` reads from Metro's dev-server cache).
  const src = asset.uri ?? asset.localUri;
  if (!src) {
    throw new Error("Failed to resolve bundled minfile.db asset URI");
  }
  await FileSystem.downloadAsync(src, dest);

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
  search?: string;
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

  if (opts.search && opts.search.trim().length > 0) {
    const q = `%${opts.search.trim().toUpperCase()}%`;
    where.push(
      "(UPPER(NAME1) LIKE ? OR UPPER(NAME2) LIKE ? OR UPPER(MINFILNO) LIKE ?)",
    );
    params.push(q, q, q);
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
