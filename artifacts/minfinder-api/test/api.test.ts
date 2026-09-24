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
import { distanceM, tier, travelKmh } from "../src/rules.ts";
import { createApp } from "../src/server.ts";

test("tier ladder", () => {
  const base = { approved: true, staffVerified: false, net: 0, onSiteUp: 0, reports: 0 };
  assert.equal(tier({ ...base, approved: false, net: 10 }), "pending");
  assert.equal(tier(base), "unverified");
  assert.equal(tier({ ...base, net: 3 }), "unverified", "remote votes alone never confirm");
  assert.equal(tier({ ...base, net: 3, onSiteUp: 1 }), "confirmed");
  assert.equal(tier({ ...base, staffVerified: true }), "verified");
  assert.equal(tier({ ...base, net: -3, staffVerified: true }), "hidden", "downvotes beat staff: it goes back to review");
  assert.equal(tier({ ...base, reports: 2 }), "hidden");
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

const NELSON = { lat: 49.4928, lon: -117.2948 };
function body(over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(), lat: NELSON.lat, lon: NELSON.lon, user_lat: NELSON.lat, user_lon: NELSON.lon,
    accuracy_m: 8, mocked: false, captured_at: Date.now() - 3_600_000, type: "adit", hazards: ["unstable_portal"],
    notes: "Collapsed 15 m in", safety_ack: true, ...over,
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

test("submission, safeguards, voting and sync", async () => {
  const alice = signIn(db(), "apple", "alice");
  const bob = signIn(db(), "google", "bob");

  const anon = await fetch(`${base}/v1/submissions`, { method: "POST" });
  assert.equal(anon.status, 401);

  // First submission lands in probation and stays out of the public pull.
  const first = body();
  const s1 = await submit(alice.token, first);
  assert.equal(s1.status, 201, JSON.stringify(s1.json));
  assert.equal(s1.json.mine.tier, "pending");
  assert.equal(s1.json.mine.photos.length, 1);
  assert.equal((await (await fetch(`${base}/v1/mines?since=0`)).json() as any).mines.length, 0);

  // A retry after a lost response is answered from the stored row, not duplicated.
  const retry = await submit(alice.token, first);
  assert.equal(retry.status, 200);
  assert.equal(retry.json.mine.id, first.id);

  // Photos of pending mines are the author's alone.
  const photoUrl = `${base}/v1/photos/${s1.json.mine.photos[0]}.jpg`;
  assert.equal((await fetch(photoUrl)).status, 404);
  const own = await fetch(photoUrl, { headers: { authorization: `Bearer ${alice.token}` } });
  assert.equal(own.status, 200);
  const alicesPhoto = Buffer.from(await own.arrayBuffer());
  const meta = await sharp(alicesPhoto).metadata();
  assert.equal(meta.exif, undefined, "EXIF must be stripped");

  // Server-side checks.
  const reject = async (over: Record<string, unknown>, status: number, code: string, photos?: Buffer[]) => {
    const r = await submit(alice.token, body(over), photos);
    assert.equal(r.status, status, `${code}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error, code);
  };
  await reject({ lat: NELSON.lat + 0.0005, user_lat: NELSON.lat + 0.0005 }, 409, "too_close_to_yours"); // ~55 m from her first
  await reject({ lat: NELSON.lat + 0.01, user_lat: NELSON.lat + 0.0093 }, 422, "pin_too_far"); // ~78 m nudge
  await reject({ accuracy_m: 45 }, 422, "gps_inaccurate");
  await reject({ lat: 45, lon: -75, user_lat: 45, user_lon: -75 }, 422, "outside_bc");
  await reject({ captured_at: Date.now() - 40 * 86_400_000 }, 422, "capture_too_old");
  await reject({ mocked: true }, 400, "invalid");
  await reject({ safety_ack: false }, 400, "invalid");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>');
  await reject({ lat: 49.7, lon: -117.29, user_lat: 49.7, user_lon: -117.29, captured_at: Date.now() }, 422, "not_an_image", [svg]);
  // 55 km away, captured one minute after the first: over 3000 km/h.
  await reject({ lat: 50, lon: -117.2948, user_lat: 50, user_lon: -117.2948, captured_at: first.captured_at + 60_000 }, 422, "impossible_travel");

  // Release Alice's first from probation, as staff would with `admin.ts approve`.
  const d = db();
  d.prepare("UPDATE mines SET approved = 1 WHERE id = ?").run(first.id);
  d.prepare("UPDATE mines SET seq = (SELECT v + 1 FROM meta WHERE k = 'seq') WHERE id = ?").run(first.id);
  d.prepare("UPDATE meta SET v = v + 1 WHERE k = 'seq'").run();

  const pull0 = (await (await fetch(`${base}/v1/mines?since=0`)).json()) as any;
  assert.deepEqual(pull0.mines.map((m: any) => m.id), [first.id]);
  assert.equal(pull0.mines[0].tier, "unverified");

  // Bob can't drop a duplicate on it; the error hands his app the mine to confirm instead.
  const dup = await submit(bob.token, body({ lat: NELSON.lat + 0.0001, user_lat: NELSON.lat + 0.0001 }));
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error, "duplicate");
  assert.equal(dup.json.mine_id, first.id);

  // Bob can't reuse Alice's photo on a new mine elsewhere either.
  const reused = await submit(bob.token, body({ lat: 49.6, lon: -117.3, user_lat: 49.6, user_lon: -117.3 }), [alicesPhoto]);
  assert.equal(reused.json.error, "photo_reused");

  // Voting: authors can't vote on their own; an on-site upvote counts double.
  assert.equal((await post(alice.token, `/v1/mines/${first.id}/vote`, { value: 1 })).status, 403);
  const v = await post(bob.token, `/v1/mines/${first.id}/vote`, { value: 1, lat: NELSON.lat, lon: NELSON.lon, accuracy_m: 10 });
  assert.equal(v.status, 200);
  assert.equal(v.json.mine.net, 2);
  assert.equal(v.json.mine.on_site_up, 1);
  const carol = signIn(db(), "apple", "carol");
  const v2 = await post(carol.token, `/v1/mines/${first.id}/vote`, { value: 1 });
  assert.equal(v2.json.mine.net, 3);
  assert.equal(v2.json.mine.tier, "confirmed");

  // Two reports hide it, and the next delta pull tells devices to drop it.
  const cursor = pull0.cursor;
  assert.equal((await post(bob.token, `/v1/mines/${first.id}/report`, { reason: "wrong_location" })).status, 204);
  assert.equal((await post(carol.token, `/v1/mines/${first.id}/report`, { reason: "duplicate" })).status, 204);
  const pull1 = (await (await fetch(`${base}/v1/mines?since=${cursor}`)).json()) as any;
  assert.deepEqual(pull1.mines, []);
  assert.deepEqual(pull1.deleted, [first.id]);

  // Bob blocks Alice: her mines come back as ids for his app to hide; her id never does.
  assert.equal((await post(alice.token, `/v1/mines/${first.id}/block`, {})).status, 403);
  assert.equal((await post(bob.token, `/v1/mines/${first.id}/block`, {})).status, 204);
  const blocks = (await (await fetch(`${base}/v1/me/blocks`, { headers: { authorization: `Bearer ${bob.token}` } })).json()) as any;
  assert.deepEqual(blocks, { authors: 1, mine_ids: [first.id] });

  // Account deletion wipes Alice's submission and her session.
  const del = await fetch(`${base}/v1/me`, { method: "DELETE", headers: { authorization: `Bearer ${alice.token}` } });
  assert.equal(del.status, 204);
  assert.equal((await fetch(`${base}/v1/me/submissions`, { headers: { authorization: `Bearer ${alice.token}` } })).status, 401);
  const row = db().prepare("SELECT removed, notes, user_id, lat, user_lat FROM mines WHERE id = ?").get(first.id) as any;
  assert.equal(row.removed, 1);
  assert.equal(row.notes, null);
  assert.equal(row.user_id, null);
  assert.equal(row.user_lat, row.lat, "where she stood is gone");
});

test("admin page", async () => {
  const dave = signIn(db(), "google", "dave");
  const m = body({ lat: 49.3, lon: -117.6, user_lat: 49.3, user_lon: -117.6 });
  assert.equal((await submit(dave.token, m)).status, 201);
  const auth = (pw: string) => ({ authorization: `Basic ${Buffer.from(`staff:${pw}`).toString("base64")}` });

  delete process.env.ADMIN_PASSWORD;
  assert.equal((await fetch(`${base}/admin`, { headers: auth("x") })).status, 404, "no password set = no page");
  process.env.ADMIN_PASSWORD = "correct horse";
  try {
    assert.equal((await fetch(`${base}/admin`)).status, 401);
    assert.equal((await fetch(`${base}/admin`, { headers: auth("wrong") })).status, 401);
    const page = await fetch(`${base}/admin`, { headers: auth("correct horse") });
    assert.equal(page.status, 200);
    assert.match(await page.text(), new RegExp(m.id));

    const act = (headers: Record<string, string>) =>
      fetch(`${base}/admin/approve/${m.id}`, { method: "POST", redirect: "manual", headers: { ...auth("correct horse"), ...headers } });
    assert.equal((await act({ origin: "https://evil.example" })).status, 403, "cross-site POST refused");
    assert.equal((await act({})).status, 303);
    const row = db().prepare("SELECT approved FROM mines WHERE id = ?").get(m.id) as any;
    assert.equal(row.approved, 1);
  } finally {
    delete process.env.ADMIN_PASSWORD;
  }
});

test("attestation modes", async () => {
  const erin = signIn(db(), "google", "erin");
  const at = (n: number) => body({ lat: 49.2 + n / 10, lon: -117.9, user_lat: 49.2 + n / 10, user_lon: -117.9, captured_at: Date.now() - n * 7_200_000 });

  // log (the default): accepted, and the missing check is written down for staff.
  const logged = await submit(erin.token, at(1));
  assert.equal(logged.status, 201, JSON.stringify(logged.json));
  assert.equal(logged.json.attest, "none");
  assert.equal((db().prepare("SELECT attest FROM mines WHERE id = ?").get(logged.json.mine.id) as any).attest, "none");

  process.env.ATTESTATION = "enforce";
  try {
    const refused = await submit(erin.token, at(2));
    assert.equal(refused.status, 403);
    assert.equal(refused.json.error, "attestation_required");
  } finally {
    delete process.env.ATTESTATION;
  }
});

test("mines in parks and reserves wait for review", async () => {
  const fay = signIn(db(), "apple", "fay");
  // Past probation: three approved mines, long ago and far away.
  const uid = (db().prepare("SELECT id FROM users WHERE sub = 'fay'").get() as any).id;
  for (let i = 0; i < 3; i++) {
    db().prepare(
      `INSERT INTO mines (id, user_id, lat, lon, user_lat, user_lon, accuracy_m, captured_at, type, approved, created_at, seq)
       VALUES (?, ?, 55, ?, 55, ?, 5, 1, 'adit', 1, 1, 1)`,
    ).run(randomUUID(), uid, -124 - i, -124 - i);
  }
  const garibaldi = { lat: 49.935, lon: -123.035, user_lat: 49.935, user_lon: -123.035, captured_at: Date.now() - 3_600_000 };
  const held = await submit(fay.token, body(garibaldi));
  assert.equal(held.status, 201, JSON.stringify(held.json));
  assert.equal(held.json.mine.tier, "pending");
  assert.equal(held.json.mine.held_for, "Provincial park: GARIBALDI PARK");

  const outside = { lat: 49.35, lon: -121.0, user_lat: 49.35, user_lon: -121.0, captured_at: Date.now() - 30 * 3_600_000 };
  const open = await submit(fay.token, body(outside));
  assert.equal(open.status, 201, JSON.stringify(open.json));
  assert.equal(open.json.mine.tier, "unverified", "outside any area, a trusted account publishes straight away");
  assert.equal(open.json.mine.held_for, null);
});
