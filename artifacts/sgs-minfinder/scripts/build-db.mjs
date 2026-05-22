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
const outDir = resolve(here, "..", "assets", "db");
const outPath = resolve(outDir, "minfile.db");

if (!existsSync(sqlPath)) {
  console.error(`SQL dump not found at ${sqlPath}`);
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

db.exec(`
  CREATE INDEX idx_latlong ON minfile_occurrences (LATITUDE, LONGITUDE);
  CREATE INDEX idx_status  ON minfile_occurrences (STATUS_C);
  CREATE INDEX idx_minfilno ON minfile_occurrences (MINFILNO);
  CREATE INDEX idx_name1   ON minfile_occurrences (NAME1);
`);

const total = db.prepare("SELECT COUNT(*) AS n FROM minfile_occurrences").get();
const withCoords = db
  .prepare(
    "SELECT COUNT(*) AS n FROM minfile_occurrences WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL",
  )
  .get();

db.close();
console.log(`Inserted ${count} rows (total ${total.n}, with coords ${withCoords.n})`);
console.log(`DB written to ${outPath}`);
