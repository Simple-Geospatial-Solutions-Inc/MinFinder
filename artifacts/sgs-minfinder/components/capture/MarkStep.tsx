import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  type CameraRef,
  type CircleLayerStyle,
  type FillLayerStyle,
  type LineLayerStyle,
} from "@maplibre/maplibre-react-native";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";

import { describeGps, MAX_NUDGE_M, type GpsState, type LiveFix } from "@/components/capture/gps";
import { Feather } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { distanceMeters } from "@/lib/geo";
import { BASEMAP_STYLE_JSON } from "@/lib/mapStyle";

export type LatLon = { lat: number; lon: number };

const BC_CENTER: [number, number] = [-125.5, 54.5];
const START_ZOOM = 18;

// A metre-true circle as a polygon. MapLibre's circle layer sizes in pixels, and
// both the accuracy disc and the 50 m leash have to mean metres at every zoom.
function circle(lat: number, lon: number, radiusM: number): GeoJSON.Feature {
  const ring: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

const fc = (features: GeoJSON.Feature[]) =>
  ({ type: "FeatureCollection", features }) as GeoJSON.FeatureCollection;

const BLUE = "#1F6FD1";
const accuracyFill = { fillColor: BLUE, fillOpacity: 0.14 } as unknown as FillLayerStyle;
const accuracyLine = { lineColor: BLUE, lineOpacity: 0.5, lineWidth: 1 } as unknown as LineLayerStyle;
const youDot = {
  circleColor: BLUE,
  circleRadius: 7,
  circleStrokeColor: "#ffffff",
  circleStrokeWidth: 3,
} as unknown as CircleLayerStyle;

/**
 * Step 1: put the pin on the working. The pin is fixed at the centre of the
 * screen and the map moves under it (the Gaia GPS / Every Door pattern), so
 * placing it takes a pan, not a precise drag, and works in gloves.
 */
export function MarkStep({
  fix,
  gps,
  startAt,
  onMark,
  onClose,
}: {
  fix: LiveFix | null;
  gps: GpsState;
  /** Where the pin was, when coming back from the details step to adjust it. */
  startAt: LatLon | null;
  onMark: (pin: LatLon, at: LiveFix) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef | null>(null);
  const reduceMotion = useReducedMotion();

  const [center, setCenter] = useState<LatLon | null>(startAt);
  const [panning, setPanning] = useState(false);

  // Fly in to the user the first time we know where they are.
  const centred = useRef(startAt !== null);
  useEffect(() => {
    if (!fix || centred.current) return;
    centred.current = true;
    cameraRef.current?.jumpTo({ center: [fix.lon, fix.lat], zoom: START_ZOOM });
    setCenter({ lat: fix.lat, lon: fix.lon });
  }, [fix]);

  const dist = fix && center ? distanceMeters(fix.lat, fix.lon, center.lat, center.lon) : null;
  const tooFar = dist !== null && dist > MAX_NUDGE_M;
  const locked = gps === "locked";
  const canMark = locked && !!fix && !!center && !tooFar;
  const offCentre = dist !== null && dist > 3;

  const ringColor = tooFar ? colors.destructive : colors.navy;
  const shapes = useMemo(
    () =>
      fix
        ? {
            accuracy: fc([circle(fix.lat, fix.lon, Math.min(fix.accuracy, 500))]),
            leash: fc([circle(fix.lat, fix.lon, MAX_NUDGE_M)]),
            you: fc([{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [fix.lon, fix.lat] } }]),
          }
        : null,
    [fix?.lat, fix?.lon, fix?.accuracy],
  );

  const pinLift = useAnimatedStyle(() => ({
    transform: [
      { translateY: reduceMotion ? 0 : withTiming(panning ? -10 : 0, { duration: 160 }) },
    ],
  }));

  const recentre = () => {
    if (!fix) return;
    Haptics.selectionAsync().catch(() => {});
    cameraRef.current?.easeTo({ center: [fix.lon, fix.lat], duration: reduceMotion ? 0 : 250 });
  };

  const mark = () => {
    if (!canMark || !fix || !center) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onMark(center, fix);
  };

  const pill = describeGps(gps, fix?.accuracy);
  // Fixed, not themed: white text on each of these clears 4.5:1 in either theme.
  const pillBg = pill.tone === "ok" ? "#1B6B3A" : pill.tone === "bad" ? "#B3261E" : colors.navyDeep;

  const guidance =
    gps === "denied"
      ? "Adding a mine needs your location, to prove you're at the site."
      : gps === "mocked"
        ? "Turn off the mock-location app to add a mine."
        : !locked
          ? "Waiting for a GPS lock of ±30 m or better. Stand in the open, away from cliffs and heavy tree cover."
          : tooFar
            ? `The pin is ${Math.round(dist!)} m from you. Keep it within ${MAX_NUDGE_M} m.`
            : offCentre
              ? `Pin is ${Math.round(dist!)} m from you.`
              : "Move the map to put the pin on the working. You can go up to 50 m from where you stand.";

  return (
    <View style={styles.root}>
      <MapLibreMap
        style={StyleSheet.absoluteFill}
        mapStyle={BASEMAP_STYLE_JSON}
        attribution={false}
        touchRotate={false}
        touchPitch={false}
        onRegionWillChange={(e) => {
          if (e.nativeEvent.userInteraction) setPanning(true);
        }}
        onRegionIsChanging={(e) => {
          const [lon, lat] = e.nativeEvent.center;
          setCenter({ lat, lon });
        }}
        onRegionDidChange={(e) => {
          const [lon, lat] = e.nativeEvent.center;
          setCenter({ lat, lon });
          setPanning(false);
        }}
      >
        <Camera
          ref={cameraRef}
          initialViewState={
            startAt
              ? { center: [startAt.lon, startAt.lat], zoom: START_ZOOM }
              : { center: BC_CENTER, zoom: 4 }
          }
        />
        {shapes && (
          <>
            <GeoJSONSource id="accuracy" data={shapes.accuracy}>
              <Layer id="accuracy-fill" type="fill" style={accuracyFill} />
              <Layer id="accuracy-line" type="line" style={accuracyLine} />
            </GeoJSONSource>
            <GeoJSONSource id="leash" data={shapes.leash}>
              <Layer
                id="leash"
                type="line"
                style={{ lineColor: ringColor, lineWidth: 2.5, lineDasharray: [2, 1.5] } as unknown as LineLayerStyle}
              />
            </GeoJSONSource>
            <GeoJSONSource id="you" data={shapes.you}>
              <Layer id="you" type="circle" style={youDot} />
            </GeoJSONSource>
          </>
        )}
      </MapLibreMap>

      {/* The pin. Its tip is the exact map centre; the dot beneath stays put
          while the pin lifts during a pan, so the target is never hidden. */}
      <View pointerEvents="none" style={styles.pinAnchor}>
        <View style={[styles.groundDot, { backgroundColor: tooFar ? colors.destructive : colors.navyDeep }]} />
        <Animated.View style={[styles.pin, pinLift]}>
          <Svg width={44} height={56} viewBox="0 0 44 56">
            <Path
              d="M22 54C22 54 4 33.5 4 21a18 18 0 0 1 36 0c0 12.5-18 33-18 33z"
              fill={tooFar ? colors.destructive : colors.gold}
              stroke={colors.navyDeep}
              strokeWidth={3}
            />
            <Circle cx={22} cy={21} r={6.5} fill={colors.navyDeep} />
          </Svg>
        </Animated.View>
      </View>

      {/* Top: GPS state and close */}
      <View style={[styles.topRow, { top: insets.top + 8 }]}>
        <View
          style={[styles.gpsPill, { backgroundColor: pillBg }]}
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`GPS: ${pill.label}`}
        >
          <Feather name={pill.icon} size={16} color="#FFFFFF" />
          <Text style={styles.gpsText} maxFontSizeMultiplier={1.4}>
            {pill.label}
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel adding a mine"
          hitSlop={6}
          style={({ pressed }) => [styles.roundBtn, { backgroundColor: colors.navyDeep, opacity: pressed ? 0.8 : 1 }]}
        >
          <Feather name="x" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Bottom: guidance and the one action */}
      <View style={[styles.panel, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
        {offCentre && locked && (
          <Pressable
            onPress={recentre}
            accessibilityRole="button"
            accessibilityLabel="Put the pin back on your position"
            style={({ pressed }) => [
              styles.recentre,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name="locate-fixed" size={22} color={colors.foreground} />
          </Pressable>
        )}
        <Text
          style={[styles.guidance, { color: tooFar ? colors.destructive : colors.foreground }]}
          accessibilityLiveRegion="polite"
        >
          {guidance}
        </Text>
        {gps === "denied" && (
          <Pressable onPress={() => void Linking.openSettings()} hitSlop={8} accessibilityRole="link">
            <Text style={[styles.link, { color: colors.primary }]}>Open Settings</Text>
          </Pressable>
        )}
        <Pressable
          onPress={mark}
          disabled={!canMark}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canMark }}
          style={({ pressed }) => [
            styles.markBtn,
            {
              backgroundColor: canMark ? colors.gold : colors.muted,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Feather name="map-pin" size={20} color={canMark ? colors.navyDeep : colors.mutedForeground} />
          <Text style={[styles.markText, { color: canMark ? colors.navyDeep : colors.mutedForeground }]}>
            Mark this spot
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pinAnchor: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 0,
    height: 0,
    alignItems: "center",
  },
  groundDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    top: -4,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  // The SVG's tip sits at (22, 54); lift it so that point lands on the centre.
  pin: { position: "absolute", top: -54, width: 44, height: 56 },
  topRow: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  gpsPill: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
  },
  gpsText: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 15, flexShrink: 1 },
  roundBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 12,
  },
  recentre: {
    position: "absolute",
    right: 16,
    top: -68,
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  guidance: { fontFamily: "Inter_500Medium", fontSize: 15, lineHeight: 21 },
  link: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  markBtn: {
    minHeight: 56,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  markText: { fontFamily: "Inter_700Bold", fontSize: 17 },
});
