import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { Feather, type FeatherIconName } from "@/components/Icon";

// Geometry inside the search pill, which is 48 tall with 16 / 4 side padding.
const HEIGHT = 48;
const BUTTON = 36;
// Where the divider settles once open: just past the search glyph.
const DIVIDER_OPEN = 16 + 18 + 10;
const ROW_LEFT = DIVIDER_OPEN + 4;
// The hamburger's lines, drawn to match the 18 pt glyph they replace.
const BAR_W = 14;
const BAR_GAP = 4.5;
// Stretch of progress over which the lines travel, and how long each takes to
// turn into its icon once it breaks off. The last label settles at 0.7 + BREAK + 0.1, inside 1.
const TRAVEL_START = 0;
const TRAVEL_END = 0.7;
const BREAK = 0.17;

const clamp = (p: number, from: number, to: number) => {
  "worklet";
  return interpolate(p, [from, to], [0, 1], Extrapolation.CLAMP);
};

/**
 * The search pill's menu. Opening, the divider slides left over the field and
 * the menu grows in behind it from the right, while the hamburger's three lines
 * slide left together and break off one by one, each turning into the icon of
 * the option it stops at. `progress` runs 0 to
 * 1; the parent owns it so the field can fade on the same clock.
 */
export function PillMenu<H extends string>({
  width,
  progress,
  open,
  items,
  color,
  dividerColor,
  onOpen,
  onPick,
}: {
  /** The pill's inner width; nothing draws until it is known. */
  width: number;
  progress: SharedValue<number>;
  open: boolean;
  items: readonly (readonly [FeatherIconName, string, H])[];
  color: string;
  dividerColor: string;
  onOpen: () => void;
  onPick: (href: H) => void;
}) {
  // Each option's icon centre in pill coordinates, measured once laid out.
  const [targets, setTargets] = useState<number[]>([]);
  const report = useCallback((i: number, x: number) => {
    setTargets((t) => (t[i] === x ? t : Object.assign([...t], { [i]: x })));
  }, []);

  const dividerRest = width - 4 - BUTTON - 4 - StyleSheet.hairlineWidth;
  const home = width - 4 - BUTTON / 2;
  // The lines travel as one until the leftmost option; each drops off on the
  // way, at the progress where the group passes its own option.
  const far = Math.min(home, ...items.map((_, i) => targets[i] ?? home));
  const arrival = (i: number) =>
    TRAVEL_START + (far < home ? (home - (targets[i] ?? home)) / (home - far) : 1) * (TRAVEL_END - TRAVEL_START);

  const dividerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(clamp(progress.value, 0, 0.75), [0, 1], [dividerRest, DIVIDER_OPEN]) }],
  }));
  // Everything right of the divider: the menu is revealed as it passes.
  const windowStyle = useAnimatedStyle(() => ({
    width: width - interpolate(clamp(progress.value, 0, 0.75), [0, 1], [dividerRest, DIVIDER_OPEN]),
  }));

  if (!width) return null;
  return (
    <>
      <Animated.View
        style={[styles.window, windowStyle]}
        pointerEvents={open ? "box-none" : "none"}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        <View style={[styles.row, { width: width - 4 - ROW_LEFT }]}>
          {items.map(([icon, label, href], i) => (
            <Option
              key={href}
              index={i}
              progress={progress}
              icon={icon}
              label={label}
              color={color}
              arrive={arrival(i)}
              onMeasured={report}
              onPress={() => onPick(href)}
            />
          ))}
        </View>
      </Animated.View>

      <Animated.View style={[styles.divider, { backgroundColor: dividerColor }, dividerStyle]} pointerEvents="none" />

      {items.map((_, i) => (
        <Bar
          key={i}
          index={i}
          progress={progress}
          from={home}
          far={far}
          to={targets[i] ?? home}
          arrive={arrival(i)}
          color={color}
        />
      ))}

      <Pressable
        onPress={onOpen}
        pointerEvents={open ? "none" : "auto"}
        accessibilityRole="button"
        accessibilityLabel="Menu"
        accessibilityState={{ expanded: open }}
        hitSlop={4}
        style={styles.button}
      />
    </>
  );
}

/** One hamburger line: rides left with the others, stops at its option and becomes its icon. */
function Bar({
  index,
  progress,
  from,
  far,
  to,
  arrive,
  color,
}: {
  index: number;
  progress: SharedValue<number>;
  from: number;
  far: number;
  to: number;
  arrive: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const group = interpolate(clamp(p, TRAVEL_START, TRAVEL_END), [0, 1], [from, far]);
    const off = clamp(p, arrive, arrive + BREAK);
    return {
      opacity: 1 - off,
      transform: [
        { translateX: Math.max(group, to) - BAR_W / 2 },
        // Breaking off, the line drops into the row the icons sit on.
        { translateY: (index - 1) * BAR_GAP * (1 - off) },
      ],
    };
  });
  return <Animated.View pointerEvents="none" style={[styles.bar, { backgroundColor: color }, style]} />;
}

function Option({
  index,
  progress,
  icon,
  label,
  color,
  arrive,
  onMeasured,
  onPress,
}: {
  index: number;
  progress: SharedValue<number>;
  icon: FeatherIconName;
  label: string;
  color: string;
  /** Progress at which this option's line breaks off here. */
  arrive: number;
  onMeasured: (index: number, x: number) => void;
  onPress: () => void;
}) {
  const [slotX, setSlotX] = useState<number | null>(null);
  const [contentX, setContentX] = useState<number | null>(null);
  useEffect(() => {
    if (slotX != null && contentX != null) onMeasured(index, ROW_LEFT + slotX + contentX + 8);
  }, [slotX, contentX, index, onMeasured]);

  const iconStyle = useAnimatedStyle(() => {
    const t = clamp(progress.value, arrive + 0.03, arrive + BREAK + 0.03);
    return { opacity: t, transform: [{ scale: 0.5 + t * 0.5 }] };
  });
  const labelStyle = useAnimatedStyle(() => {
    const t = clamp(progress.value, arrive + 0.08, arrive + BREAK + 0.1);
    return { opacity: t, transform: [{ translateX: (1 - t) * 6 }] };
  });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      onLayout={(e: LayoutChangeEvent) => setSlotX(e.nativeEvent.layout.x)}
      style={({ pressed }) => [styles.option, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={styles.content} onLayout={(e) => setContentX(e.nativeEvent.layout.x)}>
        <Animated.View style={iconStyle}>
          <Feather name={icon} size={16} color={color} />
        </Animated.View>
        <Animated.Text
          style={[styles.label, { color }, labelStyle]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {label}
        </Animated.Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  window: { position: "absolute", top: 0, bottom: 0, right: 0, overflow: "hidden" },
  row: { position: "absolute", top: 0, bottom: 0, right: 4, flexDirection: "row" },
  option: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", alignItems: "center", justifyContent: "center" },
  content: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 14, flexShrink: 1 },
  divider: { position: "absolute", left: 0, top: (HEIGHT - 24) / 2, width: StyleSheet.hairlineWidth, height: 24 },
  bar: { position: "absolute", left: 0, top: HEIGHT / 2 - 1, width: BAR_W, height: 2, borderRadius: 1 },
  button: {
    position: "absolute",
    right: 4,
    top: (HEIGHT - BUTTON) / 2,
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
  },
});
