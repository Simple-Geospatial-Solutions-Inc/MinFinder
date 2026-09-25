import type BottomSheet from "@gorhom/bottom-sheet";
import {
  BottomSheetFooter,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetFooterProps,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DETAILS_SNAP, type LatLon } from "@/components/capture/CaptureMap";
import { describeGps, type GpsState, type LiveFix } from "@/components/capture/gps";
import { LABEL_HINTS, MineGlyph } from "@/components/capture/MineGlyph";
import { Chip, GUTTER, Notice, PillButton, Sheet, type } from "@/components/ui";
import { Feather } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { bearingDegrees, bearingToCompass, distanceMeters, formatDistance } from "@/lib/geo";
import {
  FAR_ACK_M,
  LABELS,
  MAX_FROM_PUBLISHED_M,
  MAX_PHOTOS,
  MAX_TEXT,
  ON_SITE_M,
  queueSubmission,
  type Label,
} from "@/lib/sync";

const SNAPS = [`${DETAILS_SNAP * 100}%`, "100%"];

/** The mine a field report is about. */
export interface Mine {
  minfilno: string;
  name: string;
  published: LatLon;
}

/**
 * Step 2 of marking a working: what it is, photos, a line about it, then Save
 * pinned to the bottom. Stays mounted while the user goes back to adjust the
 * pin, so nothing is lost.
 */
export function DetailsSheet({
  open,
  mine,
  visitId,
  pin,
  markedAt,
  fix,
  gps,
  onAdjust,
  onSaved,
}: {
  open: boolean;
  mine: Mine;
  /** Shared by every point marked on this outing. */
  visitId: string;
  pin: LatLon;
  /** The fix when the user pressed Mark: the position the server checks the pin against. */
  markedAt: LiveFix;
  fix: LiveFix | null;
  gps: GpsState;
  onAdjust: () => void;
  onSaved: (label: Label) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const ref = useRef<BottomSheet>(null);

  const [photos, setPhotos] = useState<string[]>([]);
  const [label, setLabel] = useState<Label | null>(null);
  const [text, setText] = useState("");
  const [safetyAck, setSafetyAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [footerH, setFooterH] = useState(160);

  useEffect(() => {
    if (open) ref.current?.snapToIndex(0);
    else ref.current?.close();
  }, [open]);

  const nudgeM = Math.round(distanceMeters(markedAt.lat, markedAt.lon, pin.lat, pin.lon));
  const fromPin = fix ? distanceMeters(fix.lat, fix.lon, pin.lat, pin.lon) : Infinity;
  const canShoot = gps === "locked" && fromPin <= ON_SITE_M;
  const fromPublished = distanceMeters(pin.lat, pin.lon, mine.published.lat, mine.published.lon);
  // Which way the published spot lies from here, e.g. "1.2km SE".
  const toPublished = `${formatDistance(fromPublished)} ${bearingToCompass(
    bearingDegrees(pin.lat, pin.lon, mine.published.lat, mine.published.lon),
  )}`;

  const takePhoto = async () => {
    if (!canShoot) return;
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError("MinFinder needs the camera to photograph the site. Allow it in Settings.");
      return;
    }
    // Camera only, never the gallery: a photo taken here, now, is part of the proof.
    // ponytail: full-resolution JPEGs (~2–4 MB each) go up as-is and the server
    // shrinks them to 2048 px. Add expo-image-manipulator to resize on the device if
    // uploads over weak signal prove slow.
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7, exif: false });
    if (r.canceled || !r.assets[0]) return;
    setPhotos((p) => [...p, r.assets[0].uri].slice(0, MAX_PHOTOS));
  };

  const missing =
    fromPublished > MAX_FROM_PUBLISHED_M
      ? `This is ${formatDistance(fromPublished)} from where MINFILE puts ${mine.name}: probably a different mine.`
      : !label
        ? "Choose what you found."
        : !safetyAck
          ? "Confirm you stayed outside the workings."
          : null;

  const store = async (farAck: boolean) => {
    if (!label) return;
    setSaving(true);
    setError(null);
    try {
      await queueSubmission(
        {
          kind: "location",
          minfilno: mine.minfilno,
          visit_id: visitId,
          label,
          lat: pin.lat,
          lon: pin.lon,
          user_lat: markedAt.lat,
          user_lon: markedAt.lon,
          accuracy_m: markedAt.accuracy,
          mocked: false,
          captured_at: markedAt.time,
          far_ack: farAck,
          text: text.trim() || undefined,
          safety_ack: true,
        },
        photos,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSaved(label);
    } catch (e) {
      console.warn("queueSubmission failed", e);
      setError("Couldn't save on this phone. Free up some storage and try again.");
      setSaving(false);
    }
  };

  // Far from the published spot, the user says it's the same mine before it's saved.
  const save = () => {
    if (missing) return;
    if (fromPublished <= FAR_ACK_M) return void store(false);
    Alert.alert(
      `This is ${formatDistance(fromPublished)} from the published location`,
      `MINFILE puts ${mine.name} ${toPublished} of here. Are you sure this is the same mine and not a neighbouring working?`,
      [
        { text: "Go back", style: "cancel" },
        { text: `Yes, it's ${mine.name}`, onPress: () => void store(true) },
      ],
    );
  };

  const fg = { color: colors.foreground };
  const sub = { color: colors.mutedForeground };
  const input = [styles.input, styles.notes, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.card }];

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
            <PillButton label="Adjust pin" variant="secondary" onPress={onAdjust} />
            <PillButton label="Save point" onPress={save} disabled={!!missing} busy={saving} />
          </View>
        </View>
      </BottomSheetFooter>
    ),
    [colors, insets.bottom, error, missing, saving, onAdjust, save],
  );

  return (
    <Sheet
      ref={ref}
      // It mounts at the moment Mark is pressed, before the sheet has measured
      // itself, so a snapToIndex from the effect would be dropped. Start open.
      index={open ? 0 : -1}
      snapPoints={SNAPS}
      enableDynamicSizing={false}
      enablePanDownToClose={false}
      topInset={insets.top}
      keyboardBehavior="extend"
      android_keyboardInputMode="adjustResize"
      footerComponent={renderFooter}
    >
      <BottomSheetScrollView contentContainerStyle={[styles.scroll, { paddingBottom: footerH + 16 }]}>
        <View style={{ gap: 2 }}>
          <Text style={[type.title, fg]} accessibilityRole="header">
            What's here?
          </Text>
          <Text style={[type.meta, sub]}>
            {nudgeM > 0 ? `${nudgeM} m from where you stood` : "Where you stood"} · GPS ±{Math.round(markedAt.accuracy)} m
          </Text>
        </View>

        {fromPublished > FAR_ACK_M && (
          <Notice icon="info">
            MINFILE puts {mine.name} {toPublished} of this point. You'll be asked to confirm it's the same mine.
          </Notice>
        )}

        <View style={styles.section}>
          <Text style={[type.label, fg]} accessibilityRole="header">
            Working
          </Text>
          <View style={styles.wrap} accessibilityRole="radiogroup">
            {LABELS.map(([key, text]) => (
              <Chip
                key={key}
                label={text}
                role="radio"
                selected={label === key}
                accessibilityHint={LABEL_HINTS[key]}
                icon={(c) => <MineGlyph type={key} size={20} color={c} />}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setLabel(key);
                }}
              />
            ))}
          </View>
          <Text style={[type.meta, sub]} accessibilityLiveRegion="polite">
            {label ? LABEL_HINTS[label] : "Mark each working separately: an adit, then its dump, then the shaft."}
          </Text>
        </View>

        <PhotoPicker
          photos={photos}
          canShoot={canShoot}
          onShoot={takePhoto}
          onRemove={(i) => setPhotos((p) => p.filter((_, j) => j !== i))}
          why={gps !== "locked" ? `Photos need a GPS lock. ${describeGps(gps, fix?.accuracy).label}.` : `Photos have to be taken within ${ON_SITE_M} m of the pin.`}
          hint="Optional. The opening first, then its surroundings."
        />

        <View style={styles.section}>
          <Text style={[type.label, fg]}>
            Note <Text style={[type.meta, sub]}>· optional</Text>
          </Text>
          <BottomSheetTextInput
            style={input}
            value={text}
            onChangeText={setText}
            maxLength={MAX_TEXT}
            multiline
            placeholder="Depth, condition, what's around it…"
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel="Note, optional"
          />
        </View>
        {/* After the choices, not in the footer: the first thing on screen is what you found. */}
        <SafetyAck checked={safetyAck} onToggle={() => setSafetyAck((a) => !a)} />
        <Text style={[type.meta, sub]}>
          Other visitors confirm or dispute each point. SGS reviews a new member's first reports, and any point in a park,
          protected area or First Nations reserve, before anyone else sees them.
        </Text>
      </BottomSheetScrollView>
    </Sheet>
  );
}

/** "I stayed outside the workings", required before anything is saved from a site. */
export function SafetyAck({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }} style={styles.ackRow}>
      <View
        style={[
          styles.box,
          { borderColor: checked ? colors.primary : colors.mutedForeground, backgroundColor: checked ? colors.primary : "transparent" },
        ]}
      >
        {checked && <Feather name="check" size={14} color={colors.primaryForeground} />}
      </View>
      <Text style={[type.meta, { color: colors.foreground, flex: 1 }]}>
        I stayed outside the workings. Old mines collapse and can hold bad air.
      </Text>
    </Pressable>
  );
}

/** Up to three camera photos, taken on site only. */
export function PhotoPicker({
  photos,
  canShoot,
  onShoot,
  onRemove,
  why,
  hint,
}: {
  photos: string[];
  canShoot: boolean;
  onShoot: () => void;
  onRemove: (i: number) => void;
  /** Why the shutter is off, when it is. */
  why: string;
  hint: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[type.label, { color: colors.foreground }]} accessibilityRole="header">
        Photos
      </Text>
      <View style={styles.photoRow}>
        {photos.length < MAX_PHOTOS && (
          <Pressable
            onPress={onShoot}
            disabled={!canShoot}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            accessibilityState={{ disabled: !canShoot }}
            style={({ pressed }) => [
              styles.photo,
              styles.shutter,
              { borderColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent", opacity: canShoot ? 1 : 0.5 },
            ]}
          >
            <Feather name="camera" size={22} color={colors.foreground} />
          </Pressable>
        )}
        {photos.map((uri, i) => (
          <View key={uri}>
            <Image source={{ uri }} style={styles.photo} accessibilityLabel={`Photo ${i + 1}`} />
            <Pressable
              onPress={() => onRemove(i)}
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${i + 1}`}
              hitSlop={8}
              style={[styles.photoX, { backgroundColor: colors.scrim }]}
            >
              <Feather name="x" size={16} color="#FFFFFF" />
            </Pressable>
          </View>
        ))}
      </View>
      <Text style={[type.meta, { color: colors.mutedForeground }]}>{canShoot || photos.length >= MAX_PHOTOS ? hint : why}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: GUTTER, paddingTop: 4, gap: 24 },
  section: { gap: 10 },
  photoRow: { flexDirection: "row", gap: 8 },
  photo: { width: 72, height: 72, borderRadius: 8 },
  shutter: { borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  photoX: {
    position: "absolute",
    top: 4,
    right: 4,
    // 28 + 8 slop each side = 44 to the touch.
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontFamily: "Inter_400Regular",
    fontSize: 16,
  },
  notes: { minHeight: 96, textAlignVertical: "top" },
  footer: { paddingHorizontal: GUTTER, paddingTop: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  ackRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  pair: { flexDirection: "row", gap: 8 },
});
