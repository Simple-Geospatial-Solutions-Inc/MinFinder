import { Feather } from "@/components/Icon";
import { router, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CalibrationSheet } from "@/components/CalibrationSheet";
import { CompassDial } from "@/components/CompassDial";
import { PaywallSheet } from "@/components/PaywallSheet";
import { floating, PillButton, radius, type } from "@/components/ui";
import colorTokens from "@/constants/colors";
import { useEntitlement } from "@/hooks/useEntitlement";
import {
  applyOffset,
  clearOffset,
  loadOffset,
  offsetForReference,
  saveOffset,
} from "@/lib/calibration";
import { getOccurrenceById, type Occurrence } from "@/lib/db";
import {
  coordFormatLabel,
  formatCoord,
  loadCoordFormat,
  otherFormat,
  saveCoordFormat,
  type CoordFormat,
} from "@/lib/coordFormat";
import {
  bearingDegrees,
  distanceMeters,
  formatBearing,
  formatDistance,
} from "@/lib/geo";

// The dial is the one element on this screen that can give ground. Everything
// below it is text meant to be read at arm's length in the field, so shrinking
// that is the wrong trade. Instead the readout lays out at its natural height,
// the dial takes whatever is left, and a screen too short for even the floor
// scrolls rather than running off the bottom — which is what a 300px dial plus
// a 380px readout did on a 640dp-tall Android phone.
const DIAL_MAX = 300;
const DIAL_MIN = 160;
// CompassDial draws 18px of padding and a 4px border on every side, so its box
// is this much larger than the `size` it is handed.
const DIAL_CHROME = 44;

export default function CompassScreen() {
  // A MINFILE occurrence by id, or a community mine by its coordinates.
  const { id, lat, lon, name } = useLocalSearchParams<{ id?: string; lat?: string; lon?: string; name?: string }>();
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  // Once the status bar and the "Navigate" header come out of a 640-720dp
  // screen there is no room for the spacing this was drawn with. Tighten the
  // rhythm rather than let it overflow.
  const compact = winHeight < 720;
  const sp = (n: number) => (compact ? Math.round(n * 0.65) : n);
  // The compass is the premium feature itself. Gating here — not only at the
  // buttons that navigate here — means a future call site that forgets to
  // check can't hand it out for free.
  const { isPaid, isReady } = useEntitlement();
  const [showPaywall, setShowPaywall] = useState(false);

  const [target, setTarget] = useState<Occurrence | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [coords, setCoords] = useState<Location.LocationObjectCoords | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const [headingSource, setHeadingSource] = useState<"true" | "magnetic" | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // DMS vs decimal degrees for the position readout. Loaded once on mount,
  // persisted on change.
  const [coordFormat, setCoordFormat] = useState<CoordFormat>("dms");

  // Calibration offset (degrees). Loaded once on mount, persisted on change.
  const [offset, setOffset] = useState<number>(0);
  // Local magnetic declination derived from the latest sensor reading
  // (trueHeading - magneticHeading). null until we get a reading with both.
  const [declination, setDeclination] = useState<number | null>(null);
  const [showCalibration, setShowCalibration] = useState(false);
  // Measured, not estimated: the dial's share of the screen depends on how tall
  // the readout below it turned out, which depends on the user's font scale and
  // on how many lines the hint wraps to.
  const [dialBox, setDialBox] = useState<{ w: number; h: number } | null>(null);
  // True once we have at least one valid sensor reading. Used to disable
  // the Set button so users can't store a calibration offset against the
  // default 0° before the magnetometer has actually reported anything.
  const [headingReady, setHeadingReady] = useState(false);

  // Refs the modal reads at the moment "Set" is pressed.
  const rawHeadingRef = useRef<number>(0);
  const declinationRef = useRef<number | null>(null);

  const subPos = useRef<Location.LocationSubscription | null>(null);
  const subHeading = useRef<Location.LocationSubscription | null>(null);
  // Circular exponential moving average state for heading smoothing.
  // Storing sin/cos separately avoids the 359°→1° wrap-around jump.
  const smoothRef = useRef<{ sin: number; cos: number; init: boolean }>({
    sin: 0,
    cos: 1,
    init: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (lat && lon) {
        setTarget({ LATITUDE: Number(lat), LONGITUDE: Number(lon), NAME1: name ?? null, MINFILNO: "Community mine" } as Occurrence);
        return;
      }
      if (!id) {
        setLoadError("No target selected.");
        return;
      }
      try {
        const row = await getOccurrenceById(Number(id));
        if (!cancelled) {
          if (!row) setLoadError("Target not found.");
          else setTarget(row);
        }
      } catch (err) {
        console.warn(err);
        if (!cancelled) setLoadError("Failed to load target.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, lat, lon, name]);

  useEffect(() => {
    let cancelled = false;
    // Don't ask for location until we know the user is entitled — a free user
    // bounced to the paywall should never see a fine-location prompt first.
    if (!isReady || !isPaid) return;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        if (!cancelled) setPermissionDenied(true);
        return;
      }
      subPos.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 1,
          timeInterval: 1000,
        },
        (loc) => {
          if (!cancelled) setCoords(loc.coords);
        },
      );
      try {
        subHeading.current = await Location.watchHeadingAsync((h) => {
          if (cancelled) return;
          // expo-location uses -1 (and sometimes other negatives) as the
          // "unknown" sentinel for both `trueHeading` and `magHeading`.
          // Treat anything outside [0, 360) as invalid for both fields.
          const trueValid =
            typeof h.trueHeading === "number" &&
            h.trueHeading >= 0 &&
            h.trueHeading < 360;
          const magValid =
            typeof h.magHeading === "number" &&
            h.magHeading >= 0 &&
            h.magHeading < 360;
          const useTrue = trueValid;
          const raw = useTrue ? h.trueHeading : magValid ? h.magHeading : null;
          if (raw == null || Number.isNaN(raw)) return;

          // Derive local magnetic declination only when BOTH readings are
          // valid. The result is in (-180, 180] east-positive degrees.
          if (trueValid && magValid) {
            let d = h.trueHeading - h.magHeading;
            if (d > 180) d -= 360;
            if (d <= -180) d += 360;
            declinationRef.current = d;
            setDeclination((prev) => (prev === d ? prev : d));
          }

          setHeadingSource((prev) => {
            const next = useTrue ? "true" : "magnetic";
            return prev === next ? prev : next;
          });
          rawHeadingRef.current = raw;
          if (!headingReady) setHeadingReady(true);
          // Circular EMA: smooth sin/cos components so we never jump across 0°/360°.
          const rad = (raw * Math.PI) / 180;
          const s = Math.sin(rad);
          const c = Math.cos(rad);
          const alpha = 0.18; // 0 = no update, 1 = no smoothing. Lower = calmer needle.
          const st = smoothRef.current;
          if (!st.init) {
            st.sin = s;
            st.cos = c;
            st.init = true;
          } else {
            st.sin = st.sin * (1 - alpha) + s * alpha;
            st.cos = st.cos * (1 - alpha) + c * alpha;
          }
          let smoothed = (Math.atan2(st.sin, st.cos) * 180) / Math.PI;
          if (smoothed < 0) smoothed += 360;
          setHeading((prev) => {
            // Suppress sub-degree jitter — only re-render on a meaningful change.
            const diff = Math.abs(((smoothed - prev + 540) % 360) - 180);
            return diff < 0.5 ? prev : smoothed;
          });
        });
      } catch (err) {
        console.warn("heading error", err);
      }
    })();

    // Load persisted calibration offset.
    loadOffset().then((o) => {
      if (!cancelled) setOffset(o);
    });

    // Load persisted coordinate format (DMS vs decimal degrees).
    loadCoordFormat().then((f) => {
      if (!cancelled) setCoordFormat(f);
    });

    return () => {
      // Flip the closure flag first so any in-flight async callbacks bail
      // out before calling setState on an unmounted component.
      cancelled = true;
      subPos.current?.remove();
      subHeading.current?.remove();
    };
  }, [isReady, isPaid]);

  const hasTargetCoords =
    target?.LATITUDE != null && target?.LONGITUDE != null;

  const distance =
    coords && hasTargetCoords
      ? distanceMeters(
          coords.latitude,
          coords.longitude,
          target!.LATITUDE!,
          target!.LONGITUDE!,
        )
      : null;

  const bearing =
    coords && hasTargetCoords
      ? bearingDegrees(
          coords.latitude,
          coords.longitude,
          target!.LATITUDE!,
          target!.LONGITUDE!,
        )
      : 0;

  const accuracy = coords?.accuracy ?? null;
  // The displayed heading is the smoothed sensor heading plus the user's
  // calibration offset (modulo 360). When offset === 0 this is a no-op.
  const displayedHeading = applyOffset(heading, offset);
  const calibrated = offset !== 0;

  // Wait for RevenueCat before deciding — otherwise a paying user sees the
  // paywall flash on every cold start while CustomerInfo is still in flight.
  if (!isReady) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={DIAL.gold} />
      </View>
    );
  }

  if (!isPaid) {
    return (
      <View style={styles.errorWrap}>
        <Feather name="lock" size={28} color={DIAL.gold} />
        <Text style={[type.label, styles.errorText]}>
          Compass navigation is a MinFinder Pro feature.
        </Text>
        <View style={styles.errorActions}>
          <PillButton label="Unlock MinFinder Pro" onPress={() => setShowPaywall(true)} />
        </View>
        <BackToMap />
        <PaywallSheet
          visible={showPaywall}
          feature="Navigate"
          onClose={() => setShowPaywall(false)}
        />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.errorWrap}>
        <Feather name="alert-circle" size={28} color={DIAL.gold} />
        <Text style={[type.label, styles.errorText]}>{loadError}</Text>
        <BackToMap />
      </View>
    );
  }

  if (!target) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={DIAL.gold} />
      </View>
    );
  }

  // Fits both axes: a 300px dial is 344px wide with its chrome, which already
  // overflowed a 360dp screen sideways before it ran off the bottom. The window
  // width gives the first paint a sane size; the measured box then refines it
  // against the height actually left over.
  const dialCeiling = Math.min(DIAL_MAX, winWidth - 40 - DIAL_CHROME);
  const dialSize = Math.max(
    DIAL_MIN,
    dialBox
      ? Math.min(dialCeiling, Math.min(dialBox.w, dialBox.h) - DIAL_CHROME)
      : dialCeiling,
  );

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: sp(12), paddingBottom: insets.bottom + sp(16) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[styles.dialFlex, { minHeight: DIAL_MIN + DIAL_CHROME }]}
          onLayout={(e) => {
            const { width: w, height: h } = e.nativeEvent.layout;
            // Ignore sub-pixel churn, so a measurement can never feed a re-render
            // loop back into itself.
            setDialBox((prev) =>
              prev && Math.abs(prev.w - w) < 1 && Math.abs(prev.h - h) < 1
                ? prev
                : { w, h },
            );
          }}
        >
          <View style={styles.dialWrap}>
            <CompassDial size={dialSize} heading={displayedHeading} bearing={bearing} />
            <Pressable
              onPress={() => setShowCalibration(true)}
              accessibilityLabel={
                calibrated ? "Compass calibrated. Tap to recalibrate." : "Calibrate compass"
              }
              hitSlop={12}
              style={({ pressed }) => [
                styles.cogBtn,
                {
                  backgroundColor: calibrated ? DIAL.warningSubtle : DIAL.card,
                  borderColor: calibrated ? DIAL.gold : DIAL.border,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Feather
                name="settings"
                size={18}
                color={calibrated ? DIAL.gold : DIAL.foreground}
              />
              {calibrated && <View style={styles.cogDot} />}
            </Pressable>
          </View>
        </View>

        <Text style={[type.display, styles.targetMinfilno, { marginTop: sp(16) }]}>
          {target.MINFILNO?.trim()}
        </Text>

        <Text style={[type.title, styles.targetName]} numberOfLines={1}>
          {target.NAME1 || "Unnamed"}
        </Text>

        <View style={[styles.metricsBig, { marginTop: sp(14) }]}>
          <Metric label="Distance" value={distance != null ? formatDistance(distance) : "—"} />
          <View style={styles.metricsDivider} />
          <Metric label="Bearing" value={formatBearing(bearing)} />
        </View>

        <View style={[styles.detailsBlock, { marginTop: sp(18) }]}>
          <DetailRow
            label="Compass Direction"
            value={`${Math.round(displayedHeading)}° ${
              headingSource === "true"
                ? "True"
                : headingSource === "magnetic"
                  ? "Magnetic"
                  : ""
            }${calibrated ? " · calibrated" : ""}`.trim()}
          />
          <DetailRow
            label="Your Latitude"
            value={
              coords
                ? formatCoord(coords.latitude, true, coordFormat)
                : "Locating…"
            }
          />
          <DetailRow
            label="Your Longitude"
            value={
              coords
                ? formatCoord(coords.longitude, false, coordFormat)
                : "Locating…"
            }
          />
          <DetailRow
            label="Accuracy"
            value={
              permissionDenied
                ? "Permission denied"
                : accuracy != null
                  ? `${Math.round(accuracy)}m`
                  : "Locating…"
            }
          />
          <Pressable
            onPress={() => {
              const next = otherFormat(coordFormat);
              setCoordFormat(next);
              saveCoordFormat(next);
            }}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`Switch coordinates to ${coordFormatLabel(
              otherFormat(coordFormat),
            )}`}
            style={({ pressed }) => [
              styles.formatToggle,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Feather name="arrow-left-right" size={14} color={DIAL.foreground} />
            <Text style={[type.link, { color: DIAL.foreground }]}>
              {coordFormatLabel(otherFormat(coordFormat))}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.hintBox, { marginTop: sp(20) }]}>
          <Feather name="info" size={16} color={DIAL.mutedForeground} />
          <Text style={[type.meta, styles.hintText]}>
            If the needle seems off, hold the phone flat and trace a figure-8 in
            the air a few times to recalibrate the compass. Keep away from metal
            objects and vehicles for best accuracy.
          </Text>
        </View>
      </ScrollView>

      <CalibrationSheet
        visible={showCalibration}
        rawHeading={rawHeadingRef.current}
        declination={declinationRef.current ?? declination}
        currentOffset={offset}
        headingReady={headingReady}
        onSet={(ref) => {
          if (!headingReady) return;
          const newOffset = offsetForReference(rawHeadingRef.current, ref);
          setOffset(newOffset);
          saveOffset(newOffset);
          setShowCalibration(false);
        }}
        onClear={() => {
          setOffset(0);
          clearOffset();
          setShowCalibration(false);
        }}
        onClose={() => setShowCalibration(false)}
      />
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricBig}>
      <Text style={[type.meta, { color: DIAL.mutedForeground }]}>{label}</Text>
      <Text style={styles.metricValueBig}>{value}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={[type.meta, { color: DIAL.mutedForeground }]}>{label}:</Text>
      <Text style={[type.link, styles.num, { color: DIAL.foreground }]}>{value}</Text>
    </View>
  );
}

// TextButton won't do here: it takes the scheme's primary, navy on this navy
// screen in light mode, and hugs the left edge where these sit centred.
function BackToMap() {
  return (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      hitSlop={{ left: 8, right: 8 }}
      style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[type.link, { color: DIAL.foreground }]}>Back to map</Text>
    </Pressable>
  );
}

// The compass is an instrument screen: dark in both colour schemes, the way
// the map chrome is light in both.
const DIAL = colorTokens.dark;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DIAL.background },
  // flexGrow rather than flex: the content fills the screen when it fits and
  // grows past it — scrolling — when it doesn't.
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  // Absorbs whatever height the readout below didn't need, and hands it to the
  // dial. minHeight keeps it from collapsing to nothing on a very short screen.
  dialFlex: {
    flex: 1,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: DIAL.background },
  errorWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 24,
    backgroundColor: DIAL.background,
  },
  errorText: { color: DIAL.foreground, textAlign: "center" },
  errorActions: { flexDirection: "row", alignSelf: "stretch" },
  backBtn: { minHeight: 44, justifyContent: "center" },
  // Hugs the dial so the absolutely-positioned cog still lands on its corner
  // rather than the screen's.
  dialWrap: { alignItems: "center", position: "relative" },
  // Floating cog overlay in the top-right of the dial body.
  cogBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    ...floating,
  },
  // Small gold "calibrated" indicator dot in the cog's corner.
  cogDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: DIAL.gold,
  },
  targetMinfilno: { color: DIAL.foreground, textAlign: "center", fontVariant: ["tabular-nums"] },
  targetName: { color: DIAL.gold, marginTop: 4 },
  metricsBig: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  metricBig: { alignItems: "center", minWidth: 110 },
  // The one size off the type scale: the readout the whole screen exists for.
  metricValueBig: {
    color: DIAL.foreground,
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    lineHeight: 34,
    fontVariant: ["tabular-nums"],
  },
  metricsDivider: {
    width: 1,
    height: 36,
    backgroundColor: DIAL.border,
  },
  detailsBlock: {
    alignItems: "center",
    gap: 8,
  },
  // 36 tall plus a 4 pt slop: 44 to the touch.
  formatToggle: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: DIAL.border,
  },
  detailRow: { flexDirection: "row", gap: 6 },
  num: { fontVariant: ["tabular-nums"] },
  hintBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 4,
  },
  hintText: { flex: 1, color: DIAL.mutedForeground },
});
