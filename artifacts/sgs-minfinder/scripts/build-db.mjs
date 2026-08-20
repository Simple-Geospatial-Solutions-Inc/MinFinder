#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const sqlPath = resolve(
  root,
  "attached_assets/minfile_occurrences_1779413839362.sql",
);
// Every name MINFILE records for each occurrence, one row per name, exported
// from the upstream .accdb by scripts/export-minfile-names.ps1. The occurrence
// dump above only carries the first two.
const namesCsvPath = resolve(root, "attached_assets/minfile_names.csv");
const outDir = resolve(here, "..", "assets", "db");
const outPath = resolve(outDir, "minfile.db");

if (!existsSync(sqlPath)) {
  console.error(`SQL dump not found at ${sqlPath}`);
  process.exit(1);
}
if (!existsSync(namesCsvPath)) {
  console.error(
    `Names CSV not found at ${namesCsvPath} — run scripts/export-minfile-names.ps1`,
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
if (existsSync(outPath)) unlinkSync(outPath);

const db = new DatabaseSync(outPath);

db.exec(`
  CREATE TABLE minfile_occurrences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    MINFILNO TEXT,
    NAME1 TEXT,
    NAME2 TEXT,
    STATUS_C TEXT,
    STATUS_D TEXT,
    LATITUDE REAL,
    LONGITUDE REAL,
    UTM_ZONE TEXT,
    UTM_NORT TEXT,
    UTM_EAST TEXT,
    ELEV TEXT,
    HOSTROCK TEXT,
    DEPOSIT_CLASS TEXT,
    LAT_DEG TEXT,
    LAT_MIN TEXT,
    LAT_SEC TEXT,
    LAT_HEMI TEXT,
    LONG_DEG TEXT,
    LONG_MIN TEXT,
    LONG_SEC TEXT,
    LONG_HEMI TEXT,
    N83_ZONE TEXT,
    N83_EAST TEXT,
    N83_NORT TEXT
  );
`);

const sql = readFileSync(sqlPath, "utf8");

// Split the INSERTs (preserve full statements). Each INSERT ends with );\n.
// We feed them line-by-line as the dump is one INSERT per line after the header.
const lines = sql.split(/\r?\n/);
const insert = db.prepare(`
  INSERT INTO minfile_occurrences (
    MINFILNO, NAME1, NAME2, STATUS_C, STATUS_D, LATITUDE, LONGITUDE,
    UTM_ZONE, UTM_NORT, UTM_EAST, ELEV, HOSTROCK, DEPOSIT_CLASS,
    LAT_DEG, LAT_MIN, LAT_SEC, LAT_HEMI,
    LONG_DEG, LONG_MIN, LONG_SEC, LONG_HEMI,
    N83_ZONE, N83_EAST, N83_NORT
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`);

// Parse a "VALUES (...)" tuple from a line.
function parseValues(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    // skip whitespace and commas
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (i >= text.length) break;
    const ch = text[i];
    if (ch === "'") {
      // string: handle '' as escaped quote
      i++;
      let s = "";
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += text[i++];
      }
      out.push(s);
    } else if (ch === "N" && text.slice(i, i + 4).toUpperCase() === "NULL") {
      out.push(null);
      i += 4;
    } else {
      // number
      let s = "";
      while (i < text.length && !/[,\s)]/.test(text[i])) s += text[i++];
      out.push(s === "" ? null : Number(s));
    }
  }
  return out;
}

// Rows are `MINFILNO,RANK,"NAME"`. Only the trailing NAME is quoted, and it is
// the only field that can contain a comma, so splitting on the first two commas
// is enough — no general CSV parser needed.
function parseNamesCsv(text) {
  const out = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    const c1 = line.indexOf(",");
    const c2 = line.indexOf(",", c1 + 1);
    if (c1 < 0 || c2 < 0) {
      console.error("Malformed names CSV line:", line.slice(0, 120));
      continue;
    }
    let name = line.slice(c2 + 1);
    if (name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1).replace(/""/g, '"');
    }
    out.push({
      minfilno: line.slice(0, c1),
      rank: Number(line.slice(c1 + 1, c2)),
      name,
    });
  }
  return out;
}

db.exec("BEGIN");
let count = 0;
for (const raw of lines) {
  const line = raw.trim();
  if (!line.startsWith("(")) continue;
  // Strip leading "(" and trailing ")" or "),"
  let body = line;
  if (body.endsWith(";")) body = body.slice(0, -1);
  if (body.endsWith(",")) body = body.slice(0, -1);
  if (body.endsWith(")")) body = body.slice(1, -1);
  else continue;
  const vals = parseValues(body);
  if (vals.length < 24) {
    // pad missing
    while (vals.length < 24) vals.push(null);
  }
  try {
    insert.run(...vals.slice(0, 24));
    count++;
  } catch (err) {
    console.error("Failed line:", line.slice(0, 120), err.message);
  }
}
db.exec("COMMIT");

// MINFILE keeps up to 20 names per occurrence (~51k in total) and a prospector
// is as likely to know a historical claim name as the current one, so all of
// them are searchable. Keyed back to the occurrence by MINFILNO, which is unique
// and non-null on every row — `id` above is only insertion order, not a MINFILE
// identifier.
//
// COLLATE NOCASE lets the search's exact-match tier use `=` without folding case
// at query time (LIKE is already ASCII-case-insensitive). WITHOUT ROWID makes
// the primary key the table itself, so reading one occurrence's names is a
// covering seek. There is deliberately no index on `name`: the search is
// `name LIKE '%…%'`, which no B-tree can serve, and adding one measurably slows
// the query while costing ~1.2 MB in a bundled asset.
db.exec(`
  CREATE TABLE minfile_names (
    occurrence_id INTEGER NOT NULL REFERENCES minfile_occurrences(id),
    name          TEXT    NOT NULL COLLATE NOCASE,
    rank          INTEGER NOT NULL,
    PRIMARY KEY (occurrence_id, rank)
  ) WITHOUT ROWID;
`);

const idByMinfilno = new Map(
  db
    .prepare("SELECT id, TRIM(MINFILNO) AS m FROM minfile_occurrences")
    .all()
    .map((r) => [r.m, r.id]),
);
const insertName = db.prepare(
  "INSERT INTO minfile_names (occurrence_id, name, rank) VALUES (?, ?, ?)",
);

db.exec("BEGIN");
let nameCount = 0;
let unresolved = 0;
for (const { minfilno, rank, name } of parseNamesCsv(
  readFileSync(namesCsvPath, "utf8"),
)) {
  const id = idByMinfilno.get(minfilno);
  if (id === undefined) {
    unresolved++;
    continue;
  }
  insertName.run(id, name, rank);
  nameCount++;
}
db.exec("COMMIT");

// Ranks 1 and 2 *are* NAME1 and NAME2 — except the original export sorted the
// rank as text, so `10` sorted straight after `1` and 507 occurrences shipped
// their tenth name as NAME2. Re-deriving both from the names table fixes that
// without touching any of the NAME1 readers in the app, and stops the two
// representations of the same fact from drifting.
const stale = db
  .prepare(
    `SELECT COUNT(*) AS n
       FROM minfile_occurrences o
       JOIN minfile_names m ON m.occurrence_id = o.id AND m.rank <= 2
      WHERE m.name <> (CASE m.rank WHEN 1 THEN o.NAME1 ELSE o.NAME2 END) COLLATE BINARY`,
  )
  .get();
db.exec(`
  UPDATE minfile_occurrences SET
    NAME1 = COALESCE(
      (SELECT name FROM minfile_names WHERE occurrence_id = id AND rank = 1), NAME1),
    NAME2 = COALESCE(
      (SELECT name FROM minfile_names WHERE occurrence_id = id AND rank = 2), '');
`);

db.exec(`
  CREATE INDEX idx_latlong ON minfile_occurrences (LATITUDE, LONGITUDE);
  CREATE INDEX idx_status  ON minfile_occurrences (STATUS_C);
  CREATE INDEX idx_minfilno ON minfile_occurrences (MINFILNO);
  CREATE INDEX idx_name1   ON minfile_occurrences (NAME1);
`);

// A half-populated names table would quietly degrade search, so fail the build
// rather than ship one.
if (unresolved > 0) {
  throw new Error(`${unresolved} name rows had no matching MINFILNO`);
}
if (nameCount < 50_000) {
  throw new Error(`only ${nameCount} name rows inserted, expected ~51,100`);
}
const drift = db
  .prepare(
    `SELECT COUNT(*) AS n
       FROM minfile_occurrences o
       JOIN minfile_names m ON m.occurrence_id = o.id AND m.rank <= 2
      WHERE m.name <> (CASE m.rank WHEN 1 THEN o.NAME1 ELSE o.NAME2 END) COLLATE BINARY`,
  )
  .get();
if (drift.n > 0) {
  throw new Error(`${drift.n} occurrences where NAME1/NAME2 != rank 1/2`);
}

// Bake the planner's selectivity stats into the bundled file so the first search
// on a cold device doesn't pay for them.
db.exec("ANALYZE");

const total = db.prepare("SELECT COUNT(*) AS n FROM minfile_occurrences").get();
const withCoords = db
  .prepare(
    "SELECT COUNT(*) AS n FROM minfile_occurrences WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL",
  )
  .get();

const named = db
  .prepare("SELECT COUNT(DISTINCT occurrence_id) AS n FROM minfile_names")
  .get();
const maxRank = db.prepare("SELECT MAX(rank) AS n FROM minfile_names").get();

db.close();
console.log(`Inserted ${count} rows (total ${total.n}, with coords ${withCoords.n})`);
console.log(
  `Inserted ${nameCount} names for ${named.n} occurrences (max ${maxRank.n} each)`,
);
console.log(`Corrected NAME1/NAME2 on ${stale.n} rows to match ranks 1-2`);
console.log(`DB written to ${outPath}`);
