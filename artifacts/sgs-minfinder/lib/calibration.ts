import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "sgs:compass:offset_v1";

/**
 * The compass offset is a degree value added to the raw sensor heading to
 * produce the displayed (corrected) heading:
 *
 *   displayed = (raw + offset + 360) mod 360
 *
 * When the user calibrates by pointing the phone at a reference direction
 * `ref` (0 for true north, or the local declination for magnetic north),
 * we store `offset = (ref - raw + 360) mod 360`.
 */
export async function loadOffset(): Promise<number> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v == null) return 0;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export async function saveOffset(offset: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(offset));
  } catch {
    // ignore persistence errors — the in-memory offset still works for the session
  }
}

export async function clearOffset(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Apply an offset to a raw heading, returning a value in [0, 360). */
export function applyOffset(raw: number, offset: number): number {
  const v = (raw + offset) % 360;
  return v < 0 ? v + 360 : v;
}

/** Compute the offset needed so that `raw` is displayed as `ref`. */
export function offsetForReference(raw: number, ref: number): number {
  const v = (ref - raw) % 360;
  return v < 0 ? v + 360 : v;
}
