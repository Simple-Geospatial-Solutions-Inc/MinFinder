import { BottomSheetView } from "@gorhom/bottom-sheet";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusChip, TIER_STATUS } from "@/components/capture/StatusChip";
import { Feather } from "@/components/Icon";
import { PaywallSheet } from "@/components/PaywallSheet";
import {
  Chip,
  GUTTER,
  IconButton,
  ListRow,
  ListSection,
  Notice,
  PillButton,
  radius,
  Sheet,
  TextButton,
  type,
  useLast,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useEntitlement } from "@/hooks/useEntitlement";
import { API_URL, authHeader, useSignedIn } from "@/lib/auth";
import { formatShortDate } from "@/lib/format";
import {
  blockAuthor,
  castVote,
  getMyVotes,
  HAZARDS,
  MINE_TYPES,
  onSyncChange,
  REPORT_REASONS,
  reportMine,
  type MapMine,
  type ReportReason,
  type Tier,
  type VoteValue,
} from "@/lib/sync";

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

const OFFLINE = "That needs a connection. Try again when you have signal.";

/**
 * A community mine, opened from its ring on the map: photos first, then what
 * it is, how far to trust it and what to watch for. Other members' mines can be
 * voted on, reported or their author blocked. Navigate is Pro, as for MINFILE.
 */
export function CommunitySheet({ mine: current, onClose }: { mine: MapMine | null; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isPaid } = useEntitlement();
  const signedIn = useSignedIn();
  const [paywall, setPaywall] = useState(false);
  const [view, setView] = useState<"info" | "report" | "reported">("info");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vote, setVote] = useState<{ value: VoteValue; pending: boolean }>({ value: 0, pending: false });
  const mine = useLast(current);
  const id = mine?.id;

  // Each mine opens on its details.
  useEffect(() => {
    setView("info");
    setError(null);
  }, [current?.id]);

  useEffect(() => {
    if (!id) return;
    const load = () =>
      void getMyVotes().then(({ votes, pending }) => setVote({ value: votes[id] ?? 0, pending: pending.has(id) }));
    load();
    return onSyncChange(load);
  }, [id]);

  if (!mine) return null;

  const label = TYPE_LABEL[mine.type] ?? "Mine";
  const status = mine.queued
    ? { icon: "clock" as const, label: "On this phone", tone: "wait" as const }
    : TIER_STATUS[mine.tier];
  const note = mine.queued ? "Uploads when you have signal." : TIER_NOTE[mine.tier];
  const facts = [label, mine.commodity, formatShortDate(mine.captured_at), mine.own ? "Added by you" : null].filter(Boolean);
  // Someone else's, and public: the server takes votes, reports and blocks only then.
  const theirs = !mine.own && !mine.queued && mine.tier !== "pending" && mine.tier !== "hidden";

  const needSignIn = (what: string) =>
    Alert.alert(`Sign in to ${what}`, "Browsing never needs an account. Voting and reporting do, to keep them fair.", [
      { text: "Not now", style: "cancel" },
      {
        text: "Sign in",
        onPress: () => {
          onClose();
          router.push("/my-submissions");
        },
      },
    ]);

  const press = (value: VoteValue) => {
    if (!signedIn) return needSignIn("vote");
    const next = vote.value === value ? 0 : value;
    setVote({ value: next, pending: true });
    void castVote(mine.id, next);
  };

  const report = async (reason: ReportReason) => {
    setBusy(true);
    setError(null);
    try {
      await reportMine(mine.id, reason);
      setView("reported");
    } catch {
      setError(OFFLINE);
    } finally {
      setBusy(false);
    }
  };

  const block = () =>
    Alert.alert("Block this member?", "You won't see anything they've added, now or later. You can undo this in Submissions.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          try {
            await blockAuthor(mine.id);
            onClose();
          } catch {
            setError(OFFLINE);
          }
        },
      },
    ]);

  const navigate = () => {
    if (!isPaid) return setPaywall(true);
    onClose();
    router.push({
      pathname: "/compass",
      params: { lat: String(mine.lat), lon: String(mine.lon), name: mine.name || label },
    });
  };

  const errorLine = error && (
    <Text style={[type.meta, { color: colors.destructive }]} accessibilityLiveRegion="polite">
      {error}
    </Text>
  );

  return (
    <>
      <Sheet open={!!current} enablePanDownToClose onClose={onClose}>
        <BottomSheetView style={[styles.body, { paddingBottom: insets.bottom + 16 }]}>
          {view === "report" ? (
            <>
              <ListSection
                title="What's wrong with it?"
                subtitle="SGS reviews every report. Two reports hide a mine until then."
                action={{ label: "Back", onPress: () => setView("info") }}
              >
                {REPORT_REASONS.map(([reason, text]) => (
                  <ListRow key={reason} onPress={busy ? undefined : () => void report(reason)} accessibilityLabel={text}>
                    <Text style={[type.label, styles.grow, { color: colors.foreground }]}>{text}</Text>
                  </ListRow>
                ))}
              </ListSection>
              {errorLine}
              <TextButton label="Block this member" icon="user-x" tone="destructive" onPress={block} />
            </>
          ) : view === "reported" ? (
            <>
              <View style={styles.head}>
                <View style={[styles.okDisc, { backgroundColor: colors.successSubtle }]}>
                  <Feather name="check" size={18} color={colors.success} />
                </View>
                <View style={styles.titleCol}>
                  <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
                    Thanks for the report
                  </Text>
                  <Text style={[type.meta, { color: colors.mutedForeground }]}>SGS will take a look.</Text>
                </View>
              </View>
              {errorLine}
              <View style={styles.pair}>
                <PillButton label="Block this member" variant="secondary" onPress={block} />
                <PillButton label="Done" onPress={onClose} />
              </View>
            </>
          ) : (
            <>
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
                          : {
                              uri: `${API_URL}/v1/photos/${p}_t.jpg`,
                              headers: mine.tier === "pending" || mine.tier === "hidden" ? authHeader() : undefined,
                            }
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

              {theirs && (
                <View style={styles.vote}>
                  <View style={styles.voteHead}>
                    <Text style={[type.label, { color: colors.foreground }]}>Is it there?</Text>
                    <Text style={[type.meta, { color: colors.mutedForeground }]}>
                      {mine.ups} yes · {mine.downs} no
                    </Text>
                  </View>
                  <View style={styles.chips}>
                    <Chip
                      label="Yes, it's there"
                      role="checkbox"
                      selected={vote.value === 1}
                      onPress={() => press(1)}
                      icon={(c) => <Feather name="thumbs-up" size={16} color={c} />}
                    />
                    <Chip
                      label="No"
                      role="checkbox"
                      selected={vote.value === -1}
                      onPress={() => press(-1)}
                      icon={(c) => <Feather name="thumbs-down" size={16} color={c} />}
                    />
                  </View>
                  <Text style={[type.meta, { color: colors.mutedForeground }]}>
                    {vote.pending && vote.value !== 0
                      ? "Your vote uploads when you have signal."
                      : "Votes from within 150 m of the mine count double."}
                  </Text>
                </View>
              )}

              {errorLine}

              <PillButton
                label="Navigate"
                icon={isPaid ? "navigation" : "lock"}
                onPress={navigate}
                accessibilityHint={isPaid ? undefined : "MinFinder Pro feature"}
              />

              {theirs && (
                <TextButton
                  label="Report or block"
                  icon="flag"
                  onPress={() => (signedIn ? setView("report") : needSignIn("report"))}
                />
              )}
            </>
          )}
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
  grow: { flex: 1 },
  photos: { gap: 8 },
  photo: { width: 128, height: 128, borderRadius: radius.md },
  trust: { gap: 6 },
  vote: { gap: 10 },
  voteHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  okDisc: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  pair: { flexDirection: "row", gap: 8 },
});
