import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Marker } from "react-native-maps";

/**
 * Custom user-location marker. We render this instead of relying on
 * `showsUserLocation` because Android's native blue dot does not reliably
 * paint above a custom UrlTile overlay when `mapType="none"`.
 *
 * Rendering notes
 * ---------------
 * react-native-maps captures a custom marker's children to a bitmap once,
 * then re-uses that bitmap during pan/zoom. We use the same pattern as
 * `TrackedMarker`: keep `tracksViewChanges` true for ~300 ms after mount or
 * whenever the dot's screen position changes so the bitmap is captured
 * after layout, then disable tracking to keep the marker cheap.
 *
 * The marker is intentionally static (no looping animation) because
 * animations inside a bitmapped marker child don't actually animate — the
 * snapshot is frozen. A static dot is what every major map app uses.
 */
export function UserLocationDot({
  latitude,
  longitude,
  heading,
}: {
  latitude: number;
  longitude: number;
  heading?: number | null;
}) {
  const [tracks, setTracks] = useState(true);

  // Re-enable tracking briefly whenever the position changes so the bitmap
  // is recaptured after the marker has been re-laid out at its new spot.
  useEffect(() => {
    setTracks(true);
    const t = setTimeout(() => setTracks(false), 300);
    return () => clearTimeout(t);
  }, [latitude, longitude]);

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracks}
      flat
      rotation={typeof heading === "number" && heading >= 0 ? heading : 0}
      zIndex={9999}
      stopPropagation
    >
      <View style={styles.wrap} pointerEvents="none">
        <View style={styles.halo} />
        <View style={styles.dot} />
      </View>
    </Marker>
  );
}

const DOT = 16;
const HALO = 26;

const styles = StyleSheet.create({
  wrap: {
    width: HALO,
    height: HALO,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    backgroundColor: "rgba(255,255,255,0.95)",
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: "#1E88E5",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
});
