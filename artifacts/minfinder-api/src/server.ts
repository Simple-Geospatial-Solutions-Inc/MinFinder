import { mkdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isProvider, sessionUser, signIn, verifyIdToken } from "./auth.ts";
import { bump, MINE_SELECT, nextSeq, openDb, tx, type DB } from "./db.ts";
import { adminGate, adminPage } from "./adminPage.ts";
import { ACTIONS, moderate, type Action } from "./moderation.ts";
import { processPhoto } from "./photos.ts";
import { bboxAround, distanceM, hamming, inBC, isPublic, LIMITS, tier, travelKmh, type Tier } from "./rules.ts";

const MINE_TYPES = ["adit", "shaft", "open_pit", "trench", "prospect_pit", "tailings", "structure", "other"] as const;
const HAZARDS = ["open_shaft", "unstable_portal", "flooded", "bad_air", "other"] as const;
const REPORT_REASONS = ["not_a_mine", "wrong_location", "photo_not_this_site", "duplicate", "inappropriate", "dangerous", "other"] as const;

const Submission = z.object({
  id: z.string().uuid(),
  lat: z.number().finite(),
  lon: z.number().finite(),
  user_lat: z.number().finite(),
  user_lon: z.number().finite(),
  accuracy_m: z.number().positive(),
  mocked: z.literal(false), // Android's mock-location flag; the app refuses to capture when true
  captured_at: z.number().int(), // epoch ms, taken from the GPS fix rather than the phone clock
  type: z.enum(MINE_TYPES),
  name: z.string().trim().max(80).optional(),
  commodity: z.string().trim().max(40).optional(),
  hazards: z.array(z.enum(HAZARDS)).max(HAZARDS.length).default([]),
  notes: z.string().trim().max(500).optional(),
  safety_ack: z.literal(true),
});

const Vote = z.object({
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  lat: z.number().finite().optional(),
  lon: z.number().finite().optional(),
  accuracy_m: z.number().positive().optional(),
});

const Report = z.object({ reason: z.enum(REPORT_REASONS) });

class HttpError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message = code, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

type Row = Record<string, any>;

function tierOf(m: Row): Tier {
  return tier({
    approved: !!m.approved,
    staffVerified: !!m.staff_verified,
    net: m.net,
    onSiteUp: m.on_site_up,
    reports: m.reports,
  });
}

// The public face of a mine. No user id: voters see "a community member", never who.
function serialize(m: Row) {
  return {
    id: m.id,
    lat: m.lat,
    lon: m.lon,
    type: m.type,
    name: m.name,
    commodity: m.commodity,
    hazards: JSON.parse(m.hazards),
    notes: m.notes,
    captured_at: m.captured_at,
    nudge_m: Math.round(distanceM(m.lat, m.lon, m.user_lat, m.user_lon)),
    tier: tierOf(m),
    net: m.net,
    ups: m.ups,
    downs: m.downs,
    on_site_up: m.on_site_up,
    photos: JSON.parse(m.photo_ids),
    seq: m.seq,
  };
}

function getMine(db: DB, id: string): Row | undefined {
  return db.prepare(`${MINE_SELECT} WHERE m.id = ?`).get(id) as Row | undefined;
}

function nearby(db: DB, lat: number, lon: number, m: number, where: string, ...args: unknown[]): Row[] {
  const b = bboxAround(lat, lon, m);
  return (
    db
      .prepare(`${MINE_SELECT} WHERE m.lat BETWEEN ? AND ? AND m.lon BETWEEN ? AND ? AND m.removed = 0 AND ${where}`)
      .all(b.minLat, b.maxLat, b.minLon, b.maxLon, ...(args as any[])) as Row[]
  ).filter((r) => distanceM(lat, lon, r.lat, r.lon) <= m);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_384) throw new HttpError(413, "body_too_large");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

function parse<T>(schema: z.ZodType<T, any, any>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, "invalid", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

// ponytail: fixed one-minute window per IP, in memory, reset on restart. The per-user daily
// limits in the database are the real brake; this only blunts a script hammering sign-in.
const hits = new Map<string, { window: number; n: number }>();
function rateLimit(ip: string) {
  const window = Math.floor(Date.now() / 60_000);
  const h = hits.get(ip);
  if (!h || h.window !== window) {
    if (hits.size > 50_000) hits.clear();
    hits.set(ip, { window, n: 1 });
  } else if (++h.n > 120) throw new HttpError(429, "slow_down");
}

export interface AppOptions {
  db: DB;
  photoDir: string;
}

export function createApp({ db, photoDir }: AppOptions) {
  mkdirSync(photoDir, { recursive: true });
  const photoPath = (id: string, thumb: boolean) => join(photoDir, `${id}${thumb ? "_t" : ""}.jpg`);

  function requireUser(req: IncomingMessage): number {
    const uid = sessionUser(db, req.headers.authorization);
    if (uid === null) throw new HttpError(401, "sign_in_required");
    return uid;
  }

  async function submit(req: IncomingMessage) {
    const uid = requireUser(req);
    if (process.env.SUBMISSIONS_ENABLED === "false") throw new HttpError(503, "submissions_paused");
    // Caddy caps the body at the edge (request_body in the site block); this refuses early
    // when the client is honest about the length.
    if (Number(req.headers["content-length"] ?? 0) > LIMITS.maxPhotos * LIMITS.maxPhotoBytes + 65_536) {
      throw new HttpError(413, "body_too_large");
    }

    let form: FormData;
    try {
      form = await new Request("http://local/", {
        method: "POST",
        headers: req.headers as Record<string, string>,
        body: req as any,
        duplex: "half",
      } as RequestInit).formData();
    } catch {
      throw new HttpError(400, "bad_multipart");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get("data") ?? ""));
    } catch {
      throw new HttpError(400, "bad_json", "the 'data' part must be JSON");
    }
    const s = parse(Submission, raw);
    const files = form.getAll("photo").filter((f): f is File => f instanceof File);

    // A retry of an upload that already landed: answer with what we stored, before spending
    // any CPU on photos.
    const existing = db.prepare("SELECT user_id FROM mines WHERE id = ?").get(s.id) as Row | undefined;
    if (existing) {
      if (existing.user_id !== uid) throw new HttpError(409, "id_taken");
      return { status: 200, body: { mine: serialize(getMine(db, s.id)!) } };
    }

    if (files.length < 1 || files.length > LIMITS.maxPhotos) throw new HttpError(400, "photos", `send 1 to ${LIMITS.maxPhotos} photos`);
    if (files.some((f) => f.size > LIMITS.maxPhotoBytes)) throw new HttpError(413, "photo_too_large");
    if (s.accuracy_m > LIMITS.maxAccuracyM) throw new HttpError(422, "gps_inaccurate", `GPS accuracy must be ${LIMITS.maxAccuracyM} m or better`);
    if (!inBC(s.lat, s.lon) || !inBC(s.user_lat, s.user_lon)) throw new HttpError(422, "outside_bc");
    if (distanceM(s.lat, s.lon, s.user_lat, s.user_lon) > LIMITS.maxNudgeM) throw new HttpError(422, "pin_too_far", `the pin must be within ${LIMITS.maxNudgeM} m of where you stood`);
    const now = Date.now();
    if (s.captured_at > now + LIMITS.futureSkewMs) throw new HttpError(422, "captured_in_future");
    if (s.captured_at < now - LIMITS.maxAgeDays * 86_400_000) throw new HttpError(422, "capture_too_old", `captures older than ${LIMITS.maxAgeDays} days can't be uploaded`);

    let processed;
    try {
      processed = await Promise.all(files.map(async (f) => processPhoto(new Uint8Array(await f.arrayBuffer()))));
    } catch {
      throw new HttpError(422, "not_an_image");
    }
    const photoIds = processed.map(() => randomUUID());
    await Promise.all(
      processed.flatMap((p, i) => [writeFile(photoPath(photoIds[i], false), p.full), writeFile(photoPath(photoIds[i], true), p.thumb)]),
    );

    try {
      // Everything from here is synchronous, so the checks and the insert are atomic against
      // any other request in this process.
      return tx(db, () => {
        const again = db.prepare("SELECT user_id FROM mines WHERE id = ?").get(s.id) as Row | undefined;
        if (again) {
          if (again.user_id !== uid) throw new HttpError(409, "id_taken");
          throw new HttpError(200, "already_stored"); // raced with its own retry; photos cleaned below
        }

        const today = db.prepare("SELECT COUNT(*) AS n FROM mines WHERE user_id = ? AND created_at > ?").get(uid, now - 86_400_000) as Row;
        if (today.n >= LIMITS.submissionsPerDay) throw new HttpError(429, "daily_limit", `${LIMITS.submissionsPerDay} submissions a day`);

        if (nearby(db, s.lat, s.lon, LIMITS.userRadiusM, "m.user_id = ?", uid).length) {
          throw new HttpError(409, "too_close_to_yours", `you already submitted a mine within ${LIMITS.userRadiusM} m`);
        }
        const dup = nearby(db, s.lat, s.lon, LIMITS.duplicateRadiusM, "m.user_id IS NOT ?", uid).find((r) => isPublic(tierOf(r)));
        if (dup) throw new HttpError(409, "duplicate", "a community mine is already here; confirm it instead", { mine_id: dup.id });

        // Impossible travel: compare against this user's captures either side in time.
        const neighbours = db
          .prepare(
            `SELECT * FROM (SELECT user_lat, user_lon, captured_at FROM mines WHERE user_id = ? AND captured_at <= ? ORDER BY captured_at DESC LIMIT 1)
             UNION ALL SELECT * FROM (SELECT user_lat, user_lon, captured_at FROM mines WHERE user_id = ? AND captured_at > ? ORDER BY captured_at ASC LIMIT 1)`,
          )
          .all(uid, s.captured_at, uid, s.captured_at) as Row[];
        for (const n of neighbours) {
          if (travelKmh(distanceM(n.user_lat, n.user_lon, s.user_lat, s.user_lon), n.captured_at - s.captured_at) > LIMITS.maxTravelKmh) {
            throw new HttpError(422, "impossible_travel", "this capture is too far from your previous one for the time between them");
          }
        }

        // ponytail: linear scan of every stored hash. Fine into the tens of thousands of photos;
        // a BK-tree or multi-index hashing if it ever isn't.
        const hashes = (db.prepare("SELECT dhash FROM photos").all() as Row[]).map((r) => BigInt("0x" + r.dhash));
        if (processed.some((p) => hashes.some((h) => hamming(h, p.dhash) <= LIMITS.photoDupMaxBits))) {
          throw new HttpError(409, "photo_reused", "one of these photos is already on another submission");
        }

        const approvedBefore = db.prepare("SELECT COUNT(*) AS n FROM mines WHERE user_id = ? AND approved = 1 AND removed = 0").get(uid) as Row;
        db.prepare(
          `INSERT INTO mines (id, user_id, lat, lon, user_lat, user_lon, accuracy_m, captured_at, type, name, commodity, notes, hazards, approved, created_at, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          s.id, uid, s.lat, s.lon, s.user_lat, s.user_lon, s.accuracy_m, s.captured_at, s.type,
          s.name || null, s.commodity || null, s.notes || null, JSON.stringify(s.hazards),
          approvedBefore.n >= LIMITS.probationCount ? 1 : 0, now, nextSeq(db),
        );
        const addPhoto = db.prepare("INSERT INTO photos (id, mine_id, idx, dhash) VALUES (?, ?, ?, ?)");
        processed.forEach((p, i) => addPhoto.run(photoIds[i], s.id, i, p.dhash.toString(16)));
        return { status: 201, body: { mine: serialize(getMine(db, s.id)!) } };
      });
    } catch (e) {
      await Promise.all(photoIds.flatMap((id) => [unlink(photoPath(id, false)), unlink(photoPath(id, true))]).map((p) => p.catch(() => {})));
      if (e instanceof HttpError && e.code === "already_stored") return { status: 200, body: { mine: serialize(getMine(db, s.id)!) } };
      throw e;
    }
  }

  function pull(url: URL) {
    const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
    const rows = db.prepare(`${MINE_SELECT} WHERE m.seq > ? ORDER BY m.seq LIMIT 1000`).all(since) as Row[];
    const mines = [];
    const deleted = [];
    for (const r of rows) {
      if (!r.removed && isPublic(tierOf(r))) mines.push(serialize(r));
      else if (since > 0) deleted.push(r.id); // a first sync has nothing to delete
    }
    return { cursor: rows.length ? rows[rows.length - 1].seq : since, more: rows.length === 1000, mines, deleted };
  }

  function votable(uid: number, id: string): Row {
    const m = getMine(db, id);
    if (!m || m.removed || !isPublic(tierOf(m))) throw new HttpError(404, "not_found");
    if (m.user_id === uid) throw new HttpError(403, "own_mine", "you can't vote on or report your own submission");
    return m;
  }

  async function vote(req: IncomingMessage, id: string) {
    const uid = requireUser(req);
    const v = parse(Vote, await readJson(req));
    return tx(db, () => {
      const m = votable(uid, id);
      const n = db.prepare("SELECT COUNT(*) AS n FROM votes WHERE user_id = ? AND created_at > ?").get(uid, Date.now() - 86_400_000) as Row;
      if (n.n >= LIMITS.votesPerDay) throw new HttpError(429, "daily_limit", `${LIMITS.votesPerDay} votes a day`);
      if (v.value === 0) {
        db.prepare("DELETE FROM votes WHERE mine_id = ? AND user_id = ?").run(id, uid);
      } else {
        const onSite =
          v.lat !== undefined && v.lon !== undefined && (v.accuracy_m ?? Infinity) <= LIMITS.maxAccuracyM &&
          distanceM(v.lat, v.lon, m.lat, m.lon) <= LIMITS.onSiteVoteM;
        db.prepare("INSERT OR REPLACE INTO votes (mine_id, user_id, value, on_site, created_at) VALUES (?, ?, ?, ?, ?)").run(
          id, uid, v.value, onSite ? 1 : 0, Date.now(),
        );
      }
      bump(db, id);
      return { status: 200, body: { mine: serialize(getMine(db, id)!) } };
    });
  }

  async function report(req: IncomingMessage, id: string) {
    const uid = requireUser(req);
    const r = parse(Report, await readJson(req));
    return tx(db, () => {
      votable(uid, id);
      db.prepare("INSERT OR IGNORE INTO reports (mine_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)").run(id, uid, r.reason, Date.now());
      bump(db, id);
      return { status: 204, body: null };
    });
  }

  // Hides every mine by that mine's author from the caller, now and later. The author's id never
  // leaves the server: the app only gets back the mine ids to hide.
  function block(req: IncomingMessage, id: string) {
    const uid = requireUser(req);
    const m = getMine(db, id);
    if (!m || m.removed) throw new HttpError(404, "not_found");
    if (m.user_id === uid) throw new HttpError(403, "own_mine", "you can't block yourself");
    if (m.user_id !== null) {
      db.prepare("INSERT OR IGNORE INTO blocks (user_id, author_id, created_at) VALUES (?, ?, ?)").run(uid, m.user_id, Date.now());
    }
    return { status: 204, body: null };
  }

  function blocked(req: IncomingMessage) {
    const uid = requireUser(req);
    const authors = (db.prepare("SELECT COUNT(*) AS n FROM blocks WHERE user_id = ?").get(uid) as Row).n;
    const ids = db
      .prepare("SELECT m.id FROM mines m JOIN blocks b ON b.author_id = m.user_id WHERE b.user_id = ? AND m.removed = 0")
      .all(uid) as Row[];
    return { status: 200, body: { authors, mine_ids: ids.map((r) => r.id) } };
  }

  async function admin(req: IncomingMessage, res: ServerResponse, url: URL) {
    const denied = adminGate(req);
    if (denied === 401) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="MinFinder moderation", charset="UTF-8"' }).end();
      return;
    }
    if (denied) throw new HttpError(denied, "not_found");
    const p = url.pathname;
    let m: RegExpMatchArray | null;
    if (req.method === "GET" && p === "/admin") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(adminPage(db, url.searchParams.get("msg")));
      return;
    }
    if (req.method === "GET" && (m = p.match(/^\/admin\/photos\/([\w-]{1,64}?)(_t)?\.jpg$/))) {
      const buf = await readFile(photoPath(m[1], !!m[2])).catch(() => null);
      if (!buf) throw new HttpError(404, "not_found");
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" }).end(buf);
      return;
    }
    if (req.method === "POST" && (m = p.match(/^\/admin\/(\w+)\/([\w-]{1,64})$/)) && (ACTIONS as readonly string[]).includes(m[1])) {
      let msg: string;
      try {
        msg = moderate(db, m[1] as Action, m[2]);
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      req.resume();
      res.writeHead(303, { Location: `/admin?msg=${encodeURIComponent(msg)}` }).end();
      return;
    }
    throw new HttpError(404, "not_found");
  }

  async function deleteMe(req: IncomingMessage) {
    const uid = requireUser(req);
    const photoIds = tx(db, () => {
      const ids = (db.prepare("SELECT p.id FROM photos p JOIN mines m ON m.id = p.mine_id WHERE m.user_id = ?").all(uid) as Row[]).map((r) => r.id);
      // Their votes and reports move other mines' scores, so those mines need a new seq too.
      const touched = db.prepare("SELECT mine_id FROM votes WHERE user_id = ? UNION SELECT mine_id FROM reports WHERE user_id = ?").all(uid, uid) as Row[];
      for (const m of db.prepare("SELECT id FROM mines WHERE user_id = ?").all(uid) as Row[]) {
        // Keep the id as a tombstone so devices drop it; wipe everything the user wrote.
        db.prepare("UPDATE mines SET removed = 1, name = NULL, commodity = NULL, notes = NULL, seq = ? WHERE id = ?").run(nextSeq(db), m.id);
        db.prepare("DELETE FROM photos WHERE mine_id = ?").run(m.id);
      }
      db.prepare("DELETE FROM users WHERE id = ?").run(uid); // cascades sessions, votes, reports
      for (const t of touched) bump(db, t.mine_id);
      return ids;
    });
    await Promise.all(photoIds.flatMap((id) => [unlink(photoPath(id, false)), unlink(photoPath(id, true))]).map((p) => p.catch(() => {})));
    return { status: 204, body: null };
  }

  async function photo(req: IncomingMessage, res: ServerResponse, id: string, thumb: boolean) {
    const row = db.prepare("SELECT mine_id FROM photos WHERE id = ?").get(id) as Row | undefined;
    const m = row && getMine(db, row.mine_id);
    if (!m) throw new HttpError(404, "not_found");
    // Pending and hidden mines' photos are visible to their author only.
    if (!isPublic(tierOf(m)) && sessionUser(db, req.headers.authorization) !== m.user_id) throw new HttpError(404, "not_found");
    const buf = await readFile(photoPath(id, thumb));
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": buf.length, "Cache-Control": isPublic(tierOf(m)) ? "public, max-age=86400" : "private, no-store" });
    res.end(buf);
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://local");
    const p = url.pathname;
    const method = req.method ?? "GET";
    let m: RegExpMatchArray | null;

    if (method === "GET" && p === "/v1/health") return { status: 200, body: { ok: true } };
    if (method === "GET" && p === "/v1/config") {
      return {
        status: 200,
        body: { min_app_version: process.env.MIN_APP_VERSION ?? "1.2.0", submissions_enabled: process.env.SUBMISSIONS_ENABLED !== "false", limits: LIMITS },
      };
    }
    if (method === "POST" && (m = p.match(/^\/v1\/auth\/(\w+)$/))) {
      if (!isProvider(m[1])) throw new HttpError(404, "not_found");
      const { id_token } = parse(z.object({ id_token: z.string().min(1).max(8192) }), await readJson(req));
      let sub: string;
      try {
        sub = await verifyIdToken(m[1], id_token);
      } catch {
        throw new HttpError(401, "bad_token");
      }
      try {
        return { status: 200, body: { token: signIn(db, m[1], sub).token } };
      } catch {
        throw new HttpError(403, "banned");
      }
    }
    if (method === "POST" && p === "/v1/submissions") return submit(req);
    if (method === "GET" && p === "/v1/mines") return { status: 200, body: pull(url) };
    if (method === "GET" && p === "/v1/me/submissions") {
      const uid = requireUser(req);
      const rows = db.prepare(`${MINE_SELECT} WHERE m.user_id = ? AND m.removed = 0 ORDER BY m.created_at DESC`).all(uid) as Row[];
      return { status: 200, body: { mines: rows.map(serialize) } };
    }
    if (method === "DELETE" && p === "/v1/me") return deleteMe(req);
    if (method === "GET" && p === "/v1/me/blocks") return blocked(req);
    if (method === "DELETE" && p === "/v1/me/blocks") {
      db.prepare("DELETE FROM blocks WHERE user_id = ?").run(requireUser(req));
      return { status: 204, body: null };
    }
    if (method === "POST" && (m = p.match(/^\/v1\/mines\/([\w-]{1,64})\/block$/))) return block(req, m[1]);
    if (p === "/admin" || p.startsWith("/admin/")) {
      await admin(req, res, url);
      return null;
    }
    if (method === "POST" && (m = p.match(/^\/v1\/mines\/([\w-]{1,64})\/vote$/))) return vote(req, m[1]);
    if (method === "POST" && (m = p.match(/^\/v1\/mines\/([\w-]{1,64})\/report$/))) return report(req, m[1]);
    if (method === "GET" && (m = p.match(/^\/v1\/photos\/([\w-]{1,64}?)(_t)?\.jpg$/))) {
      await photo(req, res, m[1], !!m[2]);
      return null;
    }
    throw new HttpError(404, "not_found");
  }

  return createServer(async (req, res) => {
    try {
      // Only Caddy can reach the loopback listener, and it sets X-Forwarded-For to the caller.
      // Writes only: carrier NAT puts many phones behind one IP, and reads (sync, thumbnails)
      // are cheap and cacheable.
      if (req.method === "POST") rateLimit(String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress).split(",")[0].trim());
      const out = await route(req, res);
      if (!out) return;
      if (out.body === null) res.writeHead(out.status).end();
      else res.writeHead(out.status, { "Content-Type": "application/json" }).end(JSON.stringify(out.body));
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      const err = e instanceof HttpError ? e : new HttpError(500, "server_error");
      if (!res.headersSent) {
        res.writeHead(err.status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.code, message: err.message, ...err.extra }));
      } else res.destroy();
      req.resume(); // drain an unread body so the socket can be reused
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = process.env.DATA_DIR ?? "./data";
  mkdirSync(dataDir, { recursive: true });
  const port = Number(process.env.PORT ?? 8084);
  const host = process.env.HOST ?? "127.0.0.1";
  createApp({ db: openDb(join(dataDir, "api.db")), photoDir: join(dataDir, "photos") }).listen(port, host, () => {
    console.log(`minfinder-api listening on ${host}:${port}`);
  });
}
