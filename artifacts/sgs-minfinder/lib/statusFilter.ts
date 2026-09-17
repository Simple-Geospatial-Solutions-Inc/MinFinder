import AsyncStorage from "@react-native-async-storage/async-storage";

import { STATUS_ORDER } from "@/constants/status";

const KEY = "sgs:filters:statuses_v1";

/**
 * Which MINFILE status chips are switched on, persisted per device so the map
 * comes back the way it was left. An empty selection is a legitimate stored
 * value (every chip off) and is kept as-is — the chips row above the map shows
 * why nothing is drawn.
 */
export async function loadStatuses(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw == null) return [...STATUS_ORDER];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...STATUS_ORDER];
    // Drop anything not in the current STATUS_ORDER, so a stored value written
    // by an older build can never filter on a code the UI no longer offers.
    return STATUS_ORDER.filter((code) => parsed.includes(code));
  } catch {
    return [...STATUS_ORDER];
  }
}

export async function saveStatuses(statuses: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(statuses));
  } catch {
    // ignore persistence errors — the in-memory choice still holds for the session
  }
}
