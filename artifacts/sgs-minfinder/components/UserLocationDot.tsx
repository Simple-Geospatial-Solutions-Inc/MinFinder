import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { Marker } from "react-native-maps";

/**
 * Custom user-location marker. We render this in addition to
 * `showsUserLocation` because Android's native blue dot is unreliable when
 * the basemap is `mapType="none"` with a custom UrlTile overlay — it
 * frequently fails to draw on top of the tiles. This SVG/View marker
 * always renders.
 *
 * Visual: solid blue dot with a soft white halo and a slow pulsing ring.
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
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.4] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      flat
      rotation={typeof heading === "number" ? heading : 0}
      zIndex={9999}
    >
      <View style={styles.wrap}>
        <Animated.View
          style={[
            styles.ring,
            { transform: [{ scale: ringScale }], opacity: ringOpacity },
          ]}
        />
        <View style={styles.halo} />
        <View style={styles.dot} />
      </View>
    </Marker>
  );
}

const DOT = 16;
const HALO = 26;
const RING = 34;

const styles = StyleSheet.create({
  wrap: {
    width: RING,
    height: RING,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    backgroundColor: "#1E88E5",
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
