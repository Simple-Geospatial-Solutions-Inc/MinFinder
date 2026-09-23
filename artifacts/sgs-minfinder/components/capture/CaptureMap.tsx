import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  Marker,
  RasterSource,
  type CameraRef,
  type CircleLayerStyle,
  type FillLayerStyle,
  type LineLayerStyle,
} from "@maplibre/maplibre-react-native";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";

import { describeGps, MAX_NUDGE_M, type GpsState, type LiveFix } from "@/components/capture/gps";
import { floating, GUTTER, MapButton, PillButton, Stat, type } from "@/components/capture/ui";
import { Feather } from "@/components/Icon";
import { SatelliteCredit } from "@/components/SatelliteCredit";
import { useColors } from "@/hooks/useColors";
import { formatShortDate } from "@/lib/format";
import { distanceMeters } from "@/lib/geo";
import { MINE_TYPES, type MineType, type MyMine } from "@/lib/sync";
import { BASEMAP_STYLE_JSON } from "@/lib/mapStyle";
import {
  DEFAULT_BASEMAP,
  loadBasemap,
  otherBasemap,
  SATELLITE_ANCHOR_LAYER,
  SATELLITE_ATTRIBUTION,
  SATELLITE_MAX_ZOOM,
  SATELLITE_TILE_SIZE,
  SATELLITE_TILES,
  saveBasemap,
  type Basemap,
} from "@/lib/satellite";

export type LatLon = { lat: number; lon: number };
export type Phase = "mark" | "details" | "saved";

const BC_CENTER: [number, number] = [-125.5, 54.5];
const START_ZOOM = 18;
/** Share of the screen the details sheet covers at its first stop. */
export const DETAILS_SNAP = 0.5;

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

// Mirrors LIMITS in artifacts/minfinder-api/src/rules.ts.
const OWN_RADIUS_M = 100;
const TYPE_LABEL = Object.fromEntries(MINE_TYPES) as Record<MineType, string>;
const myDot = {
  circleColor: "#FCBA19",
  circleRadius: 6,
  circleStrokeColor: "#0E2444",
  circleStrokeWidth: 2,
} as unknown as CircleLayerStyle;
const myZone = { fillColor: "#B3261E", fillOpacity: 0.08 } as unknown as FillLayerStyle;

/** The user's closest mine within the one-per-100 m rule, if any. */
export function ownMineNear(myMines: MyMine[], at: LatLon | null) {
  if (!at) return null;
  return (
    myMines
      .map((mine) => ({ mine, m: distanceMeters(at.lat, at.lon, mine.lat, mine.lon) }))
      .filter((x) => x.m <= OWN_RADIUS_M)
      .sort((a, b) => a.m - b.m)[0] ?? null
  );
}

const TONE = { ok: "#1B6B3A", bad: "#B3261E", wait: "#0E2444" } as const;

function PinGlyph({ fill }: { fill: string }) {
  return (
    <Svg width={40} height={52} viewBox="0 0 44 56">
      <Path
        d="M22 54C22 54 4 33.5 4 21a18 18 0 0 1 36 0c0 12.5-18 33-18 33z"
        fill={fill}
        stroke="#0E2444"
        strokeWidth={3}
      />
      <Circle cx={22} cy={21} r={6.5} fill="#0E2444" />
    </Svg>
  );
}

/**
 * The one map the whole capture happens on. While marking, the pin is fixed at
 * the centre and the map moves under it (the Gaia GPS / Every Door pattern). Once
 * marked, the pin drops onto the map and the camera lifts it clear of the sheet.
 */
export function CaptureMap({
  phase,
  fix,
  gps,
  pin,
  myMines,
  onCenter,
  onClose,
}: {
  phase: Phase;
  myMines: MyMine[];
  fix: LiveFix | null;
  gps: GpsState;
  /** The marked pin; null until the first Mark. */
  pin: LatLon | null;
  onCenter: (c: LatLon) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const cameraRef = useRef<CameraRef | null>(null);
  const reduceMotion = useReducedMotion();
  const [panning, setPanning] = useState(false);
  const [center, setCenter] = useState<LatLon | null>(null);
  // Same choice as the main map, so imagery stays on if that's how they browse.
  const [basemap, setBasemap] = useState<Basemap>(DEFAULT_BASEMAP);
  useEffect(() => {
    loadBasemap().then(setBasemap);
  }, []);
  const toggleBasemap = () => {
    Haptics.selectionAsync().catch(() => {});
    const next = otherBasemap(basemap);
    setBasemap(next);
    void saveBasemap(next);
  };
  const satellite = basemap === "satellite";

  const marking = phase === "mark";
  const report = (c: LatLon) => {
    if (!marking) return;
    setCenter(c);
    onCenter(c);
  };

  // Fly in to the user the first time we know where they are.
  const centred = useRef(false);
  useEffect(() => {
    if (!fix || centred.current) return;
    centred.current = true;
    cameraRef.current?.jumpTo({ center: [fix.lon, fix.lat], zoom: START_ZOOM });
    report({ lat: fix.lat, lon: fix.lon });
  }, [fix]);

  // Details: lift the pin into the strip of map above the sheet. Back to marking:
  // put it under the fixed centre pin again (or the user, after "Add another").
  useEffect(() => {
    const at = pin ?? fix;
    if (!at || !centred.current) return;
    cameraRef.current?.easeTo({
      center: [at.lon, at.lat],
      padding: { top: 0, left: 0, right: 0, bottom: marking ? 0 : height * DETAILS_SNAP },
      duration: reduceMotion ? 0 : 300,
    });
  }, [phase]);

  const dist = fix && center ? distanceMeters(fix.lat, fix.lon, center.lat, center.lon) : null;
  const tooFar = dist !== null && dist > MAX_NUDGE_M;
  const offCentre = dist !== null && dist > 3;

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

  // Your own mines, each with the 100 m where you can't add another.
  const mine = useMemo(
    () => ({
      zones: fc(myMines.map((m) => circle(m.lat, m.lon, OWN_RADIUS_M))),
      dots: fc(
        myMines.map((m) => ({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [m.lon, m.lat] },
        })),
      ),
    }),
    [myMines],
  );

  const pinLift = useAnimatedStyle(() => ({
    transform: [{ translateY: reduceMotion ? 0 : withTiming(panning ? -10 : 0, { duration: 160 }) }],
  }));

  const recentre = () => {
    if (!fix) return;
    Haptics.selectionAsync().catch(() => {});
    cameraRef.current?.easeTo({ center: [fix.lon, fix.lat], duration: reduceMotion ? 0 : 250 });
  };

  const pill = describeGps(gps, fix?.accuracy);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapLibreMap
        style={StyleSheet.absoluteFill}
        mapStyle={BASEMAP_STYLE_JSON}
        attribution={false}
        touchRotate={false}
        touchPitch={false}
        onRegionWillChange={(e) => {
          if (e.nativeEvent.userInteraction && marking) setPanning(true);
        }}
        onRegionIsChanging={(e) => {
          const [lon, lat] = e.nativeEvent.center;
          report({ lat, lon });
        }}
        onRegionDidChange={(e) => {
          const [lon, lat] = e.nativeEvent.center;
          report({ lat, lon });
          setPanning(false);
        }}
      >
        <Camera ref={cameraRef} initialViewState={{ center: BC_CENTER, zoom: 4 }} />
        {/* Mounted always and toggled by visibility, as on the main map: a
            remounted layer would land on top of the style. */}
        <RasterSource
          id="satellite"
          tiles={SATELLITE_TILES}
          tileSize={SATELLITE_TILE_SIZE}
          maxzoom={SATELLITE_MAX_ZOOM}
          attribution={SATELLITE_ATTRIBUTION}
        >
          <Layer
            id="satellite"
            type="raster"
            beforeId={SATELLITE_ANCHOR_LAYER}
            layout={{ visibility: satellite ? "visible" : "none" }}
          />
        </RasterSource>
        <GeoJSONSource id="my-zones" data={mine.zones}>
          <Layer id="my-zones" type="fill" style={myZone} />
        </GeoJSONSource>
        <GeoJSONSource id="my-mines" data={mine.dots}>
          <Layer id="my-mines" type="circle" style={myDot} />
        </GeoJSONSource>
        {shapes && (
          <>
            <GeoJSONSource id="accuracy" data={shapes.accuracy}>
              <Layer id="accuracy-fill" type="fill" style={accuracyFill} />
              <Layer id="accuracy-line" type="line" style={accuracyLine} />
            </GeoJSONSource>
            {marking && (
              <GeoJSONSource id="leash" data={shapes.leash}>
                <Layer
                  id="leash"
                  type="line"
                  style={
                    {
                      lineColor: tooFar ? colors.destructive : colors.navy,
                      lineWidth: 2,
                      lineDasharray: [2, 1.5],
                    } as unknown as LineLayerStyle
                  }
                />
              </GeoJSONSource>
            )}
            <GeoJSONSource id="you" data={shapes.you}>
              <Layer id="you" type="circle" style={youDot} />
            </GeoJSONSource>
          </>
        )}
        {!marking && pin && (
          <Marker lngLat={[pin.lon, pin.lat]} anchor="bottom">
            <View>
              <PinGlyph fill={colors.gold} />
            </View>
          </Marker>
        )}
      </MapLibreMap>

      {/* The pin. Its tip is the exact map centre; the dot beneath stays put
          while the pin lifts during a pan, so the target is never hidden. */}
      {marking && (
        <View pointerEvents="none" style={styles.pinAnchor}>
          <View style={[styles.groundDot, { backgroundColor: tooFar ? colors.destructive : colors.navyDeep }]} />
          <Animated.View style={[styles.pin, pinLift]}>
            <PinGlyph fill={tooFar ? colors.destructive : colors.gold} />
          </Animated.View>
        </View>
      )}

      <View style={[styles.topRow, { top: insets.top + 8 }]} pointerEvents="box-none">
        <MapButton icon="x" label="Cancel adding a mine" onPress={onClose} />
        {phase !== "saved" && (
          <View
            style={styles.gpsPill}
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            accessibilityLabel={`GPS: ${pill.label}`}
          >
            <Feather name={pill.icon} size={16} color={TONE[pill.tone]} />
            <Text style={styles.gpsText} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {pill.label}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <MapButton
          icon="satellite"
          label="Satellite imagery"
          active={satellite}
          onPress={toggleBasemap}
        />
      </View>
      {marking && offCentre && gps === "locked" && (
        <View style={[styles.rightCol, { top: insets.top + 56 }]}>
          <MapButton icon="locate-fixed" label="Put the pin back on your position" onPress={recentre} />
        </View>
      )}
      {/* Esri's credit has to show with its imagery; the sheet owns the bottom. */}
      {satellite && <SatelliteCredit top={insets.top + 56} />}
    </View>
  );
}

/** Step 1's sheet: key facts, one sentence, one button. */
export function MarkSheet({
  open,
  fix,
  gps,
  center,
  myMines,
  onMark,
}: {
  open: boolean;
  myMines: MyMine[];
  fix: LiveFix | null;
  gps: GpsState;
  center: LatLon | null;
  onMark: (pin: LatLon, at: LiveFix) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const ref = useRef<BottomSheet>(null);

  useEffect(() => {
    if (open) ref.current?.snapToIndex(0);
    else ref.current?.close();
  }, [open]);

  const dist = fix && center ? distanceMeters(fix.lat, fix.lon, center.lat, center.lon) : null;
  const tooFar = dist !== null && dist > MAX_NUDGE_M;
  const locked = gps === "locked";
  const own = ownMineNear(myMines, center);
  const canMark = locked && !!fix && !!center && !tooFar && !own;

  const title =
    own
      ? "You've already added a mine here"
      : gps === "denied"
      ? "Location is off"
      : gps === "mocked"
        ? "Mock location is on"
        : !locked
          ? "Stand near the mine"
          : tooFar
            ? "Pin is too far from you"
            : "Put the pin on the working";
  const guidance =
    own
      ? `Your ${own.mine.name || TYPE_LABEL[own.mine.type].toLowerCase()} from ${formatShortDate(own.mine.captured_at)} is ${Math.round(own.m)} m away. Each member can add one mine per 100 m.`
      : gps === "denied"
      ? "Adding a mine needs your location, to prove you're at the site."
      : gps === "mocked"
        ? "Turn off the mock-location app to add a mine."
        : !locked
          ? "Get under open sky, away from cliffs and heavy trees. Marking unlocks at ±30 m."
          : tooFar
            ? `Keep it within ${MAX_NUDGE_M} m of where you stand.`
            : "Move the map under the pin. It can go up to 50 m from you.";

  const mark = () => {
    if (!canMark || !fix || !center) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onMark(center, fix);
  };

  return (
    <BottomSheet
      ref={ref}
      index={0}
      enablePanDownToClose={false}
      backgroundStyle={{ backgroundColor: colors.card, borderRadius: 16 }}
      handleIndicatorStyle={[styles.handle, { backgroundColor: colors.border }]}
      style={floating}
    >
      <BottomSheetView style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={{ gap: 2 }}>
          <Text
            style={[type.title, { color: tooFar || own ? colors.destructive : colors.foreground }]}
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
          >
            {title}
          </Text>
          <Text style={[type.meta, { color: colors.mutedForeground }]}>{guidance}</Text>
        </View>
        {gps === "denied" && (
          <Pressable onPress={() => void Linking.openSettings()} hitSlop={12} accessibilityRole="link">
            <Text style={[type.link, { color: colors.primary }]}>Open Settings</Text>
          </Pressable>
        )}
        {fix && gps !== "denied" && (
          <View style={[styles.stats, { borderColor: colors.border }]}>
            <Stat value={`±${Math.round(fix.accuracy)}`} unit="m" label="GPS" />
            <Stat value={dist === null ? "–" : `${Math.round(dist)}`} unit="m" label="from you" />
            <Stat
              value={fix.altitude === null ? "–" : Math.round(fix.altitude).toLocaleString()}
              unit={fix.altitude === null ? undefined : "m"}
              label="elevation"
            />
          </View>
        )}
        <View style={styles.row}>
          <PillButton label="Mark this spot" icon="map-pin" onPress={mark} disabled={!canMark} />
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
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
  // The glyph's tip sits at its bottom centre; lift it so that point lands on the centre.
  pin: { position: "absolute", top: -50, width: 40, height: 52 },
  topRow: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rightCol: { position: "absolute", right: 16 },
  gpsPill: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    ...floating,
  },
  gpsText: { color: "#0E1A2B", fontFamily: "Inter_600SemiBold", fontSize: 14, flexShrink: 1 },
  handle: { width: 32, height: 5 },
  sheet: { paddingHorizontal: GUTTER, paddingTop: 4, gap: 16 },
  stats: {
    flexDirection: "row",
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: "row", gap: 8 },
});
