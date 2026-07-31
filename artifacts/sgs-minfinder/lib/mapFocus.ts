import type { Bounds } from "./mapGeo";

/**
 * One-shot hand-off from the Offline-maps screen to the map screen: "show this
 * downloaded region when you next become visible".
 *
 * Why a module slot rather than route params. `/offline` is pushed on top of
 * `/`, so the map screen is still mounted underneath — and it must stay that
 * way, because mounting it reads ~100k MINFILE rows out of SQLite. That rules
 * out `router.push("/")` (which appends a *second* copy of the route). Params
 * on a `dismissTo` would work, but `useLocalSearchParams()` rebuilds its result
 * object on every render — and the map re-renders on every GPS tick — which
 * makes it easy to re-fire a camera animation by accident. Params would also
 * stay attached to the root route forever, and would force the numeric bounds
 * tuple through string serialisation.
 *
 * The consumer claims the request exactly once (see `takePendingFocusRegion`),
 * which is also what stops the camera yanking back to the region every time the
 * user returns to the map from Compass or About.
 */
export interface FocusRegion {
  /** MapLibre offline pack id — the identity of the on-map outline. */
  id: string;
  /** Label shown in the map's region pill. */
  name: string;
  bounds: Bounds;
  /** `metadata.createdAt` epoch ms, when the pack recorded one. */
  createdAt?: number;
  /** True when the pack had not finished downloading. */
  incomplete?: boolean;
}

let pending: FocusRegion | null = null;

export function setPendingFocusRegion(region: FocusRegion): void {
  pending = region;
}

/** Reads and clears the pending region; null when nothing is queued. */
export function takePendingFocusRegion(): FocusRegion | null {
  const region = pending;
  pending = null;
  return region;
}
