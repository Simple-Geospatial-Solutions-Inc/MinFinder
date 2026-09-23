import BottomSheet, { type BottomSheetProps } from "@gorhom/bottom-sheet";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Feather, type FeatherIconName } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";

// Sizes measured off AllTrails' own sheets (393 pt screen): 24 pt gutters,
// 48 pt pill buttons, 14 pt meta text, big numbers with small units.
export const GUTTER = 24;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const type = StyleSheet.create({
  display: { fontFamily: "Inter_700Bold", fontSize: 22, lineHeight: 28 },
  title: { fontFamily: "Inter_700Bold", fontSize: 18, lineHeight: 24 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  link: { fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 20 },
});

export const floating = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.16,
  shadowRadius: 4,
  elevation: 4,
} as const;

/**
 * A full pill. One primary (gold) per screen; secondary sits beside it in grey.
 * Outline is for third-party sign-in, where it has to match Apple's button.
 */
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
  variant?: "primary" | "secondary" | "outline";
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
}) {
  const colors = useColors();
  const primary = variant === "primary" && !disabled;
  const outline = variant === "outline";
  const bg = primary ? colors.gold : outline ? "transparent" : colors.muted;
  const fg = primary ? colors.navyDeep : disabled ? colors.mutedForeground : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: outline && pressed ? colors.muted : bg, opacity: pressed && !outline ? 0.85 : 1 },
        outline && { borderWidth: 1, borderColor: colors.foreground },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon && <Feather name={icon} size={18} color={fg} />}
      <Text style={[styles.pillText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** An inline text action, 44 pt tall so it can be hit with a glove. */
export function TextButton({
  label,
  onPress,
  icon,
  tone = "primary",
  accessibilityRole = "button",
}: {
  label: string;
  onPress: () => void;
  icon?: FeatherIconName;
  tone?: "primary" | "destructive";
  accessibilityRole?: "button" | "link";
}) {
  const colors = useColors();
  const fg = tone === "destructive" ? colors.destructive : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      hitSlop={{ left: 8, right: 8 }}
      style={({ pressed }) => [styles.textBtn, { opacity: pressed ? 0.6 : 1 }]}
    >
      {icon && <Feather name={icon} size={16} color={fg} />}
      <Text style={[type.link, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A selectable pill. Selected fills solid, AllTrails-style, so the choice reads
 * in glare without relying on a thin border. `icon` gets the current text colour.
 */
export function Chip({
  label,
  selected,
  onPress,
  icon,
  tone = "default",
  role,
  accessibilityHint,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: (color: string) => React.ReactNode;
  tone?: "default" | "danger";
  role: "radio" | "checkbox";
  accessibilityHint?: string;
}) {
  const colors = useColors();
  const onBg = tone === "danger" ? colors.destructive : colors.foreground;
  const onFg = tone === "danger" ? colors.destructiveForeground : colors.background;
  const fg = selected ? onFg : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={role === "radio" ? { selected } : { checked: selected }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.chip,
        selected
          ? { backgroundColor: onBg, borderColor: onBg }
          : { backgroundColor: pressed ? colors.muted : "transparent", borderColor: colors.border },
      ]}
    >
      {icon?.(fg)}
      <Text style={[styles.chipText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** An inline note: an icon and a sentence on a muted fill. */
export function Notice({
  icon,
  tone = "default",
  children,
}: {
  icon: FeatherIconName;
  tone?: "default" | "danger";
  children: React.ReactNode;
}) {
  const colors = useColors();
  const fg = tone === "danger" ? colors.destructive : colors.foreground;
  return (
    <View style={[styles.notice, { backgroundColor: colors.muted }]}>
      <Feather name={icon} size={16} color={fg} />
      <Text style={[type.meta, { flex: 1, color: fg }]}>{children}</Text>
    </View>
  );
}

/** A titled group of rows on a card, divided by hairlines. */
export function ListSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[type.title, { color: colors.foreground, flex: 1 }]} accessibilityRole="header">
          {title}
        </Text>
        {action && <TextButton label={action.label} onPress={action.onPress} />}
      </View>
      <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

export function ListRow({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return <View style={[styles.row, { borderBottomColor: colors.border }]}>{children}</View>;
}

/** The app's one bottom-sheet look: card fill, 16 pt corners, 32×5 handle. */
export function Sheet({ ref, ...props }: BottomSheetProps & { ref?: React.Ref<BottomSheet> }) {
  const colors = useColors();
  return (
    <BottomSheet
      ref={ref}
      backgroundStyle={{ backgroundColor: colors.card, borderRadius: radius.lg }}
      handleIndicatorStyle={[styles.handle, { backgroundColor: colors.border }]}
      style={floating}
      {...props}
    />
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
  active,
}: {
  icon: FeatherIconName;
  label: string;
  onPress: () => void;
  /** On state for toggles: filled in ink, like a selected chip. */
  active?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={active === undefined ? "button" : "switch"}
      accessibilityState={active === undefined ? undefined : { checked: active }}
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.disc,
        { backgroundColor: active ? colors.navyDeep : colors.mapChrome, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Feather name={icon} size={20} color={active ? colors.mapChrome : colors.mapChromeForeground} />
    </Pressable>
  );
}

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
  textBtn: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, minHeight: 44 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  notice: { flexDirection: "row", gap: 10, padding: 12, borderRadius: radius.md },
  section: { gap: 10 },
  sectionHead: { flexDirection: "row", alignItems: "center" },
  list: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    // Tucks the last row's divider under the list's own border (overflow: hidden).
    marginBottom: -StyleSheet.hairlineWidth,
  },
  handle: { width: 32, height: 5 },
  stat: { flex: 1, gap: 2 },
  statValue: { fontFamily: "Inter_600SemiBold", fontSize: 22, lineHeight: 28, fontVariant: ["tabular-nums"] },
  statUnit: { fontFamily: "Inter_500Medium", fontSize: 14 },
  disc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    ...floating,
  },
});
