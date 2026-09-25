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
-- One field report on an existing MINFILE mine: a located working (location), a search that
-- found nothing at the published spot (not_found), or a note written from anywhere.
-- id is the client's UUID: the device mints it offline, so a retried upload after a lost
-- response lands on the same row instead of creating a twin.
CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  minfilno TEXT NOT NULL,
  kind TEXT NOT NULL,                             -- 'location' | 'not_found' | 'note'
  label TEXT,                                     -- location only: adit, shaft, ...
  lat REAL, lon REAL,                             -- location: the pin; not_found: where they stood
  user_lat REAL, user_lon REAL,                   -- where the phone stood; null on a note
  accuracy_m REAL,
  captured_at INTEGER NOT NULL,                   -- the GPS fix time; upload time on a note
  search_radius_m INTEGER,                        -- not_found only
  distance_m REAL,                                -- from the published MINFILE point
  far_ack INTEGER NOT NULL DEFAULT 0,             -- the author confirmed a point over 300 m out
  visit_id TEXT,                                  -- groups the points from one outing
  text TEXT,
  approved INTEGER NOT NULL,                      -- 0 while probation or a hold keeps it for staff
  staff_verified INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,             -- kept as a tombstone so devices drop it
  attest TEXT,                                    -- the upload's attestation verdict
  hold TEXT,                                      -- the sensitive area that held it for review
  created_at INTEGER NOT NULL,
  seq INTEGER NOT NULL                            -- bumped on every change; the sync cursor
);
CREATE INDEX IF NOT EXISTS contributions_seq ON contributions (seq);
CREATE INDEX IF NOT EXISTS contributions_user ON contributions (user_id, captured_at);
CREATE INDEX IF NOT EXISTS contributions_mine ON contributions (minfilno);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  dhash TEXT NOT NULL                             -- 64-bit perceptual hash, hex
);
-- A visitor's verdict on someone else's report (value), or a "Helpful" on a note from anywhere.
-- Verdicts are only stored when the fix put them on site, so every nonzero value counts.
CREATE TABLE IF NOT EXISTS responses (
  contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL DEFAULT 0 CHECK (value IN (-1, 0, 1)), -- +1 confirm, -1 dispute
  helpful INTEGER NOT NULL DEFAULT 0,
  captured_at INTEGER NOT NULL,                   -- the responder's GPS fix time; decay runs from here
  created_at INTEGER NOT NULL,
  PRIMARY KEY (contribution_id, user_id)
);
CREATE INDEX IF NOT EXISTS responses_user ON responses (user_id, created_at);
CREATE TABLE IF NOT EXISTS reports (
  contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (contribution_id, user_id)
);
-- "Don't show me anything this member adds." Private to the blocker; authors never learn of it.
CREATE TABLE IF NOT EXISTS blocks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, author_id)
);
-- App Attest: one-time challenges for key registration, and each install's registered key.
CREATE TABLE IF NOT EXISTS attest_challenges (challenge TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attest_keys (
  key_id TEXT PRIMARY KEY,            -- base64, as the device names it
  public_key TEXT NOT NULL,           -- PEM
  counter INTEGER NOT NULL,           -- the last assertion's counter; must only go up
  env TEXT NOT NULL,                  -- production | development
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
INSERT OR IGNORE INTO meta VALUES ('seq', 0);
`;

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  // The pre-release "add a mine" schema. Its photos and reports tables clash with these, and
  // nothing in it was ever public, so the deploy moves the old file aside rather than migrating.
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'mines'").get()) {
    throw new Error(`${path} has the old mines schema: move it aside and start fresh`);
  }
  db.exec(SCHEMA);
  return db;
}

export function nextSeq(db: DB): number {
  return Number((db.prepare("UPDATE meta SET v = v + 1 WHERE k = 'seq' RETURNING v").get() as { v: number }).v);
}

export function bump(db: DB, id: string): void {
  db.prepare("UPDATE contributions SET seq = ? WHERE id = ?").run(nextSeq(db), id);
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

// Every read of a contribution goes through this, so the status inputs come from one place.
// Responses from the author are refused at write time; the author's own capture is counted in
// rules.ts instead.
export const CONTRIBUTION_SELECT = `
SELECT c.*,
  (SELECT json_group_array(json_array(r.value, r.captured_at)) FROM responses r WHERE r.contribution_id = c.id AND r.value <> 0) AS verdicts,
  (SELECT COUNT(*) FROM responses r WHERE r.contribution_id = c.id AND r.helpful = 1) AS helpful,
  (SELECT COUNT(*) FROM reports r WHERE r.contribution_id = c.id) AS reports,
  (SELECT json_group_array(p.id) FROM (SELECT id FROM photos WHERE contribution_id = c.id ORDER BY idx) p) AS photo_ids
FROM contributions c`;
