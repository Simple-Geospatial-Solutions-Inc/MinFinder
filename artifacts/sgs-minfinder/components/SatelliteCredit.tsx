import { Feather } from "@/components/Icon";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { radius, type } from "@/components/ui";
import colors from "@/constants/colors";
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
export function SatelliteCredit({ bottom, top }: { bottom?: number; top?: number }) {
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
      style={[styles.chip, { bottom, top }]}
    >
      <Feather name="info" size={12} color={MAP.background} />
      <Text style={styles.text} numberOfLines={expanded ? 3 : 1}>
        {expanded ? `${SATELLITE_ATTRIBUTION} · online only` : "Imagery: Esri"}
      </Text>
    </Pressable>
  );
}

// A caption on the map in both colour schemes.
const MAP = colors.light;

const styles = StyleSheet.create({
  // Under the top chrome, where no sheet can cover it. Deliberately quiet: a
  // caption, not a control the eye is drawn to.
  chip: {
    position: "absolute",
    left: 12,
    maxWidth: "70%",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: MAP.navyScrim,
  },
  text: { ...type.fine, color: MAP.background, flexShrink: 1 },
});
