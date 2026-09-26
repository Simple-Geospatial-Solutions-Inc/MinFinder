import { mkdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isProvider, revokeApple, sessionUser, signIn, storeAppleToken, verifyIdToken } from "./auth.ts";
import { bump, CONTRIBUTION_SELECT, nextSeq, openDb, tx, type DB } from "./db.ts";
import { adminGate, adminPage } from "./adminPage.ts";
import { AttestError, bodyHash, decodePlayToken, newChallenge, playVerdict, verifyAssertion, verifyAttestation } from "./attest.ts";
import { ACTIONS, moderate, type Action } from "./moderation.ts";
import { processPhoto } from "./photos.ts";
import { publishedPoint } from "./minfile.ts";
import { sensitiveAreaAt } from "./sensitive.ts";
import { distanceM, hamming, inBC, isPublic, LIMITS, status, travelKmh, type Status } from "./rules.ts";

const LABELS = ["adit", "shaft", "portal", "trench", "dump", "headframe", "ruins", "other"] as const;
const REPORT_REASONS = ["spam", "inappropriate", "photo_not_this_site", "dangerous", "other"] as const;

const Base = {
  id: z.string().uuid(),
  minfilno: z.string().trim().min(1).max(16),
  visit_id: z.string().uuid().optional(),
  text: z.string().trim().max(LIMITS.maxTextChars).optional(),
};
// Recorded at the mine, maybe uploaded days later from signal.
const OnSite = {
  user_lat: z.number().finite(),
  user_lon: z.number().finite(),
  accuracy_m: z.number().positive(),
  mocked: z.literal(false), // Android's mock-location flag; the app refuses to capture when true
  captured_at: z.number().int(), // epoch ms, taken from the GPS fix rather than the phone clock
  safety_ack: z.literal(true),
};
const Submission = z.discriminatedUnion("kind", [
  z.object({
    ...Base, ...OnSite, kind: z.literal("location"),
    lat: z.number().finite(), lon: z.number().finite(), label: z.enum(LABELS), far_ack: z.boolean().default(false),
  }),
  z.object({
    ...Base, ...OnSite, kind: z.literal("not_found"),
    search_radius_m: z.number().refine((r) => (LIMITS.searchRadiiM as readonly number[]).includes(r), "not an offered radius"),
  }),
  z.object({ ...Base, kind: z.literal("note"), text: z.string().trim().min(1).max(LIMITS.maxTextChars) }),
]);

// A visitor's verdict (value plus the fix it was given at), or a "Helpful" on a note.
const Response = z.union([
  z.object({ helpful: z.boolean() }).strict(),
  z.object({
    value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    lat: z.number().finite().optional(),
    lon: z.number().finite().optional(),
    accuracy_m: z.number().positive().optional(),
    captured_at: z.number().int().optional(),
  }),
]);

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

function statusOf(c: Row): Status {
  return status({
    approved: !!c.approved,
    staffVerified: !!c.staff_verified,
    reports: c.reports,
    kind: c.kind,
    capturedAt: c.captured_at,
    verdicts: JSON.parse(c.verdicts),
  });
}

// The public face of a report. No user id: readers see "a visitor", never who.
function serialize(c: Row) {
  const verdicts = JSON.parse(c.verdicts) as [number, number][];
  const s = statusOf(c);
  const visits = c.kind === "note" ? [] : [c.captured_at, ...verdicts.map((v) => v[1])];
  return {
    id: c.id,
    minfilno: c.minfilno,
    kind: c.kind,
    label: c.label,
    // A search's position is where the searcher stood, which never leaves the server.
    lat: c.kind === "location" ? c.lat : null,
    lon: c.kind === "location" ? c.lon : null,
    accuracy_m: c.accuracy_m,
    captured_at: c.captured_at,
    search_radius_m: c.search_radius_m,
    distance_m: c.distance_m === null ? null : Math.round(c.distance_m),
    visit_id: c.visit_id,
    text: c.text,
    status: s,
    // The author's own capture is the first confirm.
    confirms: c.kind === "note" ? 0 : 1 + verdicts.filter((v) => v[0] > 0).length,
    disputes: verdicts.filter((v) => v[0] < 0).length,
    last_visit_at: visits.length ? Math.max(...visits) : null,
    helpful: c.helpful,
    photos: JSON.parse(c.photo_ids),
    seq: c.seq,
    // Why it's waiting, for its author. Pending reports are only ever sent to their author.
    held_for: s === "pending" ? (c.hold ?? null) : null,
  };
}

function getContribution(db: DB, id: string): Row | undefined {
  return db.prepare(`${CONTRIBUTION_SELECT} WHERE c.id = ?`).get(id) as Row | undefined;
}

async function readBody(req: IncomingMessage, max = 16_384): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > max) throw new HttpError(413, "body_too_large");
  }
  return body;
}

async function readJson(req: IncomingMessage, max?: number): Promise<unknown> {
  return jsonOf(await readBody(req, max));
}

function jsonOf(body: string): unknown {
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

  const PACKAGE = process.env.ANDROID_PACKAGE ?? "ca.sgss.minfinder";
  const PASSED = new Set(["ios", "android"]);

  /**
   * The verdict on a write's X-Attest header, over its exact body. Recorded on the mine; in
   * ATTESTATION=enforce mode anything but a pass is refused.
   */
  async function attest(req: IncomingMessage, body: string): Promise<string> {
    const mode = process.env.ATTESTATION ?? "log";
    if (mode === "off") return "off";
    const verdict = await attestVerdict(req, body).catch((e) =>
      e instanceof AttestError ? `fail: ${e.message}` : `error: ${e instanceof Error ? e.message : e}`,
    );
    if (PASSED.has(verdict)) return verdict;
    console.warn(`[attest] ${verdict}`);
    if (mode === "enforce") {
      if (verdict.startsWith("error")) throw new HttpError(503, "attestation_unavailable");
      if (verdict === "none") throw new HttpError(403, "attestation_required", "update the app to upload");
      if (verdict === "fail: unknown key") throw new HttpError(403, "attest_key_unknown");
      throw new HttpError(403, "attestation_failed", verdict.slice(6));
    }
    return verdict;
  }

  async function attestVerdict(req: IncomingMessage, body: string): Promise<string> {
    const [platform, a, b] = String(req.headers["x-attest"] ?? "").split(" ");
    if (platform === "ios") {
      const appId = process.env.APPLE_APP_ID;
      if (!appId) throw new Error("APPLE_APP_ID not set");
      const key = db.prepare("SELECT public_key, counter FROM attest_keys WHERE key_id = ?").get(a ?? "") as Row | undefined;
      if (!key) throw new AttestError("unknown key");
      // No await between the read and the write, so two requests can't both use one counter.
      const counter = verifyAssertion({ assertion: b ?? "", clientData: body, publicKey: key.public_key, counter: key.counter, appId });
      db.prepare("UPDATE attest_keys SET counter = ? WHERE key_id = ?").run(counter, a);
      return "ios";
    }
    if (platform === "android") {
      const keyFile = process.env.PLAY_INTEGRITY_KEY_FILE;
      if (!keyFile) throw new Error("PLAY_INTEGRITY_KEY_FILE not set");
      const why = playVerdict(await decodePlayToken(a ?? "", PACKAGE, keyFile), { packageName: PACKAGE, requestHash: bodyHash(body) });
      if (why) throw new AttestError(why);
      return "android";
    }
    return "none";
  }

  async function registerKey(req: IncomingMessage) {
    requireUser(req);
    const appId = process.env.APPLE_APP_ID;
    if (!appId) throw new HttpError(503, "attestation_unavailable");
    const r = parse(
      z.object({ key_id: z.string().min(1).max(128), attestation: z.string().min(1).max(60_000), challenge: z.string().min(1).max(128) }),
      await readJson(req, 65_536),
    );
    const issued = db
      .prepare("DELETE FROM attest_challenges WHERE challenge = ? AND created_at > ? RETURNING challenge")
      .get(r.challenge, Date.now() - 300_000);
    if (!issued) throw new HttpError(400, "bad_challenge", "ask for a new challenge");
    let key;
    try {
      key = verifyAttestation({ keyId: r.key_id, attestation: r.attestation, challenge: r.challenge, appId });
    } catch (e) {
      if (e instanceof AttestError) throw new HttpError(422, "attestation_invalid", e.message);
      throw e;
    }
    db.prepare("INSERT OR REPLACE INTO attest_keys (key_id, public_key, counter, env, created_at) VALUES (?, ?, 0, ?, ?)").run(
      r.key_id, key.publicKey, key.env, Date.now(),
    );
    return { status: 204, body: null };
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
    const verdict = await attest(req, String(form.get("data")));

    // A retry of an upload that already landed: answer with what we stored, before spending
    // any CPU on photos.
    const existing = db.prepare("SELECT user_id FROM contributions WHERE id = ?").get(s.id) as Row | undefined;
    if (existing) {
      if (existing.user_id !== uid) throw new HttpError(409, "id_taken");
      return { status: 200, body: { contribution: serialize(getContribution(db, s.id)!) } };
    }

    const published = publishedPoint(s.minfilno);
    if (!published) throw new HttpError(422, "unknown_mine", "no MINFILE occurrence with coordinates has that number");
    const now = Date.now();
    type Place = { lat: number | null; lon: number | null; user_lat: number | null; user_lon: number | null; accuracy_m: number | null; captured_at: number; distance_m: number | null };
    let at: Place;

    if (s.kind === "note") {
      if (files.length) throw new HttpError(400, "photos", "photos are taken on site, with a location or a search");
      at = { lat: null, lon: null, user_lat: null, user_lon: null, accuracy_m: null, captured_at: now, distance_m: null };
    } else {
      if (files.length > LIMITS.maxPhotos) throw new HttpError(400, "photos", `send up to ${LIMITS.maxPhotos} photos`);
      if (files.some((f) => f.size > LIMITS.maxPhotoBytes)) throw new HttpError(413, "photo_too_large");
      if (s.accuracy_m > LIMITS.maxAccuracyM) throw new HttpError(422, "gps_inaccurate", `GPS accuracy must be ${LIMITS.maxAccuracyM} m or better`);
      if (!inBC(s.user_lat, s.user_lon)) throw new HttpError(422, "outside_bc");
      if (s.captured_at > now + LIMITS.futureSkewMs) throw new HttpError(422, "captured_in_future");
      if (s.captured_at < now - LIMITS.maxAgeDays * 86_400_000) throw new HttpError(422, "capture_too_old", `captures older than ${LIMITS.maxAgeDays} days can't be uploaded`);
      // A located working is its pin; a search is where the searcher stood.
      const [lat, lon] = s.kind === "location" ? [s.lat, s.lon] : [s.user_lat, s.user_lon];
      const d = distanceM(lat, lon, published.lat, published.lon);
      if (s.kind === "location") {
        if (!inBC(lat, lon)) throw new HttpError(422, "outside_bc");
        if (distanceM(lat, lon, s.user_lat, s.user_lon) > LIMITS.maxNudgeM) throw new HttpError(422, "pin_too_far", `the pin must be within ${LIMITS.maxNudgeM} m of where you stood`);
        if (d > LIMITS.maxFromPublishedM) {
          throw new HttpError(422, "different_mine", `over ${LIMITS.maxFromPublishedM / 1000} km from the published location: probably a different mine`, { distance_m: Math.round(d) });
        }
        if (d > LIMITS.farAckM && !s.far_ack) {
          throw new HttpError(422, "far_unconfirmed", `over ${LIMITS.farAckM} m from the published location; confirm it's the same mine`, { distance_m: Math.round(d) });
        }
      } else if (d > s.search_radius_m) {
        throw new HttpError(422, "not_at_published", `you must be inside your ${s.search_radius_m} m search radius of the published location`, { distance_m: Math.round(d) });
      }
      at = { lat, lon, user_lat: s.user_lat, user_lon: s.user_lon, accuracy_m: s.accuracy_m, captured_at: s.captured_at, distance_m: d };
    }

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
        const again = db.prepare("SELECT user_id FROM contributions WHERE id = ?").get(s.id) as Row | undefined;
        if (again) {
          if (again.user_id !== uid) throw new HttpError(409, "id_taken");
          throw new HttpError(200, "already_stored"); // raced with its own retry; photos cleaned below
        }

        const today = db.prepare("SELECT COUNT(*) AS n FROM contributions WHERE user_id = ? AND created_at > ?").get(uid, now - 86_400_000) as Row;
        if (today.n >= LIMITS.submissionsPerDay) throw new HttpError(429, "daily_limit", `${LIMITS.submissionsPerDay} reports a day`);

        // Impossible travel: compare against this user's on-site captures either side in time.
        if (at.user_lat !== null && at.user_lon !== null) {
          const neighbours = db
            .prepare(
              `SELECT * FROM (SELECT user_lat, user_lon, captured_at FROM contributions WHERE user_id = ? AND user_lat IS NOT NULL AND captured_at <= ? ORDER BY captured_at DESC LIMIT 1)
               UNION ALL SELECT * FROM (SELECT user_lat, user_lon, captured_at FROM contributions WHERE user_id = ? AND user_lat IS NOT NULL AND captured_at > ? ORDER BY captured_at ASC LIMIT 1)`,
            )
            .all(uid, at.captured_at, uid, at.captured_at) as Row[];
          for (const n of neighbours) {
            if (travelKmh(distanceM(n.user_lat, n.user_lon, at.user_lat, at.user_lon), n.captured_at - at.captured_at) > LIMITS.maxTravelKmh) {
              throw new HttpError(422, "impossible_travel", "this capture is too far from your previous one for the time between them");
            }
          }
        }

        // ponytail: linear scan of every stored hash. Fine into the tens of thousands of photos;
        // a BK-tree or multi-index hashing if it ever isn't.
        if (processed.length) {
          const hashes = (db.prepare("SELECT dhash FROM photos").all() as Row[]).map((r) => BigInt("0x" + r.dhash));
          if (processed.some((p) => hashes.some((h) => hamming(h, p.dhash) <= LIMITS.photoDupMaxBits))) {
            throw new HttpError(409, "photo_reused", "one of these photos is already on another report");
          }
        }

        const approvedBefore = db.prepare("SELECT COUNT(*) AS n FROM contributions WHERE user_id = ? AND approved = 1 AND removed = 0").get(uid) as Row;
        // A located working inside a park, protected area or reserve is more precise than
        // MINFILE, so staff look first, whoever it's from.
        const hold = s.kind === "location" ? sensitiveAreaAt(s.lat, s.lon) : null;
        db.prepare(
          `INSERT INTO contributions (id, user_id, minfilno, kind, label, lat, lon, user_lat, user_lon, accuracy_m, captured_at,
             search_radius_m, distance_m, far_ack, visit_id, text, approved, created_at, seq, attest, hold)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          s.id, uid, s.minfilno, s.kind, s.kind === "location" ? s.label : null, at.lat, at.lon, at.user_lat, at.user_lon,
          at.accuracy_m, at.captured_at, s.kind === "not_found" ? s.search_radius_m : null, at.distance_m,
          s.kind === "location" && s.far_ack ? 1 : 0, s.visit_id ?? null, s.text || null,
          !hold && approvedBefore.n >= LIMITS.probationCount ? 1 : 0, now, nextSeq(db), verdict, hold,
        );
        const addPhoto = db.prepare("INSERT INTO photos (id, contribution_id, idx, dhash) VALUES (?, ?, ?, ?)");
        processed.forEach((p, i) => addPhoto.run(photoIds[i], s.id, i, p.dhash.toString(16)));
        return { status: 201, body: { contribution: serialize(getContribution(db, s.id)!), attest: verdict } };
      });
    } catch (e) {
      await Promise.all(photoIds.flatMap((id) => [unlink(photoPath(id, false)), unlink(photoPath(id, true))]).map((p) => p.catch(() => {})));
      if (e instanceof HttpError && e.code === "already_stored") return { status: 200, body: { contribution: serialize(getContribution(db, s.id)!) } };
      throw e;
    }
  }

  function pull(url: URL) {
    const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
    const rows = db.prepare(`${CONTRIBUTION_SELECT} WHERE c.seq > ? ORDER BY c.seq LIMIT 1000`).all(since) as Row[];
    const contributions = [];
    const deleted = [];
    for (const r of rows) {
      if (!r.removed && isPublic(statusOf(r))) contributions.push(serialize(r));
      else if (since > 0) deleted.push(r.id); // a first sync has nothing to delete
    }
    return { cursor: rows.length ? rows[rows.length - 1].seq : since, more: rows.length === 1000, contributions, deleted };
  }

  function respondable(uid: number, id: string): Row {
    const c = getContribution(db, id);
    if (!c || c.removed || !isPublic(statusOf(c))) throw new HttpError(404, "not_found");
    if (c.user_id === uid) throw new HttpError(403, "own_report", "you can't respond to or report your own report");
    return c;
  }

  // A verdict only counts from someone who was there: the fix it came with must put them within
  // 75 m of a located working, or inside a not_found's search radius of the published spot.
  // Anyone, anywhere, can mark a note Helpful.
  async function respond(req: IncomingMessage, id: string) {
    const uid = requireUser(req);
    const raw = await readBody(req);
    const r = parse(Response, jsonOf(raw));
    const verdict = await attest(req, raw);
    const now = Date.now();
    return tx(db, () => {
      const c = respondable(uid, id);
      const n = db.prepare("SELECT COUNT(*) AS n FROM responses WHERE user_id = ? AND created_at > ?").get(uid, now - 86_400_000) as Row;
      if (n.n >= LIMITS.responsesPerDay) throw new HttpError(429, "daily_limit", `${LIMITS.responsesPerDay} responses a day`);
      if ("helpful" in r) {
        if (c.kind !== "note") throw new HttpError(400, "invalid", "only notes take Helpful; confirm or dispute on site instead");
        db.prepare(
          `INSERT INTO responses (contribution_id, user_id, helpful, captured_at, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT DO UPDATE SET helpful = excluded.helpful, created_at = excluded.created_at`,
        ).run(id, uid, r.helpful ? 1 : 0, now, now);
      } else if (c.kind === "note") {
        throw new HttpError(400, "invalid", "a note can be marked Helpful, not confirmed");
      } else if (r.value === 0) {
        db.prepare("DELETE FROM responses WHERE contribution_id = ? AND user_id = ?").run(id, uid);
      } else {
        if (r.lat === undefined || r.lon === undefined || r.captured_at === undefined) {
          throw new HttpError(422, "not_on_site", "confirming needs your GPS fix at the site");
        }
        if ((r.accuracy_m ?? Infinity) > LIMITS.maxAccuracyM) throw new HttpError(422, "gps_inaccurate", `GPS accuracy must be ${LIMITS.maxAccuracyM} m or better`);
        if (r.captured_at > now + LIMITS.futureSkewMs) throw new HttpError(422, "captured_in_future");
        if (r.captured_at < now - LIMITS.maxAgeDays * 86_400_000) throw new HttpError(422, "capture_too_old");
        const p = c.kind === "location" ? { lat: c.lat as number, lon: c.lon as number } : publishedPoint(c.minfilno)!;
        const radius: number = c.kind === "location" ? LIMITS.onSiteM : c.search_radius_m;
        if (distanceM(r.lat, r.lon, p.lat, p.lon) > radius) {
          throw new HttpError(422, "not_on_site", `you must be within ${radius} m to confirm or dispute this`);
        }
        db.prepare(
          `INSERT INTO responses (contribution_id, user_id, value, captured_at, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT DO UPDATE SET value = excluded.value, captured_at = excluded.captured_at, created_at = excluded.created_at`,
        ).run(id, uid, r.value, r.captured_at, now);
      }
      bump(db, id);
      return { status: 200, body: { contribution: serialize(getContribution(db, id)!), attest: verdict } };
    });
  }

  async function report(req: IncomingMessage, id: string) {
    const uid = requireUser(req);
    const r = parse(Report, await readJson(req));
    return tx(db, () => {
      respondable(uid, id);
      db.prepare("INSERT OR IGNORE INTO reports (contribution_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)").run(id, uid, r.reason, Date.now());
      bump(db, id);
      return { status: 204, body: null };
    });
  }

  // Hides every report by that report's author from the caller, now and later. The author's id
  // never leaves the server: the app only gets back the report ids to hide.
  function block(req: IncomingMessage, id: string) {
    const uid = requireUser(req);
    const m = getContribution(db, id);
    if (!m || m.removed) throw new HttpError(404, "not_found");
    if (m.user_id === uid) throw new HttpError(403, "own_report", "you can't block yourself");
    if (m.user_id !== null) {
      db.prepare("INSERT OR IGNORE INTO blocks (user_id, author_id, created_at) VALUES (?, ?, ?)").run(uid, m.user_id, Date.now());
    }
    return { status: 204, body: null };
  }

  function blocked(req: IncomingMessage) {
    const uid = requireUser(req);
    const authors = (db.prepare("SELECT COUNT(*) AS n FROM blocks WHERE user_id = ?").get(uid) as Row).n;
    const ids = db
      .prepare("SELECT c.id FROM contributions c JOIN blocks b ON b.author_id = c.user_id WHERE b.user_id = ? AND c.removed = 0")
      .all(uid) as Row[];
    return { status: 200, body: { authors, ids: ids.map((r) => r.id) } };
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
      const mine = url.searchParams.get("mine");
      res.end(adminPage(db, url.searchParams.get("msg"), url.searchParams.has("failed"), mine && /^\w{1,20}$/.test(mine) ? mine : null));
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
      let failed = "";
      try {
        msg = moderate(db, m[1] as Action, m[2]);
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
        failed = "&failed=1";
      }
      req.resume();
      // Back to wherever the action was taken: the queue, or one mine's list.
      const mine = url.searchParams.get("mine");
      const at = mine && /^\w{1,20}$/.test(mine) ? `mine=${encodeURIComponent(mine)}&` : "";
      res.writeHead(303, { Location: `/admin?${at}msg=${encodeURIComponent(msg)}${failed}` }).end();
      return;
    }
    throw new HttpError(404, "not_found");
  }

  /**
   * The author takes a report back. Keeps the id as a tombstone so devices drop it, and wipes
   * everything the user wrote. Where they stood goes too: the placeholder keeps only the mine,
   * the kind and a location's pin (a search's position is where they stood, so it goes).
   * Runs inside a transaction; returns the photo ids whose files to delete after it commits.
   */
  function tombstone(id: string): string[] {
    const photoIds = (db.prepare("SELECT id FROM photos WHERE contribution_id = ?").all(id) as Row[]).map((r) => r.id);
    db.prepare(
      `UPDATE contributions SET removed = 1, text = NULL, visit_id = NULL, attest = NULL, hold = NULL,
         lat = CASE WHEN kind = 'location' THEN lat END, lon = CASE WHEN kind = 'location' THEN lon END,
         user_lat = CASE WHEN kind = 'location' THEN lat END, user_lon = CASE WHEN kind = 'location' THEN lon END, seq = ?
       WHERE id = ?`,
    ).run(nextSeq(db), id);
    db.prepare("DELETE FROM photos WHERE contribution_id = ?").run(id);
    return photoIds;
  }
  const unlinkPhotos = (ids: string[]) =>
    Promise.all(ids.flatMap((id) => [unlink(photoPath(id, false)), unlink(photoPath(id, true))]).map((p) => p.catch(() => {})));

  async function deleteOwn(req: IncomingMessage, id: string) {
    const uid = requireUser(req);
    const photoIds = tx(db, () => {
      const c = db.prepare("SELECT user_id, removed FROM contributions WHERE id = ?").get(id) as Row | undefined;
      if (!c || c.removed) throw new HttpError(404, "not_found");
      if (c.user_id !== uid) throw new HttpError(403, "not_yours", "only its author can delete a report");
      return tombstone(id);
    });
    await unlinkPhotos(photoIds);
    return { status: 204, body: null };
  }

  async function deleteMe(req: IncomingMessage) {
    const uid = requireUser(req);
    const apple = db.prepare("SELECT refresh_token FROM apple_tokens WHERE user_id = ?").get(uid) as Row | undefined;
    const photoIds = tx(db, () => {
      // Their responses and reports move other reports' status, so those need a new seq too.
      const touched = db
        .prepare("SELECT contribution_id FROM responses WHERE user_id = ? UNION SELECT contribution_id FROM reports WHERE user_id = ?")
        .all(uid, uid) as Row[];
      const ids = (db.prepare("SELECT id FROM contributions WHERE user_id = ?").all(uid) as Row[]).flatMap((c) => tombstone(c.id));
      db.prepare("DELETE FROM users WHERE id = ?").run(uid); // cascades sessions, responses, reports
      for (const t of touched) bump(db, t.contribution_id);
      return ids;
    });
    await unlinkPhotos(photoIds);
    // The account is already gone; a failed revoke is logged, not put back on the user.
    if (apple) await revokeApple(apple.refresh_token).catch((e) => console.error("[apple revoke]", e));
    return { status: 204, body: null };
  }

  async function photo(req: IncomingMessage, res: ServerResponse, id: string, thumb: boolean) {
    const row = db.prepare("SELECT contribution_id FROM photos WHERE id = ?").get(id) as Row | undefined;
    const c = row && getContribution(db, row.contribution_id);
    if (!c) throw new HttpError(404, "not_found");
    // Pending and hidden reports' photos are visible to their author only.
    const open = isPublic(statusOf(c));
    if (!open && sessionUser(db, req.headers.authorization) !== c.user_id) throw new HttpError(404, "not_found");
    const buf = await readFile(photoPath(id, thumb));
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": buf.length, "Cache-Control": open ? "public, max-age=86400" : "private, no-store" });
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
      const Body = z.object({ id_token: z.string().min(1).max(8192), authorization_code: z.string().min(1).max(4096).optional() });
      const { id_token, authorization_code } = parse(Body, await readJson(req));
      let sub: string;
      try {
        sub = await verifyIdToken(m[1], id_token);
      } catch {
        throw new HttpError(401, "bad_token");
      }
      let session: ReturnType<typeof signIn>;
      try {
        session = signIn(db, m[1], sub);
      } catch {
        throw new HttpError(403, "banned");
      }
      // Only needed to revoke on account deletion, so a failed exchange doesn't fail sign-in.
      if (m[1] === "apple" && authorization_code) {
        await storeAppleToken(db, session.userId, authorization_code).catch((e) => console.error("[apple token]", e));
      }
      return { status: 200, body: { token: session.token } };
    }
    if (method === "GET" && p === "/v1/attest/challenge") {
      requireUser(req);
      const challenge = newChallenge();
      db.prepare("DELETE FROM attest_challenges WHERE created_at < ?").run(Date.now() - 300_000);
      db.prepare("INSERT INTO attest_challenges (challenge, created_at) VALUES (?, ?)").run(challenge, Date.now());
      return { status: 200, body: { challenge } };
    }
    if (method === "POST" && p === "/v1/attest/ios") return registerKey(req);
    if (method === "POST" && p === "/v1/submissions") return submit(req);
    if (method === "GET" && p === "/v1/contributions") return { status: 200, body: pull(url) };
    if (method === "GET" && p === "/v1/me/submissions") {
      const uid = requireUser(req);
      const rows = db.prepare(`${CONTRIBUTION_SELECT} WHERE c.user_id = ? AND c.removed = 0 ORDER BY c.created_at DESC`).all(uid) as Row[];
      return { status: 200, body: { contributions: rows.map(serialize) } };
    }
    if (method === "DELETE" && p === "/v1/me") return deleteMe(req);
    if (method === "DELETE" && (m = p.match(/^\/v1\/contributions\/([\w-]{1,64})$/))) return deleteOwn(req, m[1]);
    if (method === "GET" && p === "/v1/me/blocks") return blocked(req);
    if (method === "DELETE" && p === "/v1/me/blocks") {
      db.prepare("DELETE FROM blocks WHERE user_id = ?").run(requireUser(req));
      return { status: 204, body: null };
    }
    if (method === "POST" && (m = p.match(/^\/v1\/contributions\/([\w-]{1,64})\/block$/))) return block(req, m[1]);
    if (p === "/admin" || p.startsWith("/admin/")) {
      await admin(req, res, url);
      return null;
    }
    if (method === "POST" && (m = p.match(/^\/v1\/contributions\/([\w-]{1,64})\/respond$/))) return respond(req, m[1]);
    if (method === "POST" && (m = p.match(/^\/v1\/contributions\/([\w-]{1,64})\/report$/))) return report(req, m[1]);
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
