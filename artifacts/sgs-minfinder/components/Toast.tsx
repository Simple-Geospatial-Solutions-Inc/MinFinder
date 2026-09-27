import React, { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Feather, type FeatherIconName } from "@/components/Icon";
import { floating, type } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

// One app-wide toast: a line of confirmation that outlives the screen that
// raised it (a report saved on the capture screen shows over the mine it's for).
let show: ((text: string, icon: FeatherIconName) => void) | null = null;

export function toast(text: string, icon: FeatherIconName = "check"): void {
  show?.(text, icon);
  AccessibilityInfo.announceForAccessibility(text);
}

/** Mounted once, in app/_layout.tsx, above every screen. */
export function ToastHost() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<{ text: string; icon: FeatherIconName; key: number } | null>(null);

  useEffect(() => {
    show = (text, icon) => setMsg({ text, icon, key: Date.now() });
    return () => {
      show = null;
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);

  if (!msg) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <Animated.View
        key={msg.key}
        entering={FadeInUp}
        exiting={FadeOutUp}
        style={[styles.toast, { backgroundColor: colors.navyDeep }]}
      >
        <Feather name={msg.icon} size={18} color={colors.gold} />
        <Text style={[type.label, styles.text]}>{msg.text}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    maxWidth: 480,
    ...floating,
  },
  text: { color: "#FFFFFF", flexShrink: 1 },
});
