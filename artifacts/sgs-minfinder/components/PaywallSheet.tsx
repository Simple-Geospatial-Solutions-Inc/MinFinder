import { Feather } from "@/components/Icon";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

/**
 * Placeholder paywall sheet shown when a free user taps a premium feature.
 * Replace `onUpgrade` body with the RevenueCat purchase flow when ready —
 * the rest of the app does not need to change.
 */
export function PaywallSheet({
  visible,
  feature,
  onClose,
}: {
  visible: boolean;
  /** Short label for the feature the user tried to use, e.g. "Navigate" or "Full details". */
  feature: string;
  onClose: () => void;
}) {
  const colors = useColors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: colors.gold + "22" }]}>
              <Feather name="lock" size={18} color={colors.gold} />
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [
                styles.closeBtn,
                { backgroundColor: colors.muted, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name="x" size={16} color={colors.foreground} />
            </Pressable>
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            {feature} is a premium feature
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            Upgrade to MinFinder Pro to unlock navigation, full occurrence
            details, and more.
          </Text>

          <Pressable
            onPress={() => {
              // TODO: trigger RevenueCat purchase flow here.
              onClose();
            }}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: colors.gold, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.primaryBtnText, { color: colors.navyDeep }]}>
              Upgrade to Pro
            </Text>
          </Pressable>

          <Pressable onPress={onClose} hitSlop={6} style={styles.secondaryBtn}>
            <Text
              style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}
            >
              Maybe later
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 18 },
  body: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  primaryBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  secondaryBtn: { paddingVertical: 8, alignItems: "center" },
  secondaryBtnText: { fontFamily: "Inter_500Medium", fontSize: 13 },
});
