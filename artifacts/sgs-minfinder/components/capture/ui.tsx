import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Feather, type FeatherIconName } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";

// Sizes measured off AllTrails' own sheets (393 pt screen): 24 pt gutters,
// 48 pt pill buttons, 14 pt meta text, big numbers with small units.
export const GUTTER = 24;

export const type = StyleSheet.create({
  title: { fontFamily: "Inter_700Bold", fontSize: 18, lineHeight: 24 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  link: { fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 20 },
});

/** A full pill. One primary (gold) per screen; secondary sits beside it in grey. */
export function PillButton({
  label,
  onPress,
  icon,
  variant = "primary",
  disabled,
  busy,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  icon?: FeatherIconName;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
}) {
  const colors = useColors();
  const primary = variant === "primary" && !disabled;
  const bg = primary ? colors.gold : colors.muted;
  const fg = primary ? colors.navyDeep : disabled ? colors.mutedForeground : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.pill, { backgroundColor: bg, opacity: pressed ? 0.85 : 1 }]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon && <Feather name={icon} size={18} color={fg} />}
      <Text style={[styles.pillText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** "24 m" over "from you": the number carries the weight, the unit steps back. */
export function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  const colors = useColors();
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ""}`}>
      <Text style={[styles.statValue, { color: colors.foreground }]}>
        {value}
        {unit && <Text style={styles.statUnit}> {unit}</Text>}
      </Text>
      <Text style={[type.meta, { color: colors.mutedForeground, fontSize: 13 }]}>{label}</Text>
    </View>
  );
}

/** White disc floating on the map. */
export function MapButton({
  icon,
  label,
  onPress,
}: {
  icon: FeatherIconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [styles.disc, { opacity: pressed ? 0.85 : 1 }]}
    >
      <Feather name={icon} size={20} color="#0E1A2B" />
    </Pressable>
  );
}

export const floating = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.16,
  shadowRadius: 4,
  elevation: 4,
} as const;

const styles = StyleSheet.create({
  pill: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  pillText: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  stat: { flex: 1, gap: 2 },
  statValue: { fontFamily: "Inter_600SemiBold", fontSize: 22, lineHeight: 28, fontVariant: ["tabular-nums"] },
  statUnit: { fontFamily: "Inter_500Medium", fontSize: 14 },
  disc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...floating,
  },
});
