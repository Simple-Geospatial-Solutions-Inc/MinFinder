import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import { AppState } from "react-native";

import { attestHeaders, forgetAttestKey } from "@/lib/attest";
import { api, ApiError, isSignedIn, signOut } from "@/lib/auth";
import { getUserDb, kvGet, kvSet } from "@/lib/userDb";

/**
 * Offline-first sync for field reports: members' corrections and updates on
 * MINFILE mines. Everything the UI shows comes out of user.db; the network only
 * ever feeds that database.
 *
 * One pass: push the outbox, push responses, pull the public delta, then
 * refresh the user's own reports. Runs on launch, on returning to the
 * foreground, when the network comes back and right after a capture.
 *
 * ponytail: foreground only. Add expo-background-task if field users report
 * uploads waiting until they next open the app.
 */

// These mirror LIMITS in artifacts/minfinder-api/src/rules.ts. The server is the
// authority; checking here only saves a capture the server would refuse.
export const ON_SITE_M = 75;
export const FAR_ACK_M = 300;
export const MAX_FROM_PUBLISHED_M = 10_000;
export const SEARCH_RADII = [50, 150, 300] as const;
export const MAX_TEXT = 1000;
export const MAX_PHOTOS = 3;

export const LABELS = [
  ["adit", "Adit"],
  ["shaft", "Shaft"],
  ["portal", "Portal"],
  ["trench", "Trench"],
  ["dump", "Waste dump"],
  ["headframe", "Headframe"],
  ["ruins", "Ruins"],
  ["other", "Other"],
] as const;
export type Label = (typeof LABELS)[number][0];
export const LABEL_TEXT = Object.fromEntries(LABELS) as Record<Label, string>;

export type Kind = "location" | "not_found" | "note";

interface OnSiteFix {
  user_lat: number;
  user_lon: number;
  accuracy_m: number;
  mocked: false;
  captured_at: number;
  safety_ack: true;
}

/** The `data` part of POST /v1/submissions (see artifacts/minfinder-api/README.md). */
export type Submission = { id: string; minfilno: string; visit_id?: string; text?: string } & (
  | ({ kind: "location"; lat: number; lon: number; label: Label; far_ack?: boolean } & OnSiteFix)
  | ({ kind: "not_found"; search_radius_m: number } & OnSiteFix)
  | { kind: "note"; text: string }
);
type NewSubmission = Submission extends infer S ? (S extends unknown ? Omit<S, "id"> : never) : never;

export type Status = "pending" | "unconfirmed" | "disputed" | "collapsed" | "confirmed" | "verified" | "hidden";

/** A report as the server serializes it. */
export interface Contribution {
  id: string;
  minfilno: string;
  kind: Kind;
  label: Label | null;
  /** A located working's pin, or where a searcher stood; null on a note. */
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  captured_at: number;
  search_radius_m: number | null;
  distance_m: number | null;
  visit_id: string | null;
  text: string | null;
  status: Status;
  /** On-site visits that agree, the author's own capture included. */
  confirms: number;
  disputes: number;
  last_visit_at: number | null;
  helpful: number;
  photos: string[];
  seq: number;
  /** "Provincial park: GARIBALDI PARK" while a location in a sensitive area waits for review. */
  held_for?: string | null;
}

export interface OutboxItem {
  id: string;
  data: Submission;
  photos: string[];
  state: "queued" | "rejected";
  attempts: number;
  error: string | null;
  message: string | null;
  created_at: number;
}

/** A report as the UI shows it: public, the user's own, or still on this phone. */
export interface Report extends Contribution {
  own: boolean;
  /** Still in the outbox: `photos` are file:// uris, not server photo ids. */
  queued: boolean;
}

// --- Change notification: screens re-read user.db when this fires. ---------
const listeners = new Set<() => void>();
export function onSyncChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
const notify = () => listeners.forEach((l) => l());

// --- Outbox ------------------------------------------------------------------

/**
 * Saves a report for upload. The photos are copied out of the camera's cache
 * straight away, because the OS may purge that directory before we get signal.
 */
export async function queueSubmission(data: NewSubmission, photoUris: string[] = []): Promise<string> {
  const id = randomUUID();
  const dir = `${FileSystem.documentDirectory}outbox/${id}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const photos: string[] = [];
  for (const [i, from] of photoUris.entries()) {
    const to = `${dir}${i}.jpg`;
    await FileSystem.copyAsync({ from, to });
    photos.push(to);
  }
  const db = await getUserDb();
  await db.runAsync(
    "INSERT INTO outbox (id, data, photos, created_at) VALUES (?, ?, ?, ?)",
    [id, JSON.stringify({ ...data, id }), JSON.stringify(photos), Date.now()],
  );
  notify();
  void sync();
  return id;
}

export async function getOutbox(): Promise<OutboxItem[]> {
  const db = await getUserDb();
  const rows = await db.getAllAsync<Record<string, any>>(
    "SELECT * FROM outbox ORDER BY created_at DESC",
  );
  return rows.map((r) => ({ ...r, data: JSON.parse(r.data), photos: JSON.parse(r.photos) }) as OutboxItem);
}

export async function discardOutboxItem(id: string): Promise<void> {
  const db = await getUserDb();
  await db.runAsync("DELETE FROM outbox WHERE id = ?", [id]);
  await FileSystem.deleteAsync(`${FileSystem.documentDirectory}outbox/${id}/`, { idempotent: true });
  notify();
}

/** The user's uploaded reports, as of the last sync (including pending review). */
export async function getMySubmissions(): Promise<Contribution[]> {
  return (await kvGet<Contribution[]>("my_submissions")) ?? [];
}

/** An outbox item as the UI shows it, before the server has had a say. */
function queuedReport(o: OutboxItem): Report {
  const d = o.data;
  const fix = d.kind === "note" ? null : d;
  return {
    id: d.id,
    minfilno: d.minfilno,
    kind: d.kind,
    label: d.kind === "location" ? d.label : null,
    lat: d.kind === "location" ? d.lat : (fix?.user_lat ?? null),
    lon: d.kind === "location" ? d.lon : (fix?.user_lon ?? null),
    accuracy_m: fix?.accuracy_m ?? null,
    captured_at: fix?.captured_at ?? o.created_at,
    search_radius_m: d.kind === "not_found" ? d.search_radius_m : null,
    distance_m: null,
    visit_id: d.visit_id ?? null,
    text: d.text ?? null,
    status: "pending",
    confirms: d.kind === "note" ? 0 : 1,
    disputes: 0,
    last_visit_at: fix?.captured_at ?? null,
    helpful: 0,
    photos: o.photos,
    seq: 0,
    own: true,
    queued: true,
  };
}

/**
 * Every report the user can see: the public cache, their own uploads (pending
 * ones never reach the public cache) and captures still on this phone. Pass a
 * MINFILE number for one mine's reports.
 */
export async function getReports(minfilno?: string): Promise<Report[]> {
  const db = await getUserDb();
  const rows = minfilno
    ? await db.getAllAsync<{ json: string }>("SELECT json FROM contributions WHERE minfilno = ?", [minfilno])
    : await db.getAllAsync<{ json: string }>("SELECT json FROM contributions");
  const mine = (await getMySubmissions()).filter((c) => !minfilno || c.minfilno === minfilno);
  const ownIds = new Set(mine.map((m) => m.id));
  const blocked = new Set((await getBlocks()).ids);
  const out = new Map<string, Report>();
  for (const r of rows) {
    const c = JSON.parse(r.json) as Contribution;
    if (blocked.has(c.id)) continue;
    out.set(c.id, { ...c, own: ownIds.has(c.id), queued: false });
  }
  for (const c of mine) if (!out.has(c.id)) out.set(c.id, { ...c, own: true, queued: false });
  for (const o of await getOutbox()) {
    if (o.state === "queued" && (!minfilno || o.data.minfilno === minfilno)) out.set(o.data.id, queuedReport(o));
  }
  return [...out.values()];
}

/**
 * The line a mine's card leads with, from its reports (see the Field reports
 * mockup): a better location that visitors confirmed, or the Geocaching-style
 * wrench when recent searches found nothing and no location stands up.
 */
export function mineSummary(reports: Report[], now = Date.now()) {
  const recent = (r: Report) => now - r.captured_at < 2 * 365 * 86_400_000;
  const trusted = (r: Report) => r.status === "confirmed" || r.status === "verified";
  const best = reports
    .filter((r) => r.kind === "location" && trusted(r))
    .sort((a, b) => b.confirms - a.confirms)[0];
  const searches = reports.filter(
    (r) => r.kind === "not_found" && recent(r) && r.status !== "collapsed" && r.status !== "hidden" && !r.queued,
  );
  const disputed = !reports.some((r) => r.kind === "location" && trusted(r) && recent(r)) && searches.length >= 2;
  return { best: best ?? null, disputed, searches };
}

export async function signOutAndForget(): Promise<void> {
  await signOut();
  await kvSet("my_submissions", []);
  for (const key of ["my_responses", "pending_responses"]) await kvSet(key, {});
  await kvSet("blocks", NO_BLOCKS);
  notify();
}

/**
 * Deletes the account on the server, then forgets it here. Captures still in the
 * outbox stay on the phone: they're the user's, and upload if they sign in again.
 */
export async function deleteAccount(): Promise<void> {
  await api("/me", { method: "DELETE" });
  await signOutAndForget();
}

// --- Responses, reports, blocks -------------------------------------------------

/** A visitor's verdict with the fix it was given at, or a Helpful on a note. */
export type ResponseBody =
  | { value: -1 | 0 | 1; lat?: number; lon?: number; accuracy_m?: number; captured_at?: number }
  | { helpful: boolean };

/** What the user last pressed on each report: +1 / -1 on site, or Helpful on a note. */
export type MyResponse = {
  value?: -1 | 0 | 1;
  helpful?: boolean;
  /** The Helpful the server last accepted, so a count can add this user's press before it's uploaded. */
  helpfulSent?: boolean;
};

export async function getMyResponses(): Promise<{ mine: Record<string, MyResponse>; pending: Set<string> }> {
  const mine = (await kvGet<Record<string, MyResponse>>("my_responses")) ?? {};
  const pending = (await kvGet<Record<string, ResponseBody>>("pending_responses")) ?? {};
  return { mine, pending: new Set(Object.keys(pending)) };
}

/**
 * Records a response and queues it, so it works with no signal. A verdict
 * carries the fix taken as the user pressed, at the site, which is what the
 * server checks when it finally arrives (up to 30 days later).
 */
export async function respond(id: string, body: ResponseBody): Promise<void> {
  const mine = (await kvGet<Record<string, MyResponse>>("my_responses")) ?? {};
  mine[id] = "helpful" in body ? { ...mine[id], helpful: body.helpful } : { ...mine[id], value: body.value };
  await kvSet("my_responses", mine);
  const pending = (await kvGet<Record<string, ResponseBody>>("pending_responses")) ?? {};
  pending[id] = body;
  await kvSet("pending_responses", pending);
  notify();
  void sync();
}

async function pushResponses(): Promise<void> {
  if (!(await isSignedIn())) return;
  const db = await getUserDb();
  const queued = (await kvGet<Record<string, ResponseBody>>("pending_responses")) ?? {};
  for (const [id, sent] of Object.entries(queued)) {
    let failure: string | null = null;
    try {
      // DEV ONLY: the seeded KELOWNA comments aren't on the server; keep the press on the phone.
      if (!(__DEV__ && id.startsWith("dev-"))) {
        const body = JSON.stringify(sent);
        const { contribution, attest } = await api<{ contribution: Contribution; attest?: string }>(`/contributions/${id}/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await attestHeaders(body)) },
          body,
        });
        if (attest === "fail: unknown key") await forgetAttestKey();
        await db.runAsync("UPDATE contributions SET json = ? WHERE id = ?", [JSON.stringify(contribution), id]);
        // The count that just came back includes this press.
        if ("helpful" in sent) {
          const mine = (await kvGet<Record<string, MyResponse>>("my_responses")) ?? {};
          mine[id] = { ...mine[id], helpfulSent: sent.helpful };
          await kvSet("my_responses", mine);
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "attest_key_unknown") return void (await forgetAttestKey());
      if (!(e instanceof ApiError) || e.status >= 500 || RETRYABLE.has(e.status)) return; // try again next pass
      // Gone, hidden, the user's own, or a fix the server won't count: forget the press.
      failure = e.code;
      const mine = (await kvGet<Record<string, MyResponse>>("my_responses")) ?? {};
      delete mine[id];
      await kvSet("my_responses", mine);
    }
    if (failure) console.warn(`[sync] response to ${id} refused: ${failure}`);
    // Re-read: a newer press while this one was in flight must not be lost.
    const now = (await kvGet<Record<string, ResponseBody>>("pending_responses")) ?? {};
    if (JSON.stringify(now[id]) === JSON.stringify(sent)) {
      delete now[id];
      await kvSet("pending_responses", now);
    }
    notify();
  }
}

export const REPORT_REASONS = [
  ["spam", "Spam or advertising"],
  ["inappropriate", "Offensive or inappropriate"],
  ["photo_not_this_site", "The photos are of somewhere else"],
  ["dangerous", "It sends people somewhere dangerous"],
  ["other", "Something else"],
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number][0];

/** Online only: a flag is a request for staff attention, not field data. */
export async function flagReport(id: string, reason: ReportReason): Promise<void> {
  await api(`/contributions/${id}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

interface Blocks {
  authors: number;
  ids: string[];
}
const NO_BLOCKS: Blocks = { authors: 0, ids: [] };

export async function getBlocks(): Promise<Blocks> {
  return (await kvGet<Blocks>("blocks")) ?? NO_BLOCKS;
}

async function refreshBlocks(): Promise<void> {
  await kvSet("blocks", await api<Blocks>("/me/blocks"));
}

/** Hides everything by this report's author. Online only. */
export async function blockAuthor(id: string): Promise<void> {
  await api(`/contributions/${id}/block`, { method: "POST" });
  await refreshBlocks();
  notify();
}

export async function unblockAll(): Promise<void> {
  await api("/me/blocks", { method: "DELETE" });
  await kvSet("blocks", NO_BLOCKS);
  notify();
}

// --- The sync pass -------------------------------------------------------------

// Errors worth retrying: the server or the network is having a bad moment. Any
// other 4xx is the server's final answer about that submission.
const RETRYABLE = new Set([401, 408, 429]);
const BACKOFF_MAX_MS = 6 * 3600_000;

async function pushOutbox(): Promise<void> {
  if (!(await isSignedIn())) return; // captures wait, marked "sign in to upload"
  const db = await getUserDb();
  const due = await db.getAllAsync<Record<string, any>>(
    "SELECT * FROM outbox WHERE state = 'queued' AND next_at <= ? ORDER BY created_at",
    [Date.now()],
  );
  for (const row of due) {
    const form = new FormData();
    const dataPart = row.data as string;
    form.append("data", dataPart);
    for (const uri of JSON.parse(row.photos) as string[]) {
      // Expo's fetch (the global one) takes a File, not React Native's
      // { uri, name, type } parts: it reads the bytes and sends name and type.
      form.append("photo", new File(uri) as unknown as Blob);
    }
    try {
      // Attested over the data part, the exact string the server hashes.
      const r = await api<{ attest?: string }>("/submissions", { method: "POST", body: form, headers: await attestHeaders(dataPart) });
      if (r?.attest === "fail: unknown key") await forgetAttestKey();
      // Only now, with the server's ack in hand, is it safe to let go of it.
      await discardOutboxItem(row.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === "attest_key_unknown") {
        await forgetAttestKey(); // the next pass registers a new key and retries
        return;
      }
      if (e instanceof ApiError && e.status < 500 && !RETRYABLE.has(e.status)) {
        await db.runAsync(
          "UPDATE outbox SET state = 'rejected', error = ?, message = ? WHERE id = ?",
          [e.code, e.message, row.id],
        );
        notify();
        continue;
      }
      // A fetch that throws is only "no signal" if the phone agrees it's offline;
      // otherwise keep what actually went wrong, so it can be shown and fixed.
      let code = e instanceof ApiError ? e.code : "network";
      let message = e instanceof ApiError ? e.message : null;
      if (!(e instanceof ApiError)) {
        const net = await Network.getNetworkStateAsync().catch(() => null);
        if (net?.isConnected && net.isInternetReachable !== false) {
          code = "upload_failed";
          message = e instanceof Error ? e.message : String(e);
        }
        console.warn("upload failed", e);
      }
      const attempts = row.attempts + 1;
      await db.runAsync(
        "UPDATE outbox SET attempts = ?, next_at = ?, error = ?, message = ? WHERE id = ?",
        [
          attempts,
          Date.now() + Math.min(30_000 * 2 ** attempts, BACKOFF_MAX_MS),
          code,
          message,
          row.id,
        ],
      );
      notify();
      return; // the rest would fail the same way
    }
  }
}

async function pull(): Promise<void> {
  const db = await getUserDb();
  let cursor = (await kvGet<number>("cursor")) ?? 0;
  for (;;) {
    const r = await api<{ cursor: number; more: boolean; contributions: Contribution[]; deleted: string[] }>(
      `/contributions?since=${cursor}`,
    );
    await db.withExclusiveTransactionAsync(async (t) => {
      for (const c of r.contributions) {
        await t.runAsync("INSERT OR REPLACE INTO contributions (id, minfilno, json) VALUES (?, ?, ?)", [
          c.id,
          c.minfilno,
          JSON.stringify(c),
        ]);
      }
      for (const id of r.deleted) await t.runAsync("DELETE FROM contributions WHERE id = ?", [id]);
      await t.runAsync("INSERT OR REPLACE INTO kv (key, value) VALUES ('cursor', ?)", [String(r.cursor)]);
    });
    cursor = r.cursor;
    if (r.contributions.length || r.deleted.length) notify();
    if (!r.more) return;
  }
}

async function refreshMine(): Promise<void> {
  if (!(await isSignedIn())) return;
  const { contributions } = await api<{ contributions: Contribution[] }>("/me/submissions");
  await kvSet("my_submissions", contributions);
  await refreshBlocks().catch((e) => console.warn("[sync] blocks", e)); // never hold up the list
  notify();
}

async function run(): Promise<void> {
  const net = await Network.getNetworkStateAsync();
  if (!net.isConnected || net.isInternetReachable === false) return;
  for (const step of [pushOutbox, pushResponses, pull, refreshMine]) {
    try {
      await step();
    } catch (e) {
      console.warn(`[sync] ${step.name} failed`, e);
    }
  }
}

/** Skips the backoff: after signing in, or when the user taps "Upload now". */
export async function uploadNow(): Promise<void> {
  const db = await getUserDb();
  await db.runAsync("UPDATE outbox SET next_at = 0 WHERE state = 'queued'");
  await sync();
}

let running: Promise<void> | null = null;
let again = false;

/** Starts a sync pass, or queues one more after the pass already running. */
export function sync(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await run();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

// Uploads that failed for want of signal don't wait out their backoff once the
// signal is back; that wait is for a struggling server, not a dead zone.
async function retryOffline(): Promise<void> {
  const db = await getUserDb();
  await db.runAsync("UPDATE outbox SET next_at = 0 WHERE state = 'queued' AND error = 'network'");
  await sync();
}

// DEV ONLY, remove before release: other members' comments on KELOWNA
// (082ENW058), written straight into this phone's cache so the Comments tab
// can be seen with someone else's posts. Never sent to the API.
async function seedDevComments() {
  const day = 86_400_000;
  const now = Date.now();
  const notes: [string, string, number, number][] = [
    ["Gravel access road off the highway is gated in spring. Walked in from the pullout, about 15 minutes.", "dev-kelowna-1", 12, 4],
    ["Old workings are mostly overgrown now. Look for the cut bank on the east side of the pit.", "dev-kelowna-2", 95, 2],
    ["Private land around the north edge, ask before crossing.", "dev-kelowna-3", 400, 0],
  ];
  const db = await getUserDb();
  for (const [text, id, ago, helpful] of notes) {
    const c: Contribution = {
      id, minfilno: "082ENW058", kind: "note", label: null, lat: null, lon: null, accuracy_m: null,
      captured_at: now - ago * day, search_radius_m: null, distance_m: null, visit_id: null, text,
      status: "unconfirmed", confirms: 0, disputes: 0, last_visit_at: null, helpful, photos: [], seq: 0,
    };
    await db.runAsync("INSERT OR REPLACE INTO contributions (id, minfilno, json) VALUES (?, ?, ?)", [id, c.minfilno, JSON.stringify(c)]);
  }
  notify();
}

/** Wires the triggers. Mounted once, in app/_layout.tsx. */
export function startSync(): () => void {
  if (__DEV__) void seedDevComments().catch((e) => console.warn("[dev] seed comments", e));
  void retryOffline();
  const app = AppState.addEventListener("change", (s) => {
    if (s === "active") void retryOffline();
  });
  const net = Network.addNetworkStateListener((s) => {
    if (s.isConnected && s.isInternetReachable !== false) void retryOffline();
  });
  return () => {
    app.remove();
    net.remove();
  };
}
