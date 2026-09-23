import { Feather } from "@/components/Icon";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { floating, radius } from "@/components/ui";
import colors from "@/constants/colors";

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
        style={({ pressed }) => [styles.hideBtn, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={styles.hideText}>Hide</Text>
        <Feather name="x" size={16} color={MAP.mapChromeForeground} />
      </Pressable>
    </View>
  );
}

// Sits on the light basemap in both colour schemes.
const MAP = colors.light;

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingVertical: 8,
    paddingLeft: 16,
    paddingRight: 8,
    borderRadius: radius.lg,
    backgroundColor: MAP.mapChrome,
    ...floating,
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
  title: { color: MAP.mapChromeForeground, fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 20 },
  subtitle: { color: MAP.mapChromeMuted, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  hideBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 8,
  },
  hideText: {
    color: MAP.mapChromeForeground,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
});
