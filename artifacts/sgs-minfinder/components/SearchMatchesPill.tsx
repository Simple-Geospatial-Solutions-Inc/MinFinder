import { Feather } from "@/components/Icon";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { floating, radius } from "@/components/ui";
import colors from "@/constants/colors";

import { formatSpanKm, type Bounds } from "@/lib/mapGeo";

/** Gold halo drawn around a matched pin — see app/index.tsx. */
const MATCH_GOLD = "#FCBA19";

/**
 * Reports what pressing Enter on a search did to the map.
 *
 * Without this the gesture is easy to miss: a result set usually spans most of
 * BC, so the camera lands at province scale and "23 of 16,259 shown" in the
 * header does not change. It also gives a zero-match search something to say —
 * the results dropdown renders nothing when empty, so Enter would otherwise look
 * broken.
 *
 * Sibling of OfflineRegionPill and deliberately identical in shape: same slot,
 * same chrome, same clear affordance.
 */
export function SearchMatchesPill({
  term,
  count,
  bounds,
  onClear,
  topOffset,
}: {
  term: string;
  count: number;
  /** Extent of the matches. Null for a single match or none. */
  bounds: Bounds | null;
  onClear: () => void;
  topOffset: number;
}) {
  const none = count === 0;
  const title = none
    ? `No matches for “${term}”`
    : `${count.toLocaleString()} ${count === 1 ? "match" : "matches"} for “${term}”`;
  // Only meaningful once there are two pins to span between.
  const subtitle =
    bounds && count > 1 ? `spread over ${formatSpanKm(bounds)}` : null;

  const a11y = none
    ? `No occurrences match ${term}.`
    : `${count} ${count === 1 ? "occurrence matches" : "occurrences match"} ${term}, highlighted on the map${
        subtitle ? `, spread over ${formatSpanKm(bounds!)}` : ""
      }.`;

  return (
    <View style={[styles.pill, { top: topOffset }]} accessibilityLabel={a11y}>
      {/* Legend chip: a gold ring, mirroring the halo drawn on the matched pins,
          so the pill needs no wording to connect itself to the map. Hidden when
          there is nothing highlighted. */}
      {none ? <View style={styles.chipSpacer} /> : <View style={styles.legendChip} />}

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
        accessibilityLabel="Clear the search highlight"
        style={({ pressed }) => [styles.clearBtn, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={styles.clearText}>Clear</Text>
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
    borderRadius: 7,
    borderWidth: 2,
    borderColor: MATCH_GOLD,
    backgroundColor: "transparent",
  },
  // Keeps the title in the same place whether or not the chip is shown.
  chipSpacer: { width: 14, height: 14 },
  textCol: { flex: 1 },
  title: { color: MAP.mapChromeForeground, fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 20 },
  subtitle: { color: MAP.mapChromeMuted, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 8,
  },
  clearText: {
    color: MAP.mapChromeForeground,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
});
