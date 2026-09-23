import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";

import type { FeatherIconName } from "@/components/Icon";

// These mirror LIMITS in artifacts/minfinder-api/src/rules.ts. The server is the
// authority; checking here only saves a capture the server would refuse.
export const MAX_ACCURACY_M = 30;
export const MAX_FIX_AGE_MS = 60_000;
export const MAX_NUDGE_M = 50;

export type GpsState = "denied" | "searching" | "mocked" | "stale" | "weak" | "locked";

export interface LiveFix {
  lat: number;
  lon: number;
  accuracy: number;
  /** Metres above sea level, when the phone reports it. */
  altitude: number | null;
  /** The fix's own timestamp, not the phone clock, so a wrong clock can't backdate a capture. */
  time: number;
}

/**
 * Watches the GPS at full accuracy for as long as the capture flow is open, and
 * reduces it to one state the UI can explain. Ticks once a second so a fix that
 * stops updating goes stale on screen, not just on paper.
 */
export function useLiveFix() {
  const [loc, setLoc] = useState<Location.LocationObject | null>(null);
  const [denied, setDenied] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        if (!cancelled) setDenied(true);
        return;
      }
      const s = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        (l) => setLoc(l),
      );
      if (cancelled) s.remove();
      else sub = s;
    })();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      sub?.remove();
      clearInterval(tick);
    };
  }, []);

  const fix: LiveFix | null = loc
    ? {
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? Infinity,
        altitude: loc.coords.altitude ?? null,
        time: loc.timestamp,
      }
    : null;

  const state: GpsState = denied
    ? "denied"
    : !loc
      ? "searching"
      : loc.mocked
        ? "mocked"
        : now - loc.timestamp >= MAX_FIX_AGE_MS
          ? "stale"
          : fix!.accuracy > MAX_ACCURACY_M
            ? "weak"
            : "locked";

  // One tick in the hand when the lock lands, so the user can look up from the
  // screen and still know.
  const wasLocked = useRef(false);
  useEffect(() => {
    if (state === "locked" && !wasLocked.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    wasLocked.current = state === "locked";
  }, [state]);

  return { fix, state };
}

/** What the GPS pill says, in words and an icon (never colour alone). */
export function describeGps(
  state: GpsState,
  accuracy: number | undefined,
): { icon: FeatherIconName; label: string; tone: "ok" | "wait" | "bad" } {
  const acc = accuracy !== undefined && Number.isFinite(accuracy) ? `±${Math.round(accuracy)} m` : "";
  switch (state) {
    case "denied":
      return { icon: "alert-triangle", label: "Location is off", tone: "bad" };
    case "mocked":
      return { icon: "alert-triangle", label: "Mock location is on", tone: "bad" };
    case "searching":
      return { icon: "crosshair", label: "Finding GPS…", tone: "wait" };
    case "stale":
      return { icon: "crosshair", label: "GPS signal lost", tone: "wait" };
    case "weak":
      return { icon: "crosshair", label: `${acc} · move into the open`, tone: "wait" };
    case "locked":
      return { icon: "check", label: `${acc} · Locked`, tone: "ok" };
  }
}
