import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  type BottomSheetProps,
} from "@gorhom/bottom-sheet";
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Feather, type FeatherIconName } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";

// Sizes measured off AllTrails' own sheets (393 pt screen): 24 pt gutters,
// 48 pt pill buttons, 14 pt meta text, big numbers with small units.
export const GUTTER = 24;
// xl is half a 48 pt pill: sheets share the curve of the buttons and search bar on them.
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const type = StyleSheet.create({
  display: { fontFamily: "Inter_700Bold", fontSize: 22, lineHeight: 28 },
  title: { fontFamily: "Inter_700Bold", fontSize: 18, lineHeight: 24 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  link: { fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 20 },
  // Fine print only: store disclosures, the legal line.
  fine: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 16 },
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
  grow = true,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  icon?: FeatherIconName;
  variant?: "primary" | "secondary" | "outline";
  /** Fill the row. Off for a lone button sized to its label, e.g. on the map. */
  grow?: boolean;
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
        grow && styles.grow,
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

/** A round icon-only action: a sheet's close, a field's clear. 44 pt to the touch. */
export function IconButton({
  icon,
  label,
  onPress,
  variant = "muted",
  color,
}: {
  icon: FeatherIconName;
  label: string;
  onPress: () => void;
  /** Muted sits on a grey disc; plain is the bare glyph, for inside a field. */
  variant?: "muted" | "plain";
  /** Glyph colour, for fields on map chrome that don't follow the colour scheme. */
  color?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconBtn,
        variant === "muted" && { backgroundColor: colors.muted },
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Feather name={icon} size={18} color={color ?? colors.foreground} />
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

/** Two or three exclusive options on a grey track; the chosen one lifts out on a card. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: V; label: string; disabled?: boolean }[];
  value: V;
  onChange: (value: V) => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.segTrack, { backgroundColor: colors.muted }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            disabled={o.disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !!o.disabled }}
            hitSlop={{ top: 4, bottom: 4 }}
            style={({ pressed }) => [
              styles.seg,
              on && [{ backgroundColor: colors.card }, floating],
              { opacity: o.disabled ? 0.45 : pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[type.link, { color: on ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A screen with nothing in it yet: a glyph on a grey tile, what's missing, and how to fill it. */
export function EmptyState({
  glyph,
  title,
  body,
  children,
}: {
  glyph: React.ReactNode;
  title: string;
  body?: string;
  /** Steps or actions below the text. */
  children?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyGlyph, { backgroundColor: colors.muted }]}>{glyph}</View>
      <Text style={[type.display, { color: colors.foreground }]} accessibilityRole="header">
        {title}
      </Text>
      {body && <Text style={[type.label, { color: colors.mutedForeground }]}>{body}</Text>}
      {children}
    </View>
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
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
            {title}
          </Text>
          {subtitle && <Text style={[type.meta, { color: colors.mutedForeground }]}>{subtitle}</Text>}
        </View>
        {action && <TextButton label={action.label} onPress={action.onPress} />}
      </View>
      <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

export function ListRow({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  /** Makes the whole row the target, with a chevron to say so. */
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  if (!onPress) return <View style={[styles.row, { borderBottomColor: colors.border }]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.row,
        styles.rowPressable,
        { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" },
      ]}
    >
      {children}
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

/**
 * The app's one bottom-sheet look: card fill, 24 pt corners, 32×5 handle.
 * `backdrop` dims the map behind and closes the sheet on a tap outside it.
 *
 * With `open`, the sheet mounts at index 0 when it turns true (a sheet told to
 * open before it has measured itself drops the request) and animates shut
 * before unmounting when it turns false. `onClose` then only reports closes
 * the user started: a swipe, a backdrop tap.
 */
export function Sheet({
  ref,
  open,
  backdrop,
  onClose,
  ...props
}: BottomSheetProps & { ref?: React.Ref<BottomSheet>; open?: boolean; backdrop?: boolean }) {
  const colors = useColors();
  const inner = useRef<BottomSheet>(null);
  const [mounted, setMounted] = useState(open !== false);
  if (open && !mounted) setMounted(true);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (open === false) inner.current?.close();
    // Reopened mid-close: take the sheet back up before onClose fires.
    else if (open) inner.current?.snapToIndex(0);
  }, [open]);
  useImperativeHandle(ref, () => inner.current!, [mounted]);

  const renderBackdrop = useCallback(
    (p: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.25} pressBehavior="close" />
    ),
    [],
  );
  if (!mounted) return null;
  return (
    <BottomSheet
      ref={inner}
      backgroundStyle={{ backgroundColor: colors.card, borderRadius: radius.xl }}
      handleIndicatorStyle={[styles.handle, { backgroundColor: colors.border }]}
      backdropComponent={backdrop ? renderBackdrop : undefined}
      style={floating}
      onClose={() => {
        if (open === undefined) return onClose?.();
        setMounted(false);
        if (openRef.current) onClose?.();
      }}
      {...props}
    />
  );
}

/** The last non-null value, so a sheet keeps its content while it animates shut. */
export function useLast<T>(value: T | null): T | null {
  const [last, setLast] = useState(value);
  if (value != null && value !== last) setLast(value);
  return value ?? last;
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
      <Text style={[type.meta, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

/** White disc floating on the map. */
export function MapButton({
  icon,
  label,
  onPress,
  active,
  accessibilityHint,
}: {
  icon: FeatherIconName;
  label: string;
  onPress: () => void;
  /** On state for toggles: filled in ink, like a selected chip. */
  active?: boolean;
  accessibilityHint?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={active === undefined ? "button" : "switch"}
      accessibilityState={active === undefined ? undefined : { checked: active }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
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
  grow: { flex: 1 },
  pill: {
    height: 48,
    borderRadius: radius.xl,
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
  empty: { gap: 14, paddingTop: 8 },
  emptyGlyph: { width: 64, height: 64, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  segTrack: { flexDirection: "row", padding: 4, borderRadius: radius.pill },
  seg: { flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
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
  rowPressable: { alignItems: "center", minHeight: 56 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
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
