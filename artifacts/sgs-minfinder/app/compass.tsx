import { Feather } from "@/components/Icon";
import { router, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CalibrationModal } from "@/components/CalibrationModal";
import { CompassDial } from "@/components/CompassDial";
import { useColors } from "@/hooks/useColors";
import {
  applyOffset,
  clearOffset,
  loadOffset,
  offsetForReference,
  saveOffset,
} from "@/lib/calibration";
import { getOccurrenceById, type Occurrence } from "@/lib/db";
import {
  bearingDegrees,
  distanceMeters,
  formatBearing,
  formatDistance,
  formatDMS,
} from "@/lib/geo";

export default function CompassScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [target, setTarget] = useState<Occurrence | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [coords, setCoords] = useState<Location.LocationObjectCoords | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const [headingSource, setHeadingSource] = useState<"true" | "magnetic" | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Calibration offset (degrees). Loaded once on mount, persisted on change.
  const [offset, setOffset] = useState<number>(0);
  // Local magnetic declination derived from the latest sensor reading
  // (trueHeading - magneticHeading). null until we get a reading with both.
  const [declination, setDeclination] = useState<number | null>(null);
  const [showCalibration, setShowCalibration] = useState(false);
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
  }, [id]);

  useEffect(() => {
    let cancelled = false;
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

    return () => {
      // Flip the closure flag first so any in-flight async callbacks bail
      // out before calling setState on an unmounted component.
      cancelled = true;
      subPos.current?.remove();
      subHeading.current?.remove();
    };
  }, []);

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

  if (loadError) {
    return (
      <View
        style={[
          styles.errorWrap,
          { backgroundColor: colors.navyDeep },
        ]}
      >
        <Feather name="alert-circle" size={28} color={colors.gold} />
        <Text style={styles.errorText}>{loadError}</Text>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.errorBtn,
            { borderColor: colors.gold, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.errorBtnText, { color: colors.gold }]}>
            Back to map
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!target) {
    return (
      <View
        style={[
          styles.loadingWrap,
          { backgroundColor: colors.navyDeep },
        ]}
      >
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.navyDeep, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <View style={styles.dialWrap}>
        <CompassDial size={300} heading={displayedHeading} bearing={bearing} />
        <Pressable
          onPress={() => setShowCalibration(true)}
          accessibilityLabel={
            calibrated ? "Compass calibrated. Tap to recalibrate." : "Calibrate compass"
          }
          hitSlop={12}
          style={({ pressed }) => [
            styles.cogBtn,
            {
              backgroundColor: calibrated
                ? "rgba(252,186,25,0.18)"
                : "rgba(20,30,48,0.85)",
              borderColor: calibrated ? "#FCBA19" : "rgba(244,241,234,0.22)",
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <Feather
            name="settings"
            size={18}
            color={calibrated ? "#FCBA19" : "#F4F1EA"}
          />
          {calibrated && <View style={styles.cogDot} />}
        </Pressable>
      </View>

      <Text style={styles.targetMinfilno}>
        {target.MINFILNO?.trim()}
      </Text>

      <Text style={styles.targetName} numberOfLines={1}>
        {target.NAME1 || "Unnamed"}
      </Text>

      <View style={styles.metricsBig}>
        <Metric label="Distance" value={distance != null ? formatDistance(distance) : "—"} />
        <View style={styles.metricsDivider} />
        <Metric label="Bearing" value={formatBearing(bearing)} />
      </View>

      <View style={styles.detailsBlock}>
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
          label="Latitude"
          value={
            target.LATITUDE != null ? formatDMS(target.LATITUDE, true) : "—"
          }
        />
        <DetailRow
          label="Longitude"
          value={
            target.LONGITUDE != null ? formatDMS(target.LONGITUDE, false) : "—"
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
      </View>

      <CalibrationModal
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

      <View style={styles.hintBox}>
        <Feather name="info" size={14} color="rgba(244,241,234,0.65)" />
        <Text style={styles.hintText}>
          If the needle seems off, hold the phone flat and trace a figure-8 in
          the air a few times to recalibrate the compass. Keep away from metal
          objects and vehicles for best accuracy.
        </Text>
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricBig}>
      <Text style={styles.metricLabelBig}>{label}</Text>
      <Text style={styles.metricValueBig}>{value}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}:</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    alignItems: "center",
  },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 24,
  },
  errorText: {
    color: "#F4F1EA",
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  errorBtn: {
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  errorBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  dialWrap: { marginTop: 8, alignItems: "center", position: "relative" },
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
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  // Small gold "calibrated" indicator dot in the cog's corner.
  cogDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#FCBA19",
  },
  targetMinfilno: {
    marginTop: 16,
    color: "#F4F1EA",
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    letterSpacing: 0.6,
    textAlign: "center",
  },
  targetName: {
    color: "#FCBA19",
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    marginTop: 4,
  },
  metricsBig: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    gap: 16,
  },
  metricBig: { alignItems: "center", minWidth: 110 },
  metricLabelBig: {
    color: "rgba(244,241,234,0.7)",
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    letterSpacing: 0.4,
  },
  metricValueBig: {
    color: "#F4F1EA",
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  metricsDivider: {
    width: 1,
    height: 36,
    backgroundColor: "rgba(244,241,234,0.18)",
  },
  detailsBlock: {
    marginTop: 18,
    alignItems: "center",
    gap: 4,
  },
  detailRow: { flexDirection: "row", gap: 6 },
  detailLabel: {
    color: "rgba(244,241,234,0.7)",
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  detailValue: {
    color: "#F4F1EA",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  hintBox: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 4,
  },
  hintText: {
    flex: 1,
    color: "rgba(244,241,234,0.65)",
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
  },
});
