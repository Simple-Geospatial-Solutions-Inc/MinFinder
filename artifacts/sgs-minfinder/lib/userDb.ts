import * as SQLite from "expo-sqlite";

/**
 * The writable database for everything the user makes or the server sends: the
 * report outbox, the cached field reports and a small key/value table.
 *
 * Deliberately a separate file from minfile.db. That one is a bundled asset that
 * lib/db.ts deletes and re-copies whenever DB_VERSION changes, and user data must
 * never be in its way.
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS outbox (
  id         TEXT PRIMARY KEY,           -- the client UUID, also the server's id
  data       TEXT NOT NULL,              -- the submission JSON, as POSTed
  photos     TEXT NOT NULL,              -- JSON array of file:// uris we own
  state      TEXT NOT NULL DEFAULT 'queued', -- queued | rejected
  attempts   INTEGER NOT NULL DEFAULT 0,
  next_at    INTEGER NOT NULL DEFAULT 0, -- epoch ms before which sync skips it
  error      TEXT,                       -- the server's error code, or 'network'
  message    TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contributions (
  id       TEXT PRIMARY KEY,
  minfilno TEXT NOT NULL,              -- the MINFILE mine the report is about
  json     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contributions_minfilno ON contributions (minfilno);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// The pre-release "add a mine" build kept other members' mines here, and its
// queued captures can't be sent to the field-report API. Nothing of it was ever
// public, so it goes, and the sync cursor starts over against the new endpoint.
const DROP_ADD_A_MINE = `
DROP TABLE IF EXISTS community_mines;
DELETE FROM outbox WHERE json_extract(data, '$.kind') IS NULL;
DELETE FROM kv WHERE key IN ('cursor', 'my_submissions', 'my_votes', 'server_votes', 'pending_votes', 'blocks');
`;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getUserDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("user.db");
      const old = await db.getFirstAsync("SELECT 1 FROM sqlite_master WHERE name = 'community_mines'");
      await db.execAsync(SCHEMA);
      if (old) await db.execAsync(DROP_ADD_A_MINE);
      return db;
    })();
    // A failed open shouldn't poison every later call.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const db = await getUserDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM kv WHERE key = ?", [key]);
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await getUserDb();
  await db.runAsync("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", [key, JSON.stringify(value)]);
}
