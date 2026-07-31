import { Feather } from "@/components/Icon";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatShortDate } from "@/lib/format";
import type { FocusRegion } from "@/lib/mapFocus";
import { boundsSpanKm, distanceToBoundsKm } from "@/lib/mapGeo";

/** Gold stroke of the focused region rectangle — see app/index.tsx. */
const REGION_GOLD = "#FCBA19";

/**
 * Identifies what the gold rectangle on the map is. MapLibre text layers need
 * glyphs from a remote font CDN (see lib/mapStyle.ts), so labelling an *offline*
 * region on the map itself would depend on the network — the identity has to
 * come from a plain RN view instead.
 *
 * Renders nothing unless a region is focused or the coverage overlay is on.
 */
export function OfflineRegionPill({
  region,
  coverageCount,
  userLoc,
  onClear,
  topOffset,
}: {
  region: FocusRegion | null;
  /** Number of outlined regions when the coverage overlay is on, else null. */
  coverageCount: number | null;
  userLoc: { latitude: number; longitude: number } | null;
  onClear: () => void;
  topOffset: number;
}) {
  if (!region && coverageCount == null) return null;

  let title: string;
  let subtitle: string | null = null;
  let a11y: string;

  if (region) {
    const { nsKm, ewKm } = boundsSpanKm(region.bounds);
    const size = `${Math.round(ewKm)} × ${Math.round(nsKm)} km`;
    const saved = formatShortDate(region.createdAt);

    title = region.name;
    subtitle = [
      size,
      saved ? `saved ${saved}` : null,
      region.incomplete ? "incomplete" : null,
    ]
      .filter(Boolean)
      .join(" · ");

    a11y = `${region.name} offline region shown on map. ${Math.round(ewKm)} by ${Math.round(nsKm)} kilometres.`;
    if (userLoc) {
      const near = distanceToBoundsKm(
        userLoc.latitude,
        userLoc.longitude,
        region.bounds,
      );
      a11y += near.inside
        ? ` You are inside this region, ${Math.round(near.km)} kilometres from the nearest edge.`
        : ` You are ${Math.round(near.km)} kilometres outside it, to the ${near.octant}.`;
    }
  } else {
    const n = coverageCount ?? 0;
    title = "Offline coverage";
    subtitle = `${n} ${n === 1 ? "region" : "regions"} downloaded`;
    a11y = `Offline coverage shown on map: ${n} downloaded ${n === 1 ? "region" : "regions"}.`;
  }

  return (
    <View style={[styles.pill, { top: topOffset }]} accessibilityLabel={a11y}>
      {/* Legend chip: deliberately mirrors the rectangle drawn on the map, so
          no wording is needed to connect the two. */}
      <View style={styles.legendChip} />

      <View style={styles.textCol}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel="Hide the offline region outline"
        hitSlop={12}
        style={({ pressed }) => [styles.hideBtn, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={styles.hideText}>Hide</Text>
        <Feather name="x" size={14} color="#F4F1EA" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    // Matches the permission banner on the map screen.
    backgroundColor: "rgba(14,36,68,0.92)",
    borderColor: "rgba(252,186,25,0.4)",
    borderWidth: 1,
  },
  legendChip: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: REGION_GOLD,
    backgroundColor: "rgba(252,186,25,0.12)",
  },
  textCol: { flex: 1 },
  title: {
    color: "#F4F1EA",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  subtitle: {
    color: "rgba(244,241,234,0.75)",
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    marginTop: 1,
  },
  hideBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  hideText: {
    color: "#F4F1EA",
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
});
