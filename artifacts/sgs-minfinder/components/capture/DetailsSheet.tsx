import BottomSheet, {
  BottomSheetFooter,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetFooterProps,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DETAILS_SNAP, type LatLon } from "@/components/capture/CaptureMap";
import { describeGps, type GpsState, type LiveFix } from "@/components/capture/gps";
import { MineGlyph, TYPE_HINTS } from "@/components/capture/MineGlyph";
import { floating, GUTTER, PillButton, type } from "@/components/capture/ui";
import { Feather } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { queryOccurrences } from "@/lib/db";
import { distanceMeters } from "@/lib/geo";
import {
  communityMinesNear,
  getMySubmissions,
  getOutbox,
  HAZARDS,
  MINE_TYPES,
  queueSubmission,
  type Hazard,
  type MineType,
} from "@/lib/sync";

// Mirrors LIMITS in artifacts/minfinder-api/src/rules.ts.
const MAX_PHOTOS = 3;
const OWN_RADIUS_M = 100;
const DUPLICATE_RADIUS_M = 30;
const MINFILE_NEAR_M = 100;
// Photos have to be taken at the site, not after walking back to the truck.
const PHOTO_RADIUS_M = 100;
const SNAPS = [`${DETAILS_SNAP * 100}%`, "100%"];

interface Nearby {
  minfile: { name: string; no: string; m: number } | null;
  community: boolean;
  own: boolean;
}

export interface SavedMine {
  type: MineType;
  photos: number;
}

/**
 * Step 2's sheet: what's there. Required parts first (photo, type), then tags,
 * then the optional text, with Save pinned to the bottom. Stays mounted while
 * the user goes back to adjust the pin, so nothing is lost.
 */
export function DetailsSheet({
  open,
  pin,
  markedAt,
  fix,
  gps,
  onAdjust,
  onSaved,
}: {
  open: boolean;
  pin: LatLon;
  /** The fix when the user pressed Mark: the position the server checks the pin against. */
  markedAt: LiveFix;
  fix: LiveFix | null;
  gps: GpsState;
  onAdjust: () => void;
  onSaved: (m: SavedMine) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const ref = useRef<BottomSheet>(null);

  const [photos, setPhotos] = useState<string[]>([]);
  const [mineType, setMineType] = useState<MineType | null>(null);
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [name, setName] = useState("");
  const [commodity, setCommodity] = useState("");
  const [notes, setNotes] = useState("");
  const [safetyAck, setSafetyAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<Nearby>({ minfile: null, community: false, own: false });
  const [footerH, setFooterH] = useState(160);

  useEffect(() => {
    if (open) ref.current?.snapToIndex(0);
    else ref.current?.close();
  }, [open]);

  const nudgeM = Math.round(distanceMeters(markedAt.lat, markedAt.lon, pin.lat, pin.lon));
  const fromPin = fix ? distanceMeters(fix.lat, fix.lon, pin.lat, pin.lon) : Infinity;
  const canShoot = gps === "locked" && fromPin <= PHOTO_RADIUS_M;

  // What's already recorded here. MINFILE and other members' mines only warn;
  // the user's own mine within 100 m blocks, because the server will refuse it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = (lat: number, lon: number) => distanceMeters(pin.lat, pin.lon, lat, lon);
      const span = MINFILE_NEAR_M / 111_320;
      const occ = await queryOccurrences({
        bbox: { minLat: pin.lat - span, maxLat: pin.lat + span, minLon: pin.lon - span * 2, maxLon: pin.lon + span * 2 },
      }).catch(() => []);
      const near = occ
        .map((o) => ({ o, m: d(o.LATITUDE!, o.LONGITUDE!) }))
        .filter((x) => x.m <= MINFILE_NEAR_M)
        .sort((a, b) => a.m - b.m)[0];
      const community = (await communityMinesNear(pin.lat, pin.lon, DUPLICATE_RADIUS_M)).some(
        (m) => d(m.lat, m.lon) <= DUPLICATE_RADIUS_M,
      );
      const own = [
        ...(await getOutbox()).filter((o) => o.state === "queued").map((o) => o.data),
        ...(await getMySubmissions()),
      ].some((m) => d(m.lat, m.lon) <= OWN_RADIUS_M);
      if (cancelled) return;
      setNearby({
        minfile: near
          ? { name: near.o.NAME1?.trim() || "Unnamed", no: near.o.MINFILNO?.trim() ?? "", m: Math.round(near.m) }
          : null,
        community,
        own,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [pin.lat, pin.lon]);

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

  const missing = nearby.own
    ? "You've already added a mine within 100 m of here."
    : !photos.length
      ? "Take at least one photo."
      : !mineType
        ? "Choose what you found."
        : !safetyAck
          ? "Confirm you stayed outside the workings."
          : null;

  const save = async () => {
    if (missing || !mineType) return;
    setSaving(true);
    setError(null);
    try {
      await queueSubmission(
        {
          lat: pin.lat,
          lon: pin.lon,
          user_lat: markedAt.lat,
          user_lon: markedAt.lon,
          accuracy_m: markedAt.accuracy,
          mocked: false,
          captured_at: markedAt.time,
          type: mineType,
          name: name.trim() || undefined,
          commodity: commodity.trim() || undefined,
          hazards,
          notes: notes.trim() || undefined,
          safety_ack: true,
        },
        photos,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSaved({ type: mineType, photos: photos.length });
    } catch (e) {
      console.warn("queueSubmission failed", e);
      setError("Couldn't save on this phone. Free up some storage and try again.");
      setSaving(false);
    }
  };

  const fg = { color: colors.foreground };
  const sub = { color: colors.mutedForeground };
  const input = [styles.input, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.card }];

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props}>
        <View
          onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
          style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}
        >
          <Pressable
            onPress={() => setSafetyAck((a) => !a)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: safetyAck }}
            style={styles.ackRow}
          >
            <View
              style={[
                styles.box,
                { borderColor: safetyAck ? colors.primary : colors.mutedForeground, backgroundColor: safetyAck ? colors.primary : "transparent" },
              ]}
            >
              {safetyAck && <Feather name="check" size={14} color={colors.primaryForeground} />}
            </View>
            <Text style={[type.meta, fg, { flex: 1 }]}>
              I stayed outside the workings. Old mines collapse and can hold bad air.
            </Text>
          </Pressable>
          <Text
            style={[type.meta, { color: error || nearby.own ? colors.destructive : colors.mutedForeground, textAlign: "center" }]}
            accessibilityLiveRegion="polite"
          >
            {error ?? missing ?? "Saved on this phone, uploaded when you have signal."}
          </Text>
          <View style={styles.pair}>
            <PillButton label="Adjust pin" variant="secondary" onPress={onAdjust} />
            <PillButton label="Save mine" onPress={save} disabled={!!missing} busy={saving} />
          </View>
        </View>
      </BottomSheetFooter>
    ),
    [colors, insets.bottom, safetyAck, error, missing, nearby.own, saving, onAdjust, save],
  );

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={SNAPS}
      enableDynamicSizing={false}
      enablePanDownToClose={false}
      topInset={insets.top}
      keyboardBehavior="extend"
      android_keyboardInputMode="adjustResize"
      footerComponent={renderFooter}
      backgroundStyle={{ backgroundColor: colors.card, borderRadius: 16 }}
      handleIndicatorStyle={{ width: 32, height: 5, backgroundColor: colors.border }}
      style={floating}
    >
      <BottomSheetScrollView contentContainerStyle={[styles.scroll, { paddingBottom: footerH + 16 }]}>
        <View style={{ gap: 2 }}>
          <Text style={[type.title, fg]} accessibilityRole="header">
            What did you find?
          </Text>
          <Text style={[type.meta, sub]}>
            {nudgeM > 0 ? `${nudgeM} m from where you stood` : "Where you stood"} · GPS ±{Math.round(markedAt.accuracy)} m
          </Text>
        </View>

        {(nearby.minfile || nearby.community || nearby.own) && (
          <View style={[styles.notice, { backgroundColor: colors.muted }]}>
            <Feather name={nearby.own ? "circle-x" : "info"} size={16} color={nearby.own ? colors.destructive : colors.foreground} />
            <Text style={[type.meta, { flex: 1, color: nearby.own ? colors.destructive : colors.foreground }]}>
              {nearby.own
                ? "You've already added a mine within 100 m of here. Each member can add one per 100 m."
                : nearby.community
                  ? "Another member has already added a mine within 30 m. The server will refuse a duplicate."
                  : `${nearby.minfile!.name} (MINFILE ${nearby.minfile!.no}) is ${nearby.minfile!.m} m away. Only add this if it's a different working.`}
            </Text>
          </View>
        )}

        {/* Photos */}
        <View style={styles.section}>
          <Text style={[type.label, fg]} accessibilityRole="header">
            Photos
          </Text>
          <View style={styles.photoRow}>
            {photos.length < MAX_PHOTOS && (
              <Pressable
                onPress={takePhoto}
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
                  onPress={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${i + 1}`}
                  hitSlop={10}
                  style={styles.photoX}
                >
                  <Feather name="x" size={12} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
          </View>
          <Text style={[type.meta, sub]}>
            {canShoot || photos.length >= MAX_PHOTOS
              ? "1 to 3. The opening first, then its surroundings."
              : gps !== "locked"
                ? `Photos need a GPS lock. ${describeGps(gps, fix?.accuracy).label}.`
                : "Photos have to be taken within 100 m of the pin."}
          </Text>
        </View>

        {/* Type */}
        <View style={styles.section}>
          <Text style={[type.label, fg]} accessibilityRole="header">
            Type
          </Text>
          <View style={styles.wrap} accessibilityRole="radiogroup">
            {MINE_TYPES.map(([key, label]) => {
              const on = mineType === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setMineType(key);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={label}
                  accessibilityHint={TYPE_HINTS[key]}
                  style={({ pressed }) => [
                    styles.chip,
                    styles.typeChip,
                    {
                      borderColor: on ? colors.foreground : colors.border,
                      borderWidth: on ? 2 : 1,
                      backgroundColor: pressed ? colors.muted : "transparent",
                    },
                  ]}
                >
                  <MineGlyph type={key} size={20} color={colors.foreground} />
                  <Text style={[styles.chipText, fg]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[type.meta, sub]} accessibilityLiveRegion="polite">
            {mineType ? TYPE_HINTS[mineType] : "Pick the closest match. Not sure? Choose Other."}
          </Text>
        </View>

        {/* Hazards */}
        <View style={styles.section}>
          <Text style={[type.label, fg]} accessibilityRole="header">
            Hazards <Text style={[type.meta, sub]}>· all that apply</Text>
          </Text>
          <View style={styles.wrap}>
            {HAZARDS.map(([key, label]) => {
              const on = hazards.includes(key);
              return (
                <Pressable
                  key={key}
                  onPress={() => setHazards((h) => (on ? h.filter((x) => x !== key) : [...h, key]))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      borderColor: on ? colors.destructive : colors.border,
                      borderWidth: on ? 2 : 1,
                      backgroundColor: pressed ? colors.muted : "transparent",
                    },
                  ]}
                >
                  {on && <Feather name="alert-triangle" size={14} color={colors.destructive} />}
                  <Text style={[styles.chipText, { color: on ? colors.destructive : colors.foreground }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Optional details */}
        <View>
          <Pressable
            onPress={() => setMoreOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: moreOpen }}
            style={[styles.disclosure, { borderColor: colors.border }]}
          >
            <Text style={[type.label, fg, { flex: 1 }]}>
              Name, commodity, notes <Text style={[type.meta, sub]}>· optional</Text>
            </Text>
            <Feather name={moreOpen ? "chevron-down" : "chevron-right"} size={18} color={colors.mutedForeground} />
          </Pressable>
          {moreOpen && (
            <View style={styles.fields}>
              <Field label="Name" hint="A name on a sign, map or claim post.">
                <BottomSheetTextInput style={input} value={name} onChangeText={setName} maxLength={80} accessibilityLabel="Name" />
              </Field>
              <Field label="Commodity" hint="What was mined, if you know. For example Au, Cu, coal.">
                <BottomSheetTextInput style={input} value={commodity} onChangeText={setCommodity} maxLength={40} accessibilityLabel="Commodity" />
              </Field>
              <Field label="Notes" hint={`${500 - notes.length} characters left`}>
                <BottomSheetTextInput
                  style={[input, styles.notes]}
                  value={notes}
                  onChangeText={setNotes}
                  maxLength={500}
                  multiline
                  accessibilityLabel="Notes"
                />
              </Field>
            </View>
          )}
        </View>
        <Text style={[type.meta, sub]}>SGS reviews every mine. Photos of the opening help most.</Text>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.label, { color: colors.foreground, fontSize: 14 }]}>{label}</Text>
      {children}
      <Text style={[type.meta, { color: colors.mutedForeground, fontSize: 13 }]}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: GUTTER, paddingTop: 4, gap: 24 },
  section: { gap: 10 },
  notice: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 12 },
  photoRow: { flexDirection: "row", gap: 8 },
  photo: { width: 72, height: 72, borderRadius: 10 },
  shutter: { borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  photoX: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  typeChip: { minHeight: 44, gap: 8 },
  chipText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  disclosure: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fields: { gap: 16, paddingTop: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
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
