import AsyncStorage from "@react-native-async-storage/async-storage";

import { formatDMS } from "@/lib/geo";

const KEY = "sgs:coords:format_v1";

/**
 * How latitude/longitude are rendered where there is only room for one
 * notation. DMS stays the default — it matches how MINFILE publishes
 * coordinates — but decimal degrees is what most people paste into another
 * app, so the choice is persisted per device.
 */
export type CoordFormat = "dms" | "dd";

export const DEFAULT_COORD_FORMAT: CoordFormat = "dms";

function isCoordFormat(v: string | null): v is CoordFormat {
  return v === "dms" || v === "dd";
}

export async function loadCoordFormat(): Promise<CoordFormat> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return isCoordFormat(v) ? v : DEFAULT_COORD_FORMAT;
  } catch {
    return DEFAULT_COORD_FORMAT;
  }
}

export async function saveCoordFormat(format: CoordFormat): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, format);
  } catch {
    // ignore persistence errors — the in-memory choice still holds for the session
  }
}

export function otherFormat(format: CoordFormat): CoordFormat {
  return format === "dms" ? "dd" : "dms";
}

/** Button label for a format, used on the control that switches between them. */
export function coordFormatLabel(format: CoordFormat): string {
  return format === "dms" ? "DMS" : "Decimal Degrees";
}

/** Six decimals ≈ 0.1 m, well past what a phone GPS can resolve. */
export function formatDecimalDegrees(value: number): string {
  return `${value.toFixed(6)}°`;
}

export function formatCoord(
  value: number,
  isLat: boolean,
  format: CoordFormat,
): string {
  return format === "dms" ? formatDMS(value, isLat) : formatDecimalDegrees(value);
}
