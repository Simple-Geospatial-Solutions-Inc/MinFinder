import { Feather } from "@/components/Icon";
import { PaywallSheet } from "@/components/PaywallSheet";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { StatusBadge } from "@/components/StatusBadge";
import { useColors } from "@/hooks/useColors";
import { useEntitlement } from "@/hooks/useEntitlement";
import type { Occurrence } from "@/lib/db";

/** Small lock pip rendered in the corner of a gated action button. */
function LockBadge() {
  return (
    <View style={styles.lockBadge}>
      <Feather name="lock" size={9} color="#1A2436" />
    </View>
  );
}

/**
 * Compact two-line preview shown when a single marker is tapped. Shows the
 * occurrence name, status badge and MINFILNO. A "+" expand button opens the
 * full DetailsSheet — that expand action is intended to be paywalled in a
 * future release (premium upgrade required to see the full record).
 */
export function QuickInfoCard({
  occurrence,
  matchedName,
  onClose,
  onExpand,
  bottomOffset,
}: {
  occurrence: Occurrence | null;
  /**
   * The name that put this occurrence in the committed search, when that is not
   * its primary name. Most MINFILE occurrences carry several names, so searching
   * "CAMP CREEK" surfaces pins called JUNIPER, WOODCOCK and THORN — tapping one
   * of those and reading only "JUNIPER" gives no clue why it is on the map.
   * Null when no search is committed, or when the query matched the primary name.
   */
  matchedName?: string | null;
  onClose: () => void;
  onExpand: () => void;
  bottomOffset: number;
}) {
  const colors = useColors();
  const { isPaid } = useEntitlement();
  const [paywallFor, setPaywallFor] = useState<string | null>(null);
  if (!occurrence) return null;

  const navigateAction = () => {
    onClose();
    router.push({
      pathname: "/compass",
      params: { id: String(occurrence.id) },
    });
  };

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
          {/* Lead with the matched name, as the search dropdown does. The
              primary name then has to stay visible below it — "CAMP CREEK" alone
              would read as the occurrence's name, which is the opposite error. */}
          <Text
            style={[styles.title, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {matchedName || occurrence.NAME1 || "Unnamed"}
          </Text>
          <View style={styles.metaRow}>
            <StatusBadge code={occurrence.STATUS_C} size="sm" />
            <Text
              style={[styles.minfilno, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {matchedName
                ? `${occurrence.NAME1?.trim() || "Unnamed"} · ${occurrence.MINFILNO?.trim() || "—"}`
                : occurrence.MINFILNO?.trim() || "—"}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() =>
              isPaid ? navigateAction() : setPaywallFor("Navigate")
            }
            accessibilityLabel={isPaid ? "Navigate" : "Navigate (premium)"}
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
            {!isPaid && <LockBadge />}
          </Pressable>

          <Pressable
            onPress={() => (isPaid ? onExpand() : setPaywallFor("Full details"))}
            accessibilityLabel={
              isPaid ? "Show full details" : "Show full details (premium)"
            }
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
            {!isPaid && <LockBadge />}
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

      <PaywallSheet
        visible={paywallFor != null}
        feature={paywallFor ?? ""}
        onClose={() => setPaywallFor(null)}
      />
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
  lockBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#FCBA19",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#0B1B33",
  },
});
