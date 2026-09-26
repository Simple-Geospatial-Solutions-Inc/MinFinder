// node --test test/ — the rules in rules.ts plus one end-to-end walk through the HTTP API
// against a throwaway database. Sign-in is the one thing not exercised over HTTP: Apple and
// Google tokens can't be minted offline, so users are created with signIn() directly.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { signIn } from "../src/auth.ts";
import { openDb } from "../src/db.ts";
import { distanceM, status, travelKmh, weight, type StatusInput } from "../src/rules.ts";
import { createApp } from "../src/server.ts";

const DAY = 86_400_000;

test("status ladder", () => {
  const now = Date.now();
  const base: StatusInput = { approved: true, staffVerified: false, reports: 0, kind: "location", capturedAt: now, verdicts: [] };
  const yes = (n: number): [number, number][] => Array.from({ length: n }, () => [1, now]);
  const no = (n: number): [number, number][] => Array.from({ length: n }, () => [-1, now]);

  assert.equal(status({ ...base, approved: false, verdicts: yes(5) }, now), "pending");
  assert.equal(status(base, now), "unconfirmed", "the author alone is one visitor");
  assert.equal(status({ ...base, verdicts: yes(1) }, now), "confirmed", "author plus one visitor");
  assert.equal(status({ ...base, verdicts: no(1) }, now), "disputed", "1 of 2 agree");
  assert.equal(status({ ...base, verdicts: [...yes(1), ...no(1)] }, now), "disputed", "2 of 3 is not more than 2/3");
  assert.equal(status({ ...base, verdicts: [...yes(2), ...no(1)] }, now), "confirmed", "3 of 4");
  assert.equal(status({ ...base, verdicts: no(3) }, now), "collapsed", "1 of 4 agree");
  assert.equal(status({ ...base, staffVerified: true }, now), "verified");
  assert.equal(status({ ...base, staffVerified: true, reports: 2 }, now), "hidden", "abuse flags beat staff: it goes back to review");
  assert.equal(status({ ...base, kind: "note", verdicts: yes(3) }, now), "unconfirmed", "notes are never confirmed");

  // Old visits fade: three confirms from 4 years ago no longer outvote this summer's "not here".
  assert.ok(Math.abs(weight(now - 4 * 365 * DAY, now) - 0.25) < 0.01, "4 years = two half-lives");
  const old = now - 4 * 365 * DAY;
  assert.equal(status({ ...base, verdicts: [...yes(2), ...no(1)] }, now), "confirmed", "fresh, 3 of 4 is confirmed");
  assert.equal(status({ ...base, capturedAt: old, verdicts: [[1, old], [1, old], [-1, now]] }, now), "disputed", "0.75 old agree vs 1 fresh disagree");
  assert.equal(status({ ...base, capturedAt: old, verdicts: [[1, old], [-1, now], [-1, now]] }, now), "collapsed", "0.5 of 2.5");
});

test("distance and travel", () => {
  assert.ok(Math.abs(distanceM(49, -117, 49.001, -117) - 111.2) < 0.5);
  assert.ok(travelKmh(1000, 1000) < 100, "a minute floor keeps nearby quick captures sane");
  assert.ok(travelKmh(100_000, 30 * 60_000) > 150);
});

let dir: string;
let base: string;
let server: ReturnType<typeof createApp>;
let handle: ReturnType<typeof openDb>;
const db = () => handle;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "minfinder-api-"));
  handle = openDb(join(dir, "api.db"));
  server = createApp({ db: handle, photoDir: join(dir, "photos") });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

// A random 12x10 patchwork blown up smoothly: unrelated hashes between photos, but broad tonal
// structure like a real scene. (Pure noise is useless here: recompression flips its dHash bits.)
const photo = () =>
  sharp(randomBytes(12 * 10 * 3), { raw: { width: 12, height: 10, channels: 3 } })
    .resize(640, 480, { kernel: "cubic" })
    .jpeg()
    .toBuffer();

// Real MINFILE occurrences from assets/minfile-points.json: two near Nelson, one in Garibaldi Park.
const MINE = { minfilno: "082FSW296", lat: 49.491667, lon: -117.301111 };
const OTHER = { minfilno: "082FSW342", lat: 49.497778, lon: -117.368333 }; // ~5 km west
const PARK = { minfilno: "092GNE030", lat: 49.829167, lon: -122.432778 };
/** A point `m` metres north of `p`. */
const north = (p: { lat: number; lon: number }, m: number) => ({ lat: p.lat + m / 111_320, lon: p.lon });

function located(at: { lat: number; lon: number } = MINE, over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(), kind: "location", minfilno: MINE.minfilno, label: "adit", lat: at.lat, lon: at.lon, user_lat: at.lat, user_lon: at.lon,
    accuracy_m: 8, mocked: false, captured_at: Date.now() - 3_600_000, text: "Collapsed portal above the creek", safety_ack: true, ...over,
  };
}

async function submit(token: string, data: object, photos?: Buffer[]) {
  const form = new FormData();
  form.set("data", JSON.stringify(data));
  for (const p of photos ?? [await photo()]) form.append("photo", new Blob([new Uint8Array(p)], { type: "image/jpeg" }), "p.jpg");
  const r = await fetch(`${base}/v1/submissions`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  return { status: r.status, json: (await r.json()) as any };
}

async function post(token: string, path: string, data: object) {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  return { status: r.status, json: r.status === 204 ? null : ((await r.json()) as any) };
}

// As staff would with `admin.ts approve`.
function approve(id: string) {
  db().prepare("UPDATE contributions SET approved = 1, seq = (SELECT v + 1 FROM meta WHERE k = 'seq') WHERE id = ?").run(id);
  db().prepare("UPDATE meta SET v = v + 1 WHERE k = 'seq'").run();
}

const pull = async (since: number) => (await (await fetch(`${base}/v1/contributions?since=${since}`)).json()) as any;

test("field reports, safeguards, visitor verdicts and sync", async () => {
  const alice = signIn(db(), "apple", "alice");
  const bob = signIn(db(), "google", "bob");
  const carol = signIn(db(), "apple", "carol");

  const anon = await fetch(`${base}/v1/submissions`, { method: "POST" });
  assert.equal(anon.status, 401);

  // First report lands in probation and stays out of the public pull.
  const adit = located(north(MINE, 120));
  const s1 = await submit(alice.token, adit);
  assert.equal(s1.status, 201, JSON.stringify(s1.json));
  assert.equal(s1.json.contribution.status, "pending");
  assert.ok(Math.abs(s1.json.contribution.distance_m - 120) <= 1);
  assert.equal(s1.json.contribution.photos.length, 1);
  assert.equal((await pull(0)).contributions.length, 0);

  // A retry after a lost response is answered from the stored row, not duplicated.
  const retry = await submit(alice.token, adit);
  assert.equal(retry.status, 200);
  assert.equal(retry.json.contribution.id, adit.id);

  // Photos of pending reports are the author's alone.
  const photoUrl = `${base}/v1/photos/${s1.json.contribution.photos[0]}.jpg`;
  assert.equal((await fetch(photoUrl)).status, 404);
  const own = await fetch(photoUrl, { headers: { authorization: `Bearer ${alice.token}` } });
  assert.equal(own.status, 200);
  const alicesPhoto = Buffer.from(await own.arrayBuffer());
  assert.equal((await sharp(alicesPhoto).metadata()).exif, undefined, "EXIF must be stripped");

  // Server-side checks.
  const reject = async (data: Record<string, unknown>, status: number, code: string, photos?: Buffer[]) => {
    const r = await submit(alice.token, data, photos);
    assert.equal(r.status, status, `${code}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error, code);
    return r.json;
  };
  await reject(located(MINE, { minfilno: "000XXX000" }), 422, "unknown_mine");
  await reject(located(MINE, { accuracy_m: 45 }), 422, "gps_inaccurate");
  await reject(located(MINE, { user_lat: north(MINE, 40).lat }), 422, "pin_too_far");
  await reject(located(MINE, { captured_at: Date.now() - 40 * DAY }), 422, "capture_too_old");
  await reject(located(MINE, { mocked: true }), 400, "invalid");
  await reject(located(MINE, { safety_ack: false }), 400, "invalid");
  await reject(located(MINE, { label: "open_pit" }), 400, "invalid");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>');
  await reject(located(MINE), 422, "not_an_image", [svg]);

  // Far from the published spot: over 300 m needs the author's say-so, over 10 km is refused.
  const far = await reject(located(north(MINE, 450)), 422, "far_unconfirmed");
  assert.ok(Math.abs(far.distance_m - 450) <= 1);
  const shaft = located(north(MINE, 450), { label: "shaft", far_ack: true, visit_id: randomUUID() });
  assert.equal((await submit(alice.token, shaft)).status, 201);
  await reject(located(north(MINE, 12_000), { far_ack: true }), 422, "different_mine");

  // "Couldn't find it" must be filed from inside its own search radius.
  const search = (m: number, over: Record<string, unknown> = {}) => {
    const at = north(MINE, m);
    return { id: randomUUID(), kind: "not_found", minfilno: MINE.minfilno, search_radius_m: 150, user_lat: at.lat, user_lon: at.lon,
      accuracy_m: 9, mocked: false, captured_at: Date.now() - 3_000_000, safety_ack: true, ...over };
  };
  await reject(search(500), 422, "not_at_published");
  await reject(search(20, { search_radius_m: 100 }), 400, "invalid");
  const nf = await submit(alice.token, search(20), []);
  assert.equal(nf.status, 201, JSON.stringify(nf.json));
  assert.equal(nf.json.contribution.search_radius_m, 150);

  // Notes come from anywhere, without a fix, and without photos.
  const noteBody = { id: randomUUID(), kind: "note", minfilno: MINE.minfilno, text: "Gate at km 14 is locked Nov to May." };
  await reject({ ...noteBody, id: randomUUID() }, 400, "photos");
  const note = await submit(alice.token, noteBody, []);
  assert.equal(note.status, 201, JSON.stringify(note.json));
  assert.equal(note.json.contribution.lat, null);
  await reject({ ...noteBody, id: randomUUID(), text: "" }, 400, "invalid");

  // 5 km away, captured one minute after the adit: 300 km/h.
  await reject(located(OTHER, { minfilno: OTHER.minfilno, captured_at: adit.captured_at + 60_000 }), 422, "impossible_travel");

  // Bob can't reuse Alice's photo on his own report.
  const reused = await submit(bob.token, located(north(MINE, 60)), [alicesPhoto]);
  assert.equal(reused.json.error, "photo_reused");

  for (const id of [adit.id, shaft.id, nf.json.contribution.id, noteBody.id]) approve(id);
  const pull0 = await pull(0);
  assert.equal(pull0.contributions.length, 4);
  assert.equal(pull0.contributions.find((c: any) => c.id === adit.id).status, "unconfirmed");
  const publicSearch = pull0.contributions.find((c: any) => c.kind === "not_found");
  assert.equal(publicSearch.lat, null, "where a searcher stood is never published");

  // Verdicts: only from visitors, never from the author.
  const at = (m: number) => ({ ...north(north(MINE, 120), m), accuracy_m: 10, captured_at: Date.now() - 60_000 });
  const respond = (who: typeof bob, id: string, data: object) => post(who.token, `/v1/contributions/${id}/respond`, data);
  assert.equal((await respond(alice, adit.id, { value: 1, ...at(0) })).status, 403);
  const remote = await respond(bob, adit.id, { value: 1 });
  assert.equal(remote.status, 422, "no fix, no verdict");
  assert.equal(remote.json.error, "not_on_site");
  const tooFar = await respond(carol, adit.id, { value: 1, ...at(80) });
  assert.equal(tooFar.json.error, "not_on_site", "80 m from the point is not at it");
  const staleFix = await respond(carol, adit.id, { value: 1, ...at(10), captured_at: Date.now() - 40 * DAY });
  assert.equal(staleFix.json.error, "capture_too_old");
  const v = await respond(bob, adit.id, { value: 1, ...at(70) });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.contribution.status, "confirmed");
  assert.equal(v.json.contribution.confirms, 2);

  // Two visitors can't see it: 2 of 4 agree.
  const dave = signIn(db(), "google", "dave");
  await respond(carol, adit.id, { value: -1, ...at(5) });
  const d = await respond(dave, adit.id, { value: -1, ...at(5) });
  assert.equal(d.json.contribution.status, "disputed");
  assert.equal(d.json.contribution.disputes, 2);
  // Changing your mind replaces your verdict rather than adding one.
  const back = await respond(dave, adit.id, { value: 1, ...at(5) });
  assert.equal(back.json.contribution.confirms, 3);
  assert.equal(back.json.contribution.disputes, 1);

  // A search is checked against the published spot and its own radius.
  const nfId = nf.json.contribution.id;
  assert.equal((await respond(bob, nfId, { value: 1, ...north(MINE, 200), accuracy_m: 10, captured_at: Date.now() })).json.error, "not_on_site");
  assert.equal((await respond(bob, nfId, { value: 1, ...north(MINE, 100), accuracy_m: 10, captured_at: Date.now() })).status, 200);

  // Helpful: notes only, from anywhere; it never moves a status.
  const h = await respond(bob, noteBody.id, { helpful: true });
  assert.equal(h.status, 200, JSON.stringify(h.json));
  assert.equal(h.json.contribution.helpful, 1);
  assert.equal(h.json.contribution.status, "unconfirmed");
  assert.equal((await respond(bob, noteBody.id, { value: 1, ...at(0) })).status, 400);
  assert.equal((await respond(carol, adit.id, { helpful: true })).status, 400);

  // Two abuse flags hide a report, and the next delta pull tells devices to drop it.
  const cursor = pull0.cursor;
  assert.equal((await post(bob.token, `/v1/contributions/${shaft.id}/report`, { reason: "spam" })).status, 204);
  assert.equal((await post(carol.token, `/v1/contributions/${shaft.id}/report`, { reason: "inappropriate" })).status, 204);
  const pull1 = await pull(cursor);
  assert.ok(pull1.deleted.includes(shaft.id));
  assert.ok(!pull1.contributions.some((c: any) => c.id === shaft.id));

  // Bob blocks Alice: her reports come back as ids for his app to hide; her id never does.
  assert.equal((await post(alice.token, `/v1/contributions/${adit.id}/block`, {})).status, 403);
  assert.equal((await post(bob.token, `/v1/contributions/${adit.id}/block`, {})).status, 204);
  const blocks = (await (await fetch(`${base}/v1/me/blocks`, { headers: { authorization: `Bearer ${bob.token}` } })).json()) as any;
  assert.equal(blocks.authors, 1);
  assert.deepEqual([...blocks.ids].sort(), [adit.id, shaft.id, nfId, noteBody.id].sort());

  // An author can take one report back; nobody else can.
  const mistake = { id: randomUUID(), kind: "note", minfilno: MINE.minfilno, text: "Wrong mine, sorry." };
  assert.equal((await submit(bob.token, mistake, [])).status, 201);
  const delOne = (who: { token: string }) =>
    fetch(`${base}/v1/contributions/${mistake.id}`, { method: "DELETE", headers: { authorization: `Bearer ${who.token}` } });
  assert.equal((await delOne(alice)).status, 403);
  assert.equal((await delOne(bob)).status, 204);
  assert.equal((await delOne(bob)).status, 404);
  const taken = db().prepare("SELECT removed, text FROM contributions WHERE id = ?").get(mistake.id) as any;
  assert.deepEqual([taken.removed, taken.text], [1, null]);
  const bobs = (await (await fetch(`${base}/v1/me/submissions`, { headers: { authorization: `Bearer ${bob.token}` } })).json()) as any;
  assert.ok(!bobs.contributions.some((c: any) => c.id === mistake.id));

  // Account deletion wipes Alice's reports and her session.
  const del = await fetch(`${base}/v1/me`, { method: "DELETE", headers: { authorization: `Bearer ${alice.token}` } });
  assert.equal(del.status, 204);
  assert.equal((await fetch(`${base}/v1/me/submissions`, { headers: { authorization: `Bearer ${alice.token}` } })).status, 401);
  const row = db().prepare("SELECT removed, text, user_id, lat, user_lat FROM contributions WHERE id = ?").get(adit.id) as any;
  assert.equal(row.removed, 1);
  assert.equal(row.text, null);
  assert.equal(row.user_id, null);
  assert.equal(row.user_lat, row.lat, "where she stood is gone");
  const gone = db().prepare("SELECT lat, user_lat FROM contributions WHERE id = ?").get(nfId) as any;
  assert.deepEqual([gone.lat, gone.user_lat], [null, null], "a search keeps no position at all");
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM photos p JOIN contributions c ON c.id = p.contribution_id WHERE c.user_id IS NULL").get() as any).n, 0);
});

test("admin page", async () => {
  const erin = signIn(db(), "google", "erin");
  const m = located(north(MINE, 30), { captured_at: Date.now() - 20 * 3_600_000 });
  assert.equal((await submit(erin.token, m)).status, 201);
  const auth = (pw: string) => ({ authorization: `Basic ${Buffer.from(`staff:${pw}`).toString("base64")}` });

  delete process.env.ADMIN_PASSWORD;
  assert.equal((await fetch(`${base}/admin`, { headers: auth("x") })).status, 404, "no password set = no page");
  process.env.ADMIN_PASSWORD = "correct horse";
  try {
    assert.equal((await fetch(`${base}/admin`)).status, 401);
    assert.equal((await fetch(`${base}/admin`, { headers: auth("wrong") })).status, 401);
    const page = await fetch(`${base}/admin`, { headers: auth("correct horse") });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, new RegExp(m.id));
    assert.match(html, /MINFILE 082FSW296/);

    const act = (headers: Record<string, string>) =>
      fetch(`${base}/admin/approve/${m.id}`, { method: "POST", redirect: "manual", headers: { ...auth("correct horse"), ...headers } });
    assert.equal((await act({ origin: "https://evil.example" })).status, 403, "cross-site POST refused");
    assert.equal((await act({})).status, 303);
    assert.equal((db().prepare("SELECT approved FROM contributions WHERE id = ?").get(m.id) as any).approved, 1);

    // Approved, it leaves the queue but is still listed under its mine, where staff can remove it.
    assert.doesNotMatch(await (await fetch(`${base}/admin`, { headers: auth("correct horse") })).text(), new RegExp(`data-id="${m.id}"`));
    const minePage = await (await fetch(`${base}/admin?mine=${MINE.minfilno}`, { headers: auth("correct horse") })).text();
    assert.match(minePage, new RegExp(`action="/admin/remove/${m.id}\\?mine=${MINE.minfilno}"`));
    const rm = await fetch(`${base}/admin/remove/${m.id}?mine=${MINE.minfilno}`, { method: "POST", redirect: "manual", headers: auth("correct horse") });
    assert.equal(rm.status, 303);
    assert.match(rm.headers.get("location") ?? "", new RegExp(`^/admin\\?mine=${MINE.minfilno}&msg=`), "back to the mine's list");
    assert.equal((db().prepare("SELECT removed FROM contributions WHERE id = ?").get(m.id) as any).removed, 1);
  } finally {
    delete process.env.ADMIN_PASSWORD;
  }
});

test("attestation modes", async () => {
  const finn = signIn(db(), "google", "finn");
  const note = () => ({ id: randomUUID(), kind: "note", minfilno: MINE.minfilno, text: "Road washed out at km 6." });

  // log (the default): accepted, and the missing check is written down for staff.
  const logged = await submit(finn.token, note(), []);
  assert.equal(logged.status, 201, JSON.stringify(logged.json));
  assert.equal(logged.json.attest, "none");
  assert.equal((db().prepare("SELECT attest FROM contributions WHERE id = ?").get(logged.json.contribution.id) as any).attest, "none");

  process.env.ATTESTATION = "enforce";
  try {
    const refused = await submit(finn.token, note(), []);
    assert.equal(refused.status, 403);
    assert.equal(refused.json.error, "attestation_required");
  } finally {
    delete process.env.ATTESTATION;
  }
});

test("locations in parks and reserves wait for review; notes don't", async () => {
  const gus = signIn(db(), "apple", "gus");
  // Past probation: three approved reports, long ago.
  const uid = (db().prepare("SELECT id FROM users WHERE sub = 'gus'").get() as any).id;
  for (let i = 0; i < 3; i++) {
    db().prepare(
      `INSERT INTO contributions (id, user_id, minfilno, kind, text, captured_at, approved, created_at, seq)
       VALUES (?, ?, ?, 'note', 'old', 1, 1, 1, 1)`,
    ).run(randomUUID(), uid, MINE.minfilno);
  }
  const inPark = located(PARK, { minfilno: PARK.minfilno });
  const held = await submit(gus.token, inPark);
  assert.equal(held.status, 201, JSON.stringify(held.json));
  assert.equal(held.json.contribution.status, "pending");
  assert.equal(held.json.contribution.held_for, "Provincial park: GARIBALDI PARK");

  const note = await submit(gus.token, { id: randomUUID(), kind: "note", minfilno: PARK.minfilno, text: "Trail to the adit is closed." }, []);
  assert.equal(note.status, 201, JSON.stringify(note.json));
  assert.equal(note.json.contribution.status, "unconfirmed", "a trusted account's note publishes straight away");
  assert.equal(note.json.contribution.held_for, null);
});
