import { randomUUID } from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import { AppState } from "react-native";

import { api, ApiError, isSignedIn, signOut } from "@/lib/auth";
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
  await kvSet("my_submissions", []);
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
    form.append("data", row.data);
    (JSON.parse(row.photos) as string[]).forEach((uri, i) =>
      // React Native's FormData streams a file from { uri, name, type }.
      form.append("photo", { uri, name: `${i}.jpg`, type: "image/jpeg" } as unknown as Blob),
    );
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
      const attempts = row.attempts + 1;
      await db.runAsync(
        "UPDATE outbox SET attempts = ?, next_at = ?, error = ?, message = ? WHERE id = ?",
        [
          attempts,
          Date.now() + Math.min(30_000 * 2 ** attempts, BACKOFF_MAX_MS),
          e instanceof ApiError ? e.code : "network",
          e instanceof ApiError ? e.message : null,
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
  notify();
}

async function run(): Promise<void> {
  const net = await Network.getNetworkStateAsync();
  if (!net.isConnected || net.isInternetReachable === false) return;
  for (const step of [pushOutbox, pull, refreshMine]) {
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
export function startSync(): () => void {
  void sync();
  const app = AppState.addEventListener("change", (s) => {
    if (s === "active") void sync();
  });
  const net = Network.addNetworkStateListener((s) => {
    if (s.isConnected && s.isInternetReachable !== false) void sync();
  });
  return () => {
    app.remove();
    net.remove();
  };
}
