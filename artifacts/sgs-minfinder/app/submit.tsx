import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { router, Stack } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CaptureMap, MarkSheet, type LatLon, type Phase } from "@/components/capture/CaptureMap";
import { DetailsSheet, type SavedMine } from "@/components/capture/DetailsSheet";
import { useLiveFix, type LiveFix } from "@/components/capture/gps";
import { StatusChip } from "@/components/capture/StatusChip";
import { floating, GUTTER, PillButton, type } from "@/components/capture/ui";
import { Feather } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { useSignedIn } from "@/lib/auth";
import { getMyMines, MINE_TYPES, onSyncChange, type MyMine } from "@/lib/sync";

/**
 * Add a mine, all on one map: mark the spot, describe it in a sheet that grows
 * over the map, then a summary over the pin. The GPS watch lives here so it runs
 * across every step.
 */
export default function SubmitScreen() {
  const { fix, state } = useLiveFix();
  const [phase, setPhase] = useState<Phase>("mark");
  const [center, setCenter] = useState<LatLon | null>(null);
  const [marked, setMarked] = useState<{ pin: LatLon; at: LiveFix } | null>(null);
  const [saved, setSaved] = useState<SavedMine | null>(null);
  // Bumped by "Add another" to give the details sheet a clean slate.
  const [round, setRound] = useState(0);
  const [myMines, setMyMines] = useState<MyMine[]>([]);
  useEffect(() => {
    const load = () => void getMyMines().then(setMyMines).catch(() => {});
    load();
    return onSyncChange(load);
  }, []);

  // Once there's something to lose, leaving asks first. Photos and typing live
  // only in this screen until Save.
  const leave = useCallback(() => {
    if (!marked || phase === "saved") return router.back();
    Alert.alert("Discard this mine?", "The pin and anything you've added will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  }, [marked, phase]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (phase === "details") setPhase("mark");
      else leave();
      return true;
    });
    return () => sub.remove();
  }, [phase, leave]);

  const another = () => {
    setMarked(null);
    setSaved(null);
    setRound((r) => r + 1);
    setPhase("mark");
  };

  return (
    <View style={styles.root}>
      {/* A swipe would drop the capture without asking. */}
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <CaptureMap
        phase={phase}
        fix={fix}
        gps={state}
        pin={marked?.pin ?? null}
        myMines={myMines}
        onCenter={setCenter}
        onClose={leave}
      />
      <MarkSheet
        open={phase === "mark"}
        fix={fix}
        gps={state}
        center={center}
        myMines={myMines}
        onMark={(pin, at) => {
          setMarked({ pin, at });
          setPhase("details");
        }}
      />
      {marked && (
        <DetailsSheet
          key={round}
          open={phase === "details"}
          pin={marked.pin}
          markedAt={marked.at}
          fix={fix}
          gps={state}
          myMines={myMines}
          onAdjust={() => setPhase("mark")}
          onSaved={(m) => {
            setSaved(m);
            setPhase("saved");
          }}
        />
      )}
      {phase === "saved" && saved && <SavedSheet mine={saved} onDone={() => router.back()} onAnother={another} />}
    </View>
  );
}

/** The summary over the pin: what was saved, where it stands, what's next. */
function SavedSheet({ mine, onDone, onAnother }: { mine: SavedMine; onDone: () => void; onAnother: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const signedIn = useSignedIn();
  const label = MINE_TYPES.find(([k]) => k === mine.type)?.[1] ?? "Mine";

  return (
    <BottomSheet
      index={0}
      enablePanDownToClose={false}
      backgroundStyle={{ backgroundColor: colors.card, borderRadius: 16 }}
      handleIndicatorStyle={{ width: 32, height: 5, backgroundColor: colors.border }}
      style={floating}
    >
      <BottomSheetView style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.head}>
          <View style={styles.okDisc}>
            <Feather name="check" size={18} color="#1B6B3A" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
              Saved to this phone
            </Text>
            <Text style={[type.meta, { color: colors.mutedForeground }]}>
              {label} · {mine.photos} {mine.photos === 1 ? "photo" : "photos"}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => router.replace("/my-submissions")}
          accessibilityRole="link"
          style={styles.statusRow}
          hitSlop={8}
        >
          <StatusChip
            status={
              signedIn
                ? { icon: "clock", label: "Uploads when you have signal", tone: "wait" }
                : { icon: "user", label: "Sign in to upload", tone: "wait" }
            }
          />
          <Text style={[type.link, { color: colors.primary }]}>My submissions</Text>
        </Pressable>
        <View style={styles.pair}>
          <PillButton label="Done" variant="secondary" onPress={onDone} />
          <PillButton label="Add another" icon="plus" onPress={onAnother} />
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  sheet: { paddingHorizontal: GUTTER, paddingTop: 4, gap: 16 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  okDisc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#E3F1E7",
    alignItems: "center",
    justifyContent: "center",
  },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 32 },
  pair: { flexDirection: "row", gap: 8 },
});
