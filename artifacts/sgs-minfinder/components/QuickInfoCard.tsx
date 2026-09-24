import { BottomSheetView } from "@gorhom/bottom-sheet";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PaywallSheet } from "@/components/PaywallSheet";
import { StatusBadge } from "@/components/StatusBadge";
import { GUTTER, IconButton, PillButton, Sheet, type, useLast } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useEntitlement } from "@/hooks/useEntitlement";
import type { Occurrence } from "@/lib/db";

/**
 * The peek sheet shown when a single marker is tapped: name, status and
 * MINFILNO, with Navigate and Details. Both actions are Pro, so a free user
 * sees a lock on each and gets the paywall instead.
 */
export function QuickInfoCard({
  occurrence,
  matchedName,
  onClose,
  onExpand,
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
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isPaid } = useEntitlement();
  const [paywallFor, setPaywallFor] = useState<string | null>(null);
  // Held through the close animation, match and all.
  const last = useLast(useMemo(() => occurrence && { occurrence, matchedName }, [occurrence, matchedName]));
  if (!last) return null;
  const { occurrence: shown, matchedName: match } = last;

  const minfilno = shown.MINFILNO?.trim() || "—";
  const navigate = () => {
    if (!isPaid) return setPaywallFor("Navigate");
    onClose();
    router.push({ pathname: "/compass", params: { id: String(shown.id) } });
  };

  return (
    <>
      <Sheet open={!!occurrence} enablePanDownToClose onClose={onClose}>
        <BottomSheetView style={[styles.body, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.head}>
            <View style={styles.titleCol}>
              {/* Lead with the matched name, as the search dropdown does. The
                  primary name then has to stay visible below it — "CAMP CREEK" alone
                  would read as the occurrence's name, which is the opposite error. */}
              <Text style={[type.title, { color: colors.foreground }]} numberOfLines={1} accessibilityRole="header">
                {match || shown.NAME1 || "Unnamed"}
              </Text>
              <View style={styles.metaRow}>
                <StatusBadge code={shown.STATUS_C} />
                <Text style={[type.meta, { color: colors.mutedForeground, flexShrink: 1 }]} numberOfLines={1}>
                  {match ? `${shown.NAME1?.trim() || "Unnamed"} · ${minfilno}` : `MINFILE ${minfilno}`}
                </Text>
              </View>
            </View>
            <IconButton icon="x" label="Close" onPress={onClose} />
          </View>
          <View style={styles.pair}>
            <PillButton
              label="Navigate"
              icon={isPaid ? "navigation" : "lock"}
              onPress={navigate}
              accessibilityHint={isPaid ? undefined : "MinFinder Pro feature"}
            />
            <PillButton
              label="Details"
              variant="secondary"
              icon={isPaid ? undefined : "lock"}
              onPress={() => (isPaid ? onExpand() : setPaywallFor("Full details"))}
              accessibilityHint={isPaid ? undefined : "MinFinder Pro feature"}
            />
          </View>
        </BottomSheetView>
      </Sheet>
      <PaywallSheet visible={paywallFor != null} feature={paywallFor ?? ""} onClose={() => setPaywallFor(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: GUTTER, paddingTop: 4, gap: 16 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleCol: { flex: 1, minWidth: 0, gap: 6 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pair: { flexDirection: "row", gap: 8 },
});
