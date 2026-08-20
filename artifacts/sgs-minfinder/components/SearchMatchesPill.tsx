import { Feather } from "@/components/Icon";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
        hitSlop={12}
        style={({ pressed }) => [styles.clearBtn, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={styles.clearText}>Clear</Text>
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
    // Matches OfflineRegionPill and the permission banner on the map screen.
    backgroundColor: "rgba(14,36,68,0.92)",
    borderColor: "rgba(252,186,25,0.4)",
    borderWidth: 1,
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
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  clearText: {
    color: "#F4F1EA",
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
});
