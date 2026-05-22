import { Feather } from "@/components/Icon";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { StatusBadge } from "@/components/StatusBadge";
import { useColors } from "@/hooks/useColors";
import type { Occurrence } from "@/lib/db";

/**
 * Compact two-line preview shown when a single marker is tapped. Shows the
 * occurrence name, status badge and MINFILNO. A "+" expand button opens the
 * full DetailsSheet — that expand action is intended to be paywalled in a
 * future release (premium upgrade required to see the full record).
 */
export function QuickInfoCard({
  occurrence,
  onClose,
  onExpand,
  bottomOffset,
}: {
  occurrence: Occurrence | null;
  onClose: () => void;
  onExpand: () => void;
  bottomOffset: number;
}) {
  const colors = useColors();
  if (!occurrence) return null;

  return (
    <View
      style={[
        styles.card,
        {
          bottom: bottomOffset,
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.titleCol}>
          <Text
            style={[styles.title, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {occurrence.NAME1 || "Unnamed"}
          </Text>
          <View style={styles.metaRow}>
            <StatusBadge code={occurrence.STATUS_C} size="sm" />
            <Text
              style={[styles.minfilno, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {occurrence.MINFILNO?.trim() || "—"}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              onClose();
              router.push({
                pathname: "/compass",
                params: { id: String(occurrence.id) },
              });
            }}
            accessibilityLabel="Navigate"
            hitSlop={6}
            style={({ pressed }) => [
              styles.iconBtn,
              {
                backgroundColor: colors.primary,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="navigation" size={18} color={colors.primaryForeground} />
          </Pressable>

          <Pressable
            onPress={onExpand}
            accessibilityLabel="Show full details"
            hitSlop={6}
            style={({ pressed }) => [
              styles.iconBtn,
              {
                backgroundColor: colors.gold,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="plus" size={20} color={colors.navyDeep} />
          </Pressable>

          <Pressable
            onPress={onClose}
            accessibilityLabel="Dismiss"
            hitSlop={6}
            style={({ pressed }) => [
              styles.iconBtn,
              {
                backgroundColor: colors.muted,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Feather name="x" size={18} color={colors.foreground} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  titleCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    letterSpacing: -0.2,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  minfilno: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
