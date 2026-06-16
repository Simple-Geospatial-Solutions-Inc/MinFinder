import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { Marker, MapMarkerProps } from "react-native-maps";

/**
 * react-native-maps renders a custom marker's React view to a bitmap when
 * `tracksViewChanges` is true, then re-uses that static bitmap while panning
 * and zooming (re-snapshotting every frame is what kills performance).
 *
 * iOS: keep tracking OFF entirely. Toggling `tracksViewChanges` drives the
 * legacy bitmap-snapshot path, and under the New Architecture (which Expo Go
 * always forces on) snapshotting a batch of markers at once — e.g. when
 * clusters re-render on zoom — hard-crashes the app. Our pins have fixed
 * dimensions, so they render correctly as native subviews without a snapshot.
 *
 * Android: a snapshot IS required or the pin paints blank. The catch is timing:
 * if the single capture happens before the pin has finished laying out, Android
 * captures a partial, top-left-clipped bitmap and (because we now reuse markers
 * instead of recreating them every zoom) keeps that broken bitmap forever. So
 * we drive the capture off the child's `onLayout`: keep tracking on, and only
 * switch it off a few frames AFTER layout fires, guaranteeing the full-size pin
 * is captured. The child is wrapped in a `collapsable={false}` view so Android
 * doesn't optimise the snapshot target away.
 */
export function TrackedMarker(
  props: MapMarkerProps & { children: React.ReactNode },
) {
  if (Platform.OS !== "android") {
    return <Marker {...props} tracksViewChanges={false} />;
  }
  return <AndroidTrackedMarker {...props} />;
}

function AndroidTrackedMarker({
  children,
  ...rest
}: MapMarkerProps & { children: React.ReactNode }) {
  const [tracks, setTracks] = useState(true);
  const offTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const captureThenSettle = useCallback(() => {
    setTracks(true);
    if (offTimer.current) clearTimeout(offTimer.current);
    // Keep capturing a few frames past layout so the full-size bitmap lands,
    // then freeze the marker so it stops re-snapshotting.
    offTimer.current = setTimeout(() => setTracks(false), 350);
  }, []);

  useEffect(
    () => () => {
      if (offTimer.current) clearTimeout(offTimer.current);
    },
    [],
  );

  return (
    <Marker {...rest} tracksViewChanges={tracks}>
      <View collapsable={false} onLayout={captureThenSettle}>
        {children}
      </View>
    </Marker>
  );
}
