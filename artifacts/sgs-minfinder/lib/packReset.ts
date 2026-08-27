import AsyncStorage from "@react-native-async-storage/async-storage";

import { PACK_STYLE_VERSION } from "@/lib/mapStyle";

// Keyed by the version that triggered the notice, not a plain boolean, so a
// future PACK_STYLE_VERSION bump tells the user again instead of staying quiet
// because they were warned about some earlier change.
const KEY = "sgs:packs:reset_notice_version";

/**
 * Whether the user has already been told that packs from an older basemap are
 * being removed, for THIS version.
 *
 * Why this exists: bumping PACK_STYLE_VERSION deletes every older pack on
 * sight, which is correct — those packs hold tiles this build never requests,
 * and for the v2 → v3 change they hold improperly cached Esri tiles that ought
 * to come off the device. But deletion is invisible and irreversible. Someone
 * who saved a region for a trip and opens the app at the trailhead would find
 * it simply gone, with no explanation, no idea it needs re-downloading, and
 * usually no connection to do anything about it. Telling them first turns
 * silent data loss into something they can act on while they still have signal.
 */
export async function packResetNoticeSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === String(PACK_STYLE_VERSION);
  } catch {
    // Treat a read failure as "not seen". Showing the notice twice is a much
    // cheaper mistake than never showing it.
    return false;
  }
}

export async function markPackResetNoticeSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(PACK_STYLE_VERSION));
  } catch {
    // Ignore persistence errors — the notice may appear again next launch,
    // which is harmless.
  }
}
