import { DatabaseSync } from "node:sqlite";

// ponytail: one SQLite file on one VPS, written by one process. Move to Postgres/PostGIS if
// write concurrency or spatial queries outgrow it (the pitch estimates a few thousand
// submissions a year, which this handles with room to spare).

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,             -- 'apple' | 'google'
  sub TEXT NOT NULL,                  -- the provider's stable user id
  created_at INTEGER NOT NULL,
  banned INTEGER NOT NULL DEFAULT 0,
  UNIQUE (provider, sub)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,        -- sha256 of the bearer token; the token itself is never stored
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
-- id is the client's UUID: the device mints it offline, so a retried upload after a lost
-- response lands on the same row instead of creating a twin.
CREATE TABLE IF NOT EXISTS mines (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lat REAL NOT NULL, lon REAL NOT NULL,           -- the pin
  user_lat REAL NOT NULL, user_lon REAL NOT NULL, -- where the phone stood
  accuracy_m REAL NOT NULL,
  captured_at INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT, commodity TEXT, notes TEXT,
  hazards TEXT NOT NULL DEFAULT '[]',             -- JSON array
  approved INTEGER NOT NULL,                      -- 0 while probation holds it
  staff_verified INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,             -- kept as a tombstone so devices drop it
  created_at INTEGER NOT NULL,
  seq INTEGER NOT NULL                            -- bumped on every change; the sync cursor
);
CREATE INDEX IF NOT EXISTS mines_lat_lon ON mines (lat, lon);
CREATE INDEX IF NOT EXISTS mines_seq ON mines (seq);
CREATE INDEX IF NOT EXISTS mines_user ON mines (user_id, captured_at);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  mine_id TEXT NOT NULL REFERENCES mines(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  dhash TEXT NOT NULL                             -- 64-bit perceptual hash, hex
);
CREATE TABLE IF NOT EXISTS votes (
  mine_id TEXT NOT NULL REFERENCES mines(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  on_site INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (mine_id, user_id)
);
CREATE INDEX IF NOT EXISTS votes_user ON votes (user_id, created_at);
CREATE TABLE IF NOT EXISTS reports (
  mine_id TEXT NOT NULL REFERENCES mines(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (mine_id, user_id)
);
-- "Don't show me anything this member adds." Private to the blocker; authors never learn of it.
CREATE TABLE IF NOT EXISTS blocks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, author_id)
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
INSERT OR IGNORE INTO meta VALUES ('seq', 0);
`;

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

export function nextSeq(db: DB): number {
  return Number((db.prepare("UPDATE meta SET v = v + 1 WHERE k = 'seq' RETURNING v").get() as { v: number }).v);
}

export function bump(db: DB, mineId: string): void {
  db.prepare("UPDATE mines SET seq = ? WHERE id = ?").run(nextSeq(db), mineId);
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// Every read of a mine goes through this, so the vote maths lives in exactly one place.
// Votes and reports from the author never count (they're also refused at write time).
export const MINE_SELECT = `
SELECT m.*,
  COALESCE((SELECT SUM(v.value * (1 + v.on_site)) FROM votes v WHERE v.mine_id = m.id AND v.user_id IS NOT m.user_id), 0) AS net,
  (SELECT COUNT(*) FROM votes v WHERE v.mine_id = m.id AND v.value = 1 AND v.on_site = 1 AND v.user_id IS NOT m.user_id) AS on_site_up,
  (SELECT COUNT(*) FROM votes v WHERE v.mine_id = m.id AND v.value = 1) AS ups,
  (SELECT COUNT(*) FROM votes v WHERE v.mine_id = m.id AND v.value = -1) AS downs,
  (SELECT COUNT(*) FROM reports r WHERE r.mine_id = m.id) AS reports,
  (SELECT json_group_array(p.id) FROM (SELECT id FROM photos WHERE mine_id = m.id ORDER BY idx) p) AS photo_ids
FROM mines m`;
