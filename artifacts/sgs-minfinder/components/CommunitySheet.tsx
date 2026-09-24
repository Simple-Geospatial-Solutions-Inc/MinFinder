import { BottomSheetView } from "@gorhom/bottom-sheet";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusChip, TIER_STATUS } from "@/components/capture/StatusChip";
import { PaywallSheet } from "@/components/PaywallSheet";
import { GUTTER, IconButton, Notice, PillButton, radius, Sheet, type, useLast } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useEntitlement } from "@/hooks/useEntitlement";
import { API_URL, authHeader } from "@/lib/auth";
import { formatShortDate } from "@/lib/format";
import { HAZARDS, MINE_TYPES, type MapMine, type Tier } from "@/lib/sync";

const TYPE_LABEL = Object.fromEntries(MINE_TYPES) as Record<string, string>;
const HAZARD_LABEL = Object.fromEntries(HAZARDS) as Record<string, string>;

// What the badge means, said once in words.
const TIER_NOTE: Record<Tier, string> = {
  pending: "Only you can see this until SGS reviews it.",
  unverified: "Added by a community member. No one else has confirmed it yet.",
  confirmed: "Confirmed on site by other members.",
  verified: "Checked by SGS.",
  hidden: "Hidden while SGS looks into reports about it.",
};

/**
 * A community mine, opened from its ring on the map: photos first, then what
 * it is, how far to trust it and what to watch for. Navigate is Pro, as it is
 * for MINFILE.
 */
export function CommunitySheet({ mine: current, onClose }: { mine: MapMine | null; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isPaid } = useEntitlement();
  const [paywall, setPaywall] = useState(false);
  const mine = useLast(current);
  if (!mine) return null;

  const label = TYPE_LABEL[mine.type] ?? "Mine";
  const status = mine.queued
    ? { icon: "clock" as const, label: "On this phone", tone: "wait" as const }
    : TIER_STATUS[mine.tier];
  const note = mine.queued ? "Uploads when you have signal." : TIER_NOTE[mine.tier];
  const facts = [
    label,
    mine.commodity,
    formatShortDate(mine.captured_at),
    mine.own ? "Added by you" : null,
  ].filter(Boolean);

  const navigate = () => {
    if (!isPaid) return setPaywall(true);
    onClose();
    router.push({
      pathname: "/compass",
      params: { lat: String(mine.lat), lon: String(mine.lon), name: mine.name || label },
    });
  };

  return (
    <>
      <Sheet open={!!current} enablePanDownToClose onClose={onClose}>
        <BottomSheetView style={[styles.body, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.head}>
            <View style={styles.titleCol}>
              <Text style={[type.title, { color: colors.foreground }]} numberOfLines={1} accessibilityRole="header">
                {mine.name || label}
              </Text>
              <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                {facts.join(" · ")}
              </Text>
            </View>
            <IconButton icon="x" label="Close" onPress={onClose} />
          </View>

          {mine.photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
              {mine.photos.map((p, i) => (
                <Image
                  key={p}
                  source={
                    mine.queued
                      ? { uri: p }
                      : { uri: `${API_URL}/v1/photos/${p}_t.jpg`, headers: mine.tier === "pending" || mine.tier === "hidden" ? authHeader() : undefined }
                  }
                  style={[styles.photo, { backgroundColor: colors.muted }]}
                  accessibilityLabel={`Photo ${i + 1} of ${mine.photos.length}`}
                />
              ))}
            </ScrollView>
          )}

          <View style={styles.trust}>
            <StatusChip status={status} />
            <Text style={[type.meta, { color: colors.mutedForeground }]}>{note}</Text>
          </View>

          {mine.hazards.length > 0 && (
            <Notice icon="alert-triangle" tone="danger">
              {mine.hazards.map((h) => HAZARD_LABEL[h] ?? h).join(", ")}
            </Notice>
          )}

          {!!mine.notes && <Text style={[type.meta, { color: colors.foreground }]}>{mine.notes}</Text>}

          {mine.nudge_m >= 5 && (
            <Text style={[type.meta, { color: colors.mutedForeground }]}>
              Pin placed {mine.nudge_m} m from where {mine.own ? "you" : "they"} stood.
            </Text>
          )}

          <PillButton
            label="Navigate"
            icon={isPaid ? "navigation" : "lock"}
            onPress={navigate}
            accessibilityHint={isPaid ? undefined : "MinFinder Pro feature"}
          />
        </BottomSheetView>
      </Sheet>
      <PaywallSheet visible={paywall} feature="Navigate" onClose={() => setPaywall(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: GUTTER, paddingTop: 4, gap: 16 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleCol: { flex: 1, minWidth: 0, gap: 4 },
  photos: { gap: 8 },
  photo: { width: 128, height: 128, borderRadius: radius.md },
  trust: { gap: 6 },
});
