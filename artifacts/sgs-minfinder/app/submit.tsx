import {
  BottomSheetFooter,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetFooterProps,
} from "@gorhom/bottom-sheet";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router, Stack, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CaptureMap, DETAILS_SNAP, MarkSheet, type LatLon, type Phase } from "@/components/capture/CaptureMap";
import { DetailsSheet, PhotoPicker, SafetyAck, type Mine } from "@/components/capture/DetailsSheet";
import { describeGps, useLiveFix, type LiveFix } from "@/components/capture/gps";
import { StatusChip } from "@/components/capture/StatusChip";
import { GUTTER, PillButton, Segmented, Sheet, type, useLast } from "@/components/ui";
import { Feather } from "@/components/Icon";
import { toast } from "@/components/Toast";
import { useColors } from "@/hooks/useColors";
import { useSignedIn } from "@/lib/auth";
import { distanceMeters, formatDistance } from "@/lib/geo";
import { LABEL_TEXT, MAX_TEXT, online, queueSubmission, SEARCH_RADII, type Label } from "@/lib/sync";

/**
 * A field report on one MINFILE mine, opened from its details sheet:
 * - location: mark each working on site (an adit, its dump, a shaft), one after another
 * - not_found: "I searched here and found nothing", from inside a stated radius
 * - note: a line of text, from anywhere
 * All of them save to the phone first and upload when there's signal.
 */
export default function SubmitScreen() {
  const p = useLocalSearchParams<{ kind?: string; minfilno?: string; name?: string; lat?: string; lon?: string }>();
  const mine = useMemo<Mine | null>(
    () =>
      p.minfilno && p.lat && p.lon
        ? { minfilno: p.minfilno, name: p.name || `MINFILE ${p.minfilno}`, published: { lat: Number(p.lat), lon: Number(p.lon) } }
        : null,
    [p.minfilno, p.name, p.lat, p.lon],
  );
  if (!mine) return null;
  if (p.kind === "note") return <NoteForm mine={mine} />;
  if (p.kind === "not_found") return <SearchReport mine={mine} />;
  return <MarkWorkings mine={mine} />;
}

/** Back to the mine's sheet, saying what was saved and what happens to it next. */
async function finish(what: string, signedIn: boolean) {
  router.back();
  // ponytail: "posted" trusts the connection; an upload that fails anyway shows on the item in the list.
  toast(
    !signedIn
      ? `${what} saved on this phone. Sign in to upload it.`
      : (await online())
        ? `${what} posted.`
        : `${what} saved. It uploads when you have signal.`,
  );
}

/**
 * Asks before leaving with unsaved work, however the user leaves: Back, the header, or the map's
 * close. Returns the call that lets a finished save go without asking.
 */
function useConfirmLeave(dirty: boolean, what: string) {
  const navigation = useNavigation();
  const allowed = useRef(false);
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (e) => {
        if (!dirty || allowed.current) return;
        e.preventDefault();
        Alert.alert(`Discard this ${what}?`, "What you've added so far will be lost.", [
          { text: "Keep editing", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
        ]);
      }),
    [navigation, dirty, what],
  );
  return () => {
    allowed.current = true;
  };
}

const SEARCH_SNAPS = [`${DETAILS_SNAP * 100}%`, "100%"];

/** One or more workings, each marked at the spot. */
function MarkWorkings({ mine }: { mine: Mine }) {
  const { fix, state } = useLiveFix();
  const signedIn = useSignedIn();
  const [phase, setPhase] = useState<Phase>("mark");
  const [center, setCenter] = useState<LatLon | null>(null);
  const [marked, setMarked] = useState<{ pin: LatLon; at: LiveFix } | null>(null);
  const [saved, setSaved] = useState<{ pin: LatLon; label: Label }[]>([]);
  // Bumped by "Mark another" to give the details sheet a clean slate.
  const [round, setRound] = useState(0);
  const visitId = useMemo(() => randomUUID(), []);
  const marks = useMemo(() => saved.map((s) => s.pin), [saved]);

  // Once there's something to lose, leaving asks first. Photos and typing live
  // only in this screen until Save.
  const done = () => finish(saved.length === 1 ? "Point" : `${saved.length} points`, signedIn);
  const leave = useCallback(() => {
    if (phase === "saved") return done();
    if (!marked) return saved.length ? done() : router.back();
    Alert.alert("Discard this point?", "The pin and anything you've added to it will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  }, [marked, phase, saved.length, signedIn]);

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
        published={mine.published}
        marks={marks}
        onCenter={setCenter}
        onClose={leave}
      />
      <MarkSheet
        open={phase === "mark"}
        fix={fix}
        gps={state}
        center={center}
        published={mine.published}
        onMark={(pin, at) => {
          setMarked({ pin, at });
          setPhase("details");
        }}
        onCancel={leave}
        cancelLabel={saved.length ? "Done" : "Cancel"}
      />
      {marked && (
        <DetailsSheet
          key={round}
          open={phase === "details"}
          mine={mine}
          visitId={visitId}
          pin={marked.pin}
          markedAt={marked.at}
          fix={fix}
          gps={state}
          onAdjust={() => setPhase("mark")}
          onSaved={(label) => {
            setSaved((s) => [...s, { pin: marked.pin, label }]);
            setPhase("saved");
          }}
        />
      )}
      <SavedSheet
        open={phase === "saved"}
        summary={saved.map((s) => LABEL_TEXT[s.label]).join(", ")}
        anotherLabel="Mark another point"
        onDone={done}
        onAnother={another}
      />
    </View>
  );
}

/** "I went to the published spot and found nothing." */
function SearchReport({ mine }: { mine: Mine }) {
  const { fix, state } = useLiveFix();
  const signedIn = useSignedIn();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [radius, setRadius] = useState<number>(150);
  const [photos, setPhotos] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [safetyAck, setSafetyAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [footerH, setFooterH] = useState(0);
  const allowLeave = useConfirmLeave(!!text.trim() || photos.length > 0, "search report");

  const d = fix ? distanceMeters(fix.lat, fix.lon, mine.published.lat, mine.published.lon) : null;
  const inside = d !== null && d <= radius;
  const locked = state === "locked";
  const missing = !locked
    ? `Needs a GPS lock. ${describeGps(state, fix?.accuracy).label}.`
    : !inside
      ? `You're ${formatDistance(d!)} from the published spot. Stand inside your ${radius} m search area.`
      : !safetyAck
        ? "Confirm you stayed outside the workings."
        : null;

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setError("MinFinder needs the camera to photograph the site. Allow it in Settings.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7, exif: false });
    if (!r.canceled && r.assets[0]) setPhotos((p) => [...p, r.assets[0].uri]);
  };

  const save = async () => {
    if (missing || !fix) return;
    setSaving(true);
    setError(null);
    try {
      await queueSubmission(
        {
          kind: "not_found",
          minfilno: mine.minfilno,
          search_radius_m: radius,
          user_lat: fix.lat,
          user_lon: fix.lon,
          accuracy_m: fix.accuracy,
          mocked: false,
          captured_at: fix.time,
          text: text.trim() || undefined,
          safety_ack: true,
        },
        photos,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      allowLeave();
      finish("Search report", signedIn);
    } catch (e) {
      console.warn("queueSubmission failed", e);
      setError("Couldn't save on this phone. Free up some storage and try again.");
      setSaving(false);
    }
  };

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props}>
        <View
          onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
          style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}
        >
          <Text
            style={[type.meta, { color: error ? colors.destructive : colors.mutedForeground, textAlign: "center" }]}
            accessibilityLiveRegion="polite"
          >
            {error ?? missing ?? "Saved on this phone, uploaded when you have signal."}
          </Text>
          <View style={styles.pair}>
            <PillButton label="Save report" onPress={save} disabled={!!missing} busy={saving} />
          </View>
        </View>
      </BottomSheetFooter>
    ),
    [colors, insets.bottom, error, missing, saving, save],
  );

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <CaptureMap
        phase="details"
        fix={fix}
        gps={state}
        pin={null}
        published={mine.published}
        searchRadiusM={radius}
        onCenter={() => {}}
        onClose={() => router.back()}
      />
      {/* Scrolls, and keeps Save above the keyboard: on a small phone at large text the form
          is taller than the half of the screen the map leaves it. */}
      <Sheet
        index={0}
        snapPoints={SEARCH_SNAPS}
        enableDynamicSizing={false}
        enablePanDownToClose={false}
        topInset={insets.top}
        keyboardBehavior="extend"
        android_keyboardInputMode="adjustResize"
        footerComponent={renderFooter}
      >
        <BottomSheetScrollView contentContainerStyle={[styles.sheet, { paddingBottom: footerH + 16 }]}>
          <View style={{ gap: 2 }}>
            <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
              How far did you search?
            </Text>
            <Text style={[type.meta, { color: colors.mutedForeground }]}>
              {d === null
                ? "Finding your position…"
                : `You're ${formatDistance(d)} from where MINFILE puts ${mine.name}${fix ? ` (GPS ±${Math.round(fix.accuracy)} m)` : ""}.`}
            </Text>
          </View>
          <Segmented
            options={SEARCH_RADII.map((r) => ({ value: String(r), label: `${r} m` }))}
            value={String(radius)}
            onChange={(v) => setRadius(Number(v))}
          />
          <PhotoPicker
            photos={photos}
            canShoot={locked && inside}
            onShoot={takePhoto}
            onRemove={(i) => setPhotos((p) => p.filter((_, j) => j !== i))}
            why="Photos are taken inside the search area."
            hint="Optional. What the ground looks like where the mine should be."
          />
          <View style={{ gap: 8 }}>
            <Text style={[type.label, { color: colors.foreground }]}>
              Note <Text style={[type.meta, { color: colors.mutedForeground }]}>· optional</Text>
            </Text>
            <BottomSheetTextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.card }]}
              value={text}
              onChangeText={setText}
              maxLength={MAX_TEXT}
              multiline
              placeholder="What you saw, where you looked…"
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel="Note, optional"
            />
          </View>
          <SafetyAck checked={safetyAck} onToggle={() => setSafetyAck((a) => !a)} />
        </BottomSheetScrollView>
      </Sheet>
    </View>
  );
}

/** A note from anywhere: road conditions, access, history. */
function NoteForm({ mine }: { mine: Mine }) {
  const colors = useColors();
  const signedIn = useSignedIn();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowLeave = useConfirmLeave(!!text.trim(), "comment");

  const save = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await queueSubmission({ kind: "note", minfilno: mine.minfilno, text: text.trim() });
      allowLeave();
      finish("Comment", signedIn);
    } catch (e) {
      console.warn("queueSubmission failed", e);
      setError("Couldn't save on this phone. Free up some storage and try again.");
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* The swipe back can't be caught to ask first, so it's off while there's text to lose. */}
      <Stack.Screen options={{ headerShown: true, title: "Add a comment", gestureEnabled: !text.trim() }} />
      <ScrollView contentContainerStyle={[styles.noteBody, { paddingBottom: insets.bottom + 16 }]} keyboardShouldPersistTaps="handled">
        <Text style={[type.meta, { color: colors.mutedForeground }]}>
          About {mine.name} (MINFILE {mine.minfilno}). Access, road conditions, gates, history: anything that helps the next
          visitor. To correct the location, use "I found it" at the site.
        </Text>
        <TextInput
          style={[styles.input, styles.noteInput, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.card }]}
          value={text}
          onChangeText={setText}
          maxLength={MAX_TEXT}
          multiline
          autoFocus
          placeholder="Access, roads, gates, history…"
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel="Comment"
        />
        <Text style={[type.meta, { color: error ? colors.destructive : colors.mutedForeground }]}>
          {error ?? `${MAX_TEXT - text.length} characters left · uploads when you have signal`}
        </Text>
        <View style={styles.pair}>
          <PillButton label="Save comment" onPress={save} disabled={!text.trim()} busy={saving} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** The summary once something is saved: where it stands, and what's next. */
function SavedSheet({
  open,
  summary,
  anotherLabel,
  onDone,
  onAnother,
}: {
  open: boolean;
  summary: string;
  anotherLabel?: string;
  onDone: () => void;
  onAnother?: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const signedIn = useSignedIn();
  // Held through the close animation after "Mark another".
  const shown = useLast(open ? summary : null);
  if (!shown) return null;

  return (
    <Sheet open={open} enablePanDownToClose={false}>
      <BottomSheetView style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.head}>
          <View style={[styles.okDisc, { backgroundColor: colors.successSubtle }]}>
            <Feather name="check" size={18} color={colors.success} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
              Saved to this phone
            </Text>
            <Text style={[type.meta, { color: colors.mutedForeground }]}>{shown}</Text>
          </View>
        </View>
        <Pressable onPress={() => router.replace("/my-submissions")} accessibilityRole="link" style={styles.statusRow} hitSlop={8}>
          <StatusChip
            status={
              signedIn
                ? { icon: "clock", label: "Uploads when you have signal", tone: "wait" }
                : { icon: "user", label: "Sign in to upload", tone: "wait" }
            }
          />
          <Text style={[type.link, { color: colors.primary }]}>My reports</Text>
        </Pressable>
        <View style={styles.pair}>
          <PillButton label="Done" variant={onAnother ? "secondary" : "primary"} onPress={onDone} />
          {onAnother && anotherLabel && <PillButton label={anotherLabel} icon="plus" onPress={onAnother} />}
        </View>
      </BottomSheetView>
    </Sheet>
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
    alignItems: "center",
    justifyContent: "center",
  },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 32 },
  pair: { flexDirection: "row", gap: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 72,
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    textAlignVertical: "top",
  },
  noteBody: { padding: GUTTER, gap: 16 },
  footer: { paddingHorizontal: GUTTER, paddingTop: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  noteInput: { minHeight: 160 },
});
