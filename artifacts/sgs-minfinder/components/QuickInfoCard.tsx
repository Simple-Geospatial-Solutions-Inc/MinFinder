import BottomSheet, { BottomSheetBackdrop, BottomSheetView, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { router } from "expo-router";
import React, { useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusChip } from "@/components/capture/StatusChip";
import { DETAILS_SNAPS } from "@/components/DetailsSheet";
import { useReports } from "@/components/FieldReports";
import { StatusBadge } from "@/components/StatusBadge";
import { GUTTER, IconButton, PillButton, Sheet, type, useLast } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useEntitlement } from "@/hooks/useEntitlement";
import type { Occurrence } from "@/lib/db";
import { mineSummary } from "@/lib/sync";

/**
 * The peek sheet shown when a single marker is tapped: name, status and
 * MINFILNO, with Navigate and Details. Navigate is Pro. Details opens for
 * everyone: free users get the field reports there, and DetailsSheet gates the
 * full record itself.
 *
 * The card can be pulled up to where the details sheet opens; heading there
 * (swiped, or carried by Details) calls `onExpand`, and DetailsSheet fades in
 * over it in place.
 */
export function QuickInfoCard({
  occurrence,
  matchedName,
  onClose,
  onExpand,
  onRequestUpgrade,
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
  /** The card is headed for the details sheet's height. */
  onExpand: () => void;
  /** A free user tapped Navigate. The map owns the one paywall, stacked over this card. */
  onRequestUpgrade: (feature: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isPaid } = useEntitlement();
  const sheet = useRef<BottomSheet>(null);
  // Held through the close animation, match and all.
  const last = useLast(useMemo(() => occurrence && { occurrence, matchedName }, [occurrence, matchedName]));
  const summary = mineSummary(useReports(last?.occurrence.MINFILNO?.trim()).reports);
  if (!last) return null;
  const { occurrence: shown, matchedName: match } = last;

  const minfilno = shown.MINFILNO?.trim() || "—";
  const navigate = () => {
    if (!isPaid) return onRequestUpgrade("navigation");
    onClose();
    router.push({ pathname: "/compass", params: { id: String(shown.id) } });
  };

  return (
    <Sheet
      ref={sheet}
      open={!!occurrence}
      enablePanDownToClose
      onClose={onClose}
      snapPoints={EXPANDED}
      topInset={insets.top}
      // On setting off rather than arriving: onChange waits out the spring's
      // long tail, and the details sheet takes a moment to mount.
      onAnimate={(_, to) => to === 1 && onExpand()}
      backdropComponent={renderBackdrop}
    >
      <BottomSheetView style={[styles.body, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.head}>
          <View style={styles.titleCol}>
            {/* Lead with the matched name, as the search dropdown does. The
                  primary name then has to stay visible below it — "CAMP CREEK" alone
                  would read as the occurrence's name, which is the opposite error. */}
            <Text style={[type.title, { color: colors.foreground }]} numberOfLines={2} accessibilityRole="header">
              {match || shown.NAME1 || "Unnamed"}
            </Text>
            <View style={styles.metaRow}>
              <StatusBadge code={shown.STATUS_C} />
              <Text style={[type.meta, { color: colors.mutedForeground, flexShrink: 1 }]} numberOfLines={1}>
                {match ? `${shown.NAME1?.trim() || "Unnamed"} · ${minfilno}` : `MINFILE ${minfilno}`}
              </Text>
            </View>
            {summary.disputed ? (
              <StatusChip status={{ icon: "wrench", label: "Location disputed by visitors", tone: "wait" }} />
            ) : summary.best ? (
              <StatusChip status={{ icon: "check", label: "Better location confirmed", tone: "ok" }} />
            ) : null}
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
          <PillButton label="Details" variant="secondary" onPress={() => sheet.current?.snapToIndex(1)} />
        </View>
      </BottomSheetView>
    </Sheet>
  );
}

// With dynamic sizing, the card's own height is snap 0 and this is snap 1.
const EXPANDED = [DETAILS_SNAPS[0]];

// Fades in on the way up to the details sheet's dim, so the handover doesn't pop it.
const renderBackdrop = (p: BottomSheetBackdropProps) => (
  <BottomSheetBackdrop {...p} appearsOnIndex={1} disappearsOnIndex={0} opacity={0.25} />
);

const styles = StyleSheet.create({
  body: { paddingHorizontal: GUTTER, paddingTop: 4, gap: 16 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleCol: { flex: 1, minWidth: 0, gap: 6 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pair: { flexDirection: "row", gap: 8 },
});
