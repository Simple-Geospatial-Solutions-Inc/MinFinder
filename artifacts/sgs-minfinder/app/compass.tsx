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

import { CompassDial } from "@/components/CompassDial";
import { useColors } from "@/hooks/useColors";
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
          const useTrue = h.trueHeading >= 0;
          const raw = useTrue ? h.trueHeading : h.magHeading;
          if (raw == null || Number.isNaN(raw)) return;
          setHeadingSource((prev) => {
            const next = useTrue ? "true" : "magnetic";
            return prev === next ? prev : next;
          });
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
    return () => {
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
        <CompassDial size={300} heading={heading} bearing={bearing} />
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
          value={`${Math.round(heading)}° ${
            headingSource === "true"
              ? "True"
              : headingSource === "magnetic"
                ? "Magnetic"
                : ""
          }`.trim()}
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
  dialWrap: { marginTop: 8 },
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
