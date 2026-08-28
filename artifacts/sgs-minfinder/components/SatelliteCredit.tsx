import { Feather } from "@/components/Icon";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { SATELLITE_ATTRIBUTION } from "@/lib/satellite";

/**
 * Esri's on-map credit for the satellite layer.
 *
 * Esri's terms require the data-provider attribution to be visible on the map
 * whenever its imagery is, so this cannot be dropped — but they allow (and
 * Esri's own SDKs use) a condensed control that expands to the full text. This
 * is that: a small "Imagery: Esri" pill that toggles the full credit, which
 * also carries the online-only hint. The parent mounts it only while imagery
 * is showing, so the expanded state resets on every switch back to topo.
 */
export function SatelliteCredit({ bottom }: { bottom: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      accessibilityRole="button"
      accessibilityLabel="Imagery credits"
      accessibilityHint={
        expanded ? "Collapses the credit" : "Shows the full imagery credit"
      }
      accessibilityState={{ expanded }}
      hitSlop={8}
      style={[styles.chip, { bottom }]}
    >
      <Feather name="info" size={10} color="#F4F1EA" />
      <Text style={styles.text} numberOfLines={expanded ? 3 : 1}>
        {expanded ? `${SATELLITE_ATTRIBUTION} · online only` : "Imagery: Esri"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Bottom-left corner, clear of the FAB column on the right. Deliberately
  // quiet: a caption, not a control the eye is drawn to.
  chip: {
    position: "absolute",
    left: 12,
    maxWidth: "70%",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "rgba(14,36,68,0.6)",
  },
  text: {
    color: "#F4F1EA",
    fontSize: 9,
    lineHeight: 12,
    fontFamily: "Inter_400Regular",
    flexShrink: 1,
  },
});
