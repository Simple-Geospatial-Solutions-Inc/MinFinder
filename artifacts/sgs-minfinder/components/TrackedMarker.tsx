import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
import { Marker, MapMarkerProps } from "react-native-maps";

/**
 * react-native-maps can capture a custom marker's view to a bitmap when
 * `tracksViewChanges` is true, then re-use that bitmap during pan/zoom.
 *
 * On Android that snapshot is needed: if `tracksViewChanges` starts false the
 * first capture often happens before the React Native subview has laid out,
 * producing an invisible pin. So on Android we keep tracking on for ~250 ms
 * after mount, then disable it to keep the marker static.
 *
 * On iOS this is actively harmful. Toggling `tracksViewChanges` drives the
 * legacy bitmap-snapshot path, and under the New Architecture (which Expo Go
 * always forces on) running that snapshot for a whole batch of markers at once
 * — exactly what happens when clusters re-render on zoom — hard-crashes the
 * app. Our pins have fixed dimensions (see MarkerPin / ClusterPin), so they
 * render correctly without any snapshot. We therefore keep tracking OFF on iOS.
 */
export function TrackedMarker(
  props: MapMarkerProps & { children: React.ReactNode },
) {
  const trackOnMount = Platform.OS === "android";
  const [tracks, setTracks] = useState(trackOnMount);
  useEffect(() => {
    if (!trackOnMount) return;
    const t = setTimeout(() => setTracks(false), 250);
    return () => clearTimeout(t);
  }, [trackOnMount]);
  return <Marker {...props} tracksViewChanges={tracks} />;
}
