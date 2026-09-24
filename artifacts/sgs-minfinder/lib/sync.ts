import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import * as Network from "expo-network";
import { AppState } from "react-native";

import { api, ApiError, isSignedIn, signOut } from "@/lib/auth";
import { distanceMeters } from "@/lib/geo";
import { getUserDb, kvGet, kvSet } from "@/lib/userDb";

/**
 * Offline-first sync for Community Mines. Everything the UI shows comes out of
 * user.db; the network only ever feeds that database.
 *
 * One pass: push the outbox, pull the public delta, then refresh the user's own
 * submissions. Runs on launch, on returning to the foreground, when the network
 * comes back and right after a capture.
 *
 * ponytail: foreground only. Add expo-background-task if field users report
 * uploads waiting until they next open the app.
 */

export const MINE_TYPES = [
  ["adit", "Adit"],
  ["shaft", "Shaft"],
  ["open_pit", "Open pit"],
  ["trench", "Trench"],
  ["prospect_pit", "Prospect pit"],
  ["tailings", "Tailings / dump"],
  ["structure", "Structure / camp"],
  ["other", "Other"],
] as const;
export type MineType = (typeof MINE_TYPES)[number][0];

export const HAZARDS = [
  ["open_shaft", "Open shaft"],
  ["unstable_portal", "Unstable portal"],
  ["flooded", "Flooded"],
  ["bad_air", "Bad air"],
  ["other", "Other hazard"],
] as const;
export type Hazard = (typeof HAZARDS)[number][0];

/** The `data` part of POST /v1/submissions (see artifacts/minfinder-api/README.md). */
export interface Submission {
  id: string;
  lat: number;
  lon: number;
  user_lat: number;
  user_lon: number;
  accuracy_m: number;
  mocked: false;
  captured_at: number;
  type: MineType;
  name?: string;
  commodity?: string;
  hazards: Hazard[];
  notes?: string;
  safety_ack: true;
}

export type Tier = "pending" | "unverified" | "confirmed" | "verified" | "hidden";

/** A mine as the server serializes it. */
export interface Mine {
  id: string;
  lat: number;
  lon: number;
  type: MineType;
  name: string | null;
  commodity: string | null;
  hazards: Hazard[];
  notes: string | null;
  captured_at: number;
  nudge_m: number;
  tier: Tier;
  net: number;
  ups: number;
  downs: number;
  on_site_up: number;
  photos: string[];
  seq: number;
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

// --- Change notification: screens re-read user.db when this fires. ---------
const listeners = new Set<() => void>();
export function onSyncChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
const notify = () => listeners.forEach((l) => l());

// --- Outbox ------------------------------------------------------------------

/**
 * Saves a capture for upload. The photos are copied out of the picker's cache
 * straight away, because the OS may purge that directory before we get signal.
 */
export async function queueSubmission(
  data: Omit<Submission, "id">,
  photoUris: string[],
): Promise<string> {
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

/** The user's uploaded submissions, as of the last sync (including pending review). */
export async function getMySubmissions(): Promise<Mine[]> {
  return (await kvGet<Mine[]>("my_submissions")) ?? [];
}

export interface MyMine {
  lat: number;
  lon: number;
  type: MineType;
  name: string | null;
  captured_at: number;
  uploaded: boolean;
}

/** Everything this user has added: still on the phone, or already uploaded. */
export async function getMyMines(): Promise<MyMine[]> {
  const queued = (await getOutbox())
    .filter((o) => o.state === "queued")
    .map((o) => ({ ...o.data, name: o.data.name ?? null, uploaded: false }));
  const uploaded = (await getMySubmissions()).map((m) => ({ ...m, uploaded: true }));
  return [...queued, ...uploaded];
}

/** A mine on the home map: the public cache plus this user's own, uploaded or not. */
export interface MapMine extends Mine {
  own: boolean;
  /** Still in the outbox: `photos` are file:// uris, not server photo ids. */
  queued: boolean;
}

export async function getMapMines(): Promise<MapMine[]> {
  const db = await getUserDb();
  const rows = await db.getAllAsync<{ json: string }>("SELECT json FROM community_mines");
  const mine = await getMySubmissions();
  const ownIds = new Set(mine.map((m) => m.id));
  const blocked = new Set((await getBlocks()).mine_ids);
  const out = new Map<string, MapMine>();
  for (const r of rows) {
    const m = JSON.parse(r.json) as Mine;
    if (blocked.has(m.id)) continue;
    out.set(m.id, { ...m, own: ownIds.has(m.id), queued: false });
  }
  // Pending and hidden ones never reach the public cache; the author still sees them.
  for (const m of mine) if (!out.has(m.id)) out.set(m.id, { ...m, own: true, queued: false });
  for (const o of await getOutbox()) {
    if (o.state !== "queued") continue;
    const d = o.data;
    out.set(d.id, {
      ...d,
      name: d.name ?? null,
      commodity: d.commodity ?? null,
      notes: d.notes ?? null,
      nudge_m: Math.round(distanceMeters(d.lat, d.lon, d.user_lat, d.user_lon)),
      tier: "pending",
      net: 0,
      ups: 0,
      downs: 0,
      on_site_up: 0,
      photos: o.photos,
      seq: 0,
      own: true,
      queued: true,
    });
  }
  return [...out.values()];
}

/** Public community mines near a point, from the local cache. */
export async function communityMinesNear(lat: number, lon: number, radiusM: number): Promise<Mine[]> {
  const dLat = radiusM / 111_320;
  const db = await getUserDb();
  const rows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM community_mines WHERE lat BETWEEN ? AND ?",
    [lat - dLat, lat + dLat],
  );
  return rows.map((r) => JSON.parse(r.json) as Mine);
}

export async function signOutAndForget(): Promise<void> {
  await signOut();
  for (const key of ["my_submissions", "my_votes", "pending_votes"]) await kvSet(key, key === "my_submissions" ? [] : {});
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

// --- Votes, reports, blocks --------------------------------------------------------

export type VoteValue = -1 | 0 | 1;
interface PendingVote {
  value: VoteValue;
  lat?: number;
  lon?: number;
  accuracy_m?: number;
}

/** What the user last pressed on each mine, uploaded or not. */
export async function getMyVotes(): Promise<{ votes: Record<string, VoteValue>; pending: Set<string> }> {
  const votes = (await kvGet<Record<string, VoteValue>>("my_votes")) ?? {};
  const pending = (await kvGet<Record<string, PendingVote>>("pending_votes")) ?? {};
  return { votes, pending: new Set(Object.keys(pending)) };
}

/**
 * Records a vote and queues it, so it works with no signal. The last known
 * position rides along: within 150 m of the mine, the server counts it double.
 */
export async function castVote(id: string, value: VoteValue): Promise<void> {
  const votes = (await kvGet<Record<string, VoteValue>>("my_votes")) ?? {};
  if (value === 0) delete votes[id];
  else votes[id] = value;
  await kvSet("my_votes", votes);

  const pos = await Location.getLastKnownPositionAsync({ maxAge: 120_000, requiredAccuracy: 30 }).catch(() => null);
  const pending = (await kvGet<Record<string, PendingVote>>("pending_votes")) ?? {};
  pending[id] = pos
    ? { value, lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy_m: pos.coords.accuracy ?? undefined }
    : { value };
  await kvSet("pending_votes", pending);
  notify();
  void sync();
}

async function pushVotes(): Promise<void> {
  if (!(await isSignedIn())) return;
  const db = await getUserDb();
  const queued = (await kvGet<Record<string, PendingVote>>("pending_votes")) ?? {};
  for (const [id, vote] of Object.entries(queued)) {
    let drop = false;
    try {
      const { mine } = await api<{ mine: Mine }>(`/mines/${id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vote),
      });
      await db.runAsync("UPDATE community_mines SET json = ? WHERE id = ?", [JSON.stringify(mine), id]);
      drop = true;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500 || RETRYABLE.has(e.status)) return; // try again next pass
      drop = true; // gone, hidden, or the user's own: the server won't take it
      const votes = (await kvGet<Record<string, VoteValue>>("my_votes")) ?? {};
      delete votes[id];
      await kvSet("my_votes", votes);
    }
    // Re-read: a newer press while this one was in flight must not be lost.
    const now = (await kvGet<Record<string, PendingVote>>("pending_votes")) ?? {};
    if (drop && JSON.stringify(now[id]) === JSON.stringify(vote)) {
      delete now[id];
      await kvSet("pending_votes", now);
    }
    notify();
  }
}

export const REPORT_REASONS = [
  ["not_a_mine", "It isn't a mine"],
  ["wrong_location", "It's in the wrong place"],
  ["photo_not_this_site", "The photos are of somewhere else"],
  ["duplicate", "It's already on the map"],
  ["inappropriate", "Offensive or inappropriate"],
  ["dangerous", "It sends people somewhere dangerous"],
  ["other", "Something else"],
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number][0];

/** Online only: a report is a request for staff attention, not field data. */
export async function reportMine(id: string, reason: ReportReason): Promise<void> {
  await api(`/mines/${id}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

interface Blocks {
  authors: number;
  mine_ids: string[];
}
const NO_BLOCKS: Blocks = { authors: 0, mine_ids: [] };

export async function getBlocks(): Promise<Blocks> {
  return (await kvGet<Blocks>("blocks")) ?? NO_BLOCKS;
}

async function refreshBlocks(): Promise<void> {
  await kvSet("blocks", await api<Blocks>("/me/blocks"));
}

/** Hides everything by this mine's author. Online only. */
export async function blockAuthor(mineId: string): Promise<void> {
  await api(`/mines/${mineId}/block`, { method: "POST" });
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
    // Rounded here too for captures queued before gps.ts rounded the fix time.
    const data = JSON.parse(row.data);
    data.captured_at = Math.round(data.captured_at);
    form.append("data", JSON.stringify(data));
    for (const uri of JSON.parse(row.photos) as string[]) {
      // Expo's fetch (the global one) takes a File, not React Native's
      // { uri, name, type } parts: it reads the bytes and sends name and type.
      form.append("photo", new File(uri) as unknown as Blob);
    }
    try {
      await api("/submissions", { method: "POST", body: form });
      // Only now, with the server's ack in hand, is it safe to let go of it.
      await discardOutboxItem(row.id);
    } catch (e) {
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
    const r = await api<{ cursor: number; more: boolean; mines: Mine[]; deleted: string[] }>(
      `/mines?since=${cursor}`,
    );
    await db.withExclusiveTransactionAsync(async (t) => {
      for (const m of r.mines) {
        await t.runAsync(
          "INSERT OR REPLACE INTO community_mines (id, lat, lon, json) VALUES (?, ?, ?, ?)",
          [m.id, m.lat, m.lon, JSON.stringify(m)],
        );
      }
      for (const id of r.deleted) await t.runAsync("DELETE FROM community_mines WHERE id = ?", [id]);
      await t.runAsync("INSERT OR REPLACE INTO kv (key, value) VALUES ('cursor', ?)", [String(r.cursor)]);
    });
    cursor = r.cursor;
    if (r.mines.length || r.deleted.length) notify();
    if (!r.more) return;
  }
}

async function refreshMine(): Promise<void> {
  if (!(await isSignedIn())) return;
  const { mines } = await api<{ mines: Mine[] }>("/me/submissions");
  await kvSet("my_submissions", mines);
  await refreshBlocks().catch((e) => console.warn("[sync] blocks", e)); // never hold up the list
  notify();
}

async function run(): Promise<void> {
  const net = await Network.getNetworkStateAsync();
  if (!net.isConnected || net.isInternetReachable === false) return;
  for (const step of [pushOutbox, pushVotes, pull, refreshMine]) {
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

/** Wires the triggers. Mounted once, in app/_layout.tsx. */
// Uploads that failed for want of signal don't wait out their backoff once the
// signal is back; that wait is for a struggling server, not a dead zone.
async function retryOffline(): Promise<void> {
  const db = await getUserDb();
  await db.runAsync("UPDATE outbox SET next_at = 0 WHERE state = 'queued' AND error = 'network'");
  await sync();
}

export function startSync(): () => void {
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
