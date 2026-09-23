import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  type CircleLayerStyle,
} from "@maplibre/maplibre-react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describeGps, type GpsState, type LiveFix } from "@/components/capture/gps";
import type { LatLon } from "@/components/capture/MarkStep";
import { MineGlyph, TYPE_HINTS } from "@/components/capture/MineGlyph";
import { Feather } from "@/components/Icon";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useColors } from "@/hooks/useColors";
import { queryOccurrences } from "@/lib/db";
import { distanceMeters } from "@/lib/geo";
import { BASEMAP_STYLE_JSON } from "@/lib/mapStyle";
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

const miniPin = {
  circleColor: "#FCBA19",
  circleRadius: 8,
  circleStrokeColor: "#0E2444",
  circleStrokeWidth: 3,
} as unknown as CircleLayerStyle;

interface Nearby {
  minfile: { name: string; no: string; m: number } | null;
  community: boolean;
  own: boolean;
}

/** Step 2: what's there. Everything a reviewer needs, nothing they don't. */
export function DetailsStep({
  pin,
  markedAt,
  fix,
  gps,
  onAdjust,
  onSaved,
}: {
  pin: LatLon;
  /** The fix when the user pressed Mark: the position the server checks the pin against. */
  markedAt: LiveFix;
  fix: LiveFix | null;
  gps: GpsState;
  onAdjust: () => void;
  onSaved: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [photos, setPhotos] = useState<string[]>([]);
  const [type, setType] = useState<MineType | null>(null);
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [name, setName] = useState("");
  const [commodity, setCommodity] = useState("");
  const [notes, setNotes] = useState("");
  const [safetyAck, setSafetyAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<Nearby>({ minfile: null, community: false, own: false });

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
      : !type
        ? "Choose what you found."
        : !safetyAck
          ? "Confirm you stayed outside the workings."
          : null;

  const save = async () => {
    if (missing || !type) return;
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
          type,
          name: name.trim() || undefined,
          commodity: commodity.trim() || undefined,
          hazards,
          notes: notes.trim() || undefined,
          safety_ack: true,
        },
        photos,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSaved();
    } catch (e) {
      console.warn("queueSubmission failed", e);
      setError("Couldn't save on this phone. Free up some storage and try again.");
      setSaving(false);
    }
  };

  const text = { color: colors.foreground };
  const sub = { color: colors.mutedForeground };
  const input = [styles.input, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.card }];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={styles.scroll}>
        {/* Where */}
        <Pressable onPress={onAdjust} accessibilityRole="button" accessibilityLabel="Adjust the pin on the map">
          <View style={[styles.mini, { borderColor: colors.border }]}>
            <MapLibreMap
              key={`${pin.lat},${pin.lon}`}
              style={StyleSheet.absoluteFill}
              mapStyle={BASEMAP_STYLE_JSON}
              attribution={false}
              dragPan={false}
              touchZoom={false}
              doubleTapZoom={false}
              touchRotate={false}
              touchPitch={false}
            >
              <Camera initialViewState={{ center: [pin.lon, pin.lat], zoom: 16.5 }} />
              <GeoJSONSource
                id="mini-pin"
                data={{
                  type: "FeatureCollection",
                  features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [pin.lon, pin.lat] } }],
                }}
              >
                <Layer id="mini-pin" type="circle" style={miniPin} />
              </GeoJSONSource>
            </MapLibreMap>
            {/* Taps belong to the row, not the map. */}
            <View style={StyleSheet.absoluteFill} />
          </View>
          <View style={styles.whereRow}>
            <Text style={[styles.body, text, { flex: 1 }]}>
              {nudgeM > 0 ? `${nudgeM} m from where you stood` : "At your position"} · GPS ±{Math.round(markedAt.accuracy)} m
            </Text>
            <Text style={[styles.link, { color: colors.primary }]}>Adjust pin</Text>
          </View>
        </Pressable>

        {(nearby.minfile || nearby.community || nearby.own) && (
          <View style={[styles.notice, { backgroundColor: colors.muted }]}>
            <Feather name={nearby.own ? "circle-x" : "info"} size={18} color={nearby.own ? colors.destructive : colors.foreground} />
            <Text style={[styles.body, { flex: 1, color: nearby.own ? colors.destructive : colors.foreground }]}>
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
          <Text style={[styles.h2, text]} accessibilityRole="header">
            Photos
          </Text>
          <Text style={[styles.note, sub]}>
            At least one, up to three. Get the opening first, then its surroundings.
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
                  {
                    borderColor: canShoot ? colors.primary : colors.border,
                    backgroundColor: pressed ? colors.muted : colors.card,
                    opacity: canShoot ? 1 : 0.55,
                  },
                ]}
              >
                <Feather name="camera" size={26} color={colors.foreground} />
                <Text style={[styles.tileLabel, text]}>Take photo</Text>
              </Pressable>
            )}
            {photos.map((uri, i) => (
              <View key={uri}>
                <Image source={{ uri }} style={styles.photo} accessibilityLabel={`Photo ${i + 1}`} />
                <Pressable
                  onPress={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${i + 1}`}
                  hitSlop={8}
                  style={styles.photoX}
                >
                  <Feather name="x" size={16} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
          </View>
          {!canShoot && photos.length < MAX_PHOTOS && (
            <Text style={[styles.note, sub]}>
              {gps !== "locked"
                ? `Photos need a GPS lock. ${describeGps(gps, fix?.accuracy).label}.`
                : "Photos have to be taken within 100 m of the pin."}
            </Text>
          )}
        </View>

        {/* Type */}
        <View style={styles.section}>
          <Text style={[styles.h2, text]} accessibilityRole="header">
            What is it?
          </Text>
          <View style={styles.grid} accessibilityRole="radiogroup">
            {MINE_TYPES.map(([key, label]) => {
              const on = type === key;
              const fg = on ? colors.primaryForeground : colors.foreground;
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setType(key);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={label}
                  accessibilityHint={TYPE_HINTS[key]}
                  style={({ pressed }) => [
                    styles.tile,
                    {
                      backgroundColor: on ? colors.primary : pressed ? colors.muted : colors.card,
                      borderColor: on ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <MineGlyph type={key} size={30} color={fg} />
                  <Text style={[styles.tileLabel, { color: fg }]} numberOfLines={2}>
                    {label}
                  </Text>
                  {on && (
                    <View style={[styles.tick, { backgroundColor: colors.gold }]}>
                      <Feather name="check" size={12} color={colors.navyDeep} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.body, type ? text : sub]} accessibilityLiveRegion="polite">
            {type ? TYPE_HINTS[type] : "Tap the closest match. Not sure? Pick Other."}
          </Text>
        </View>

        {/* Hazards */}
        <View style={styles.section}>
          <Text style={[styles.h2, text]} accessibilityRole="header">
            Hazards
          </Text>
          <Text style={[styles.note, sub]}>Warn the next person. Select all that apply.</Text>
          <View style={styles.chips}>
            {HAZARDS.map(([key, label]) => {
              const on = hazards.includes(key);
              return (
                <Pressable
                  key={key}
                  onPress={() => setHazards((h) => (on ? h.filter((x) => x !== key) : [...h, key]))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: on ? colors.foreground : pressed ? colors.muted : colors.card,
                      borderColor: on ? colors.foreground : colors.border,
                    },
                  ]}
                >
                  <Feather name={on ? "alert-triangle" : "plus"} size={16} color={on ? colors.background : colors.foreground} />
                  <Text style={[styles.chipText, { color: on ? colors.background : colors.foreground }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Optional details */}
        <View style={styles.section}>
          <Pressable
            onPress={() => setMoreOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: moreOpen }}
            style={[styles.disclosure, { borderColor: colors.border }]}
          >
            <Text style={[styles.body, text, { flex: 1 }]}>Name, commodity and notes</Text>
            <Text style={[styles.note, sub]}>Optional</Text>
            <Feather name={moreOpen ? "chevron-down" : "chevron-right"} size={20} color={colors.mutedForeground} />
          </Pressable>
          {moreOpen && (
            <View style={styles.fields}>
              <Field label="Name" hint="A name on a sign, map or claim post.">
                <TextInput style={input} value={name} onChangeText={setName} maxLength={80} accessibilityLabel="Name" />
              </Field>
              <Field label="Commodity" hint="What was mined, if you know. For example Au, Cu, coal.">
                <TextInput style={input} value={commodity} onChangeText={setCommodity} maxLength={40} accessibilityLabel="Commodity" />
              </Field>
              <Field label="Notes" hint={`${500 - notes.length} characters left`}>
                <TextInput
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
      </KeyboardAwareScrollViewCompat>

      {/* Sticky footer: the safety line and the one action */}
      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          onPress={() => setSafetyAck((a) => !a)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: safetyAck }}
          style={styles.ackRow}
        >
          <View
            style={[
              styles.box,
              { borderColor: safetyAck ? colors.primary : colors.foreground, backgroundColor: safetyAck ? colors.primary : "transparent" },
            ]}
          >
            {safetyAck && <Feather name="check" size={18} color={colors.primaryForeground} />}
          </View>
          <Text style={[styles.body, text, { flex: 1 }]}>
            I stayed outside the workings. Old mines collapse and can hold bad air.
          </Text>
        </Pressable>
        {(missing || error) && (
          <Text style={[styles.note, { color: error || nearby.own ? colors.destructive : colors.mutedForeground }]} accessibilityLiveRegion="polite">
            {error ?? missing}
          </Text>
        )}
        <Pressable
          onPress={save}
          disabled={!!missing || saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!missing || saving, busy: saving }}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: missing ? colors.muted : colors.gold, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.navyDeep} />
          ) : (
            <Feather name="check" size={20} color={missing ? colors.mutedForeground : colors.navyDeep} />
          )}
          <View>
            <Text style={[styles.saveText, { color: missing ? colors.mutedForeground : colors.navyDeep }]}>Save mine</Text>
            <Text style={[styles.saveSub, { color: missing ? colors.mutedForeground : colors.navyDeep }]}>
              Uploads when you have signal
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      {children}
      <Text style={[styles.note, { color: colors.mutedForeground }]}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 32, gap: 28 },
  section: { gap: 10 },
  h2: { fontFamily: "Inter_700Bold", fontSize: 18 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  body: { fontFamily: "Inter_500Medium", fontSize: 15, lineHeight: 21 },
  note: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  link: { fontFamily: "Inter_600SemiBold", fontSize: 15, paddingVertical: 12 },
  mini: { height: 132, borderRadius: 14, overflow: "hidden", borderWidth: 1 },
  whereRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  notice: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 12, marginTop: -12 },
  photoRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  photo: { width: 100, height: 100, borderRadius: 12 },
  shutter: { borderWidth: 2, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 6 },
  photoX: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    // Four across on a phone; wraps to three when large text makes labels wide.
    flexGrow: 1,
    flexBasis: "22%",
    minWidth: 76,
    minHeight: 92,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  tileLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13, textAlign: "center" },
  tick: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1.5,
  },
  chipText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  disclosure: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 56,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fields: { gap: 16 },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    fontFamily: "Inter_500Medium",
    fontSize: 16,
  },
  notes: { minHeight: 110, textAlignVertical: "top" },
  footer: { paddingHorizontal: 16, paddingTop: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  ackRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56 },
  box: { width: 28, height: 28, borderRadius: 7, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  saveBtn: {
    minHeight: 60,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  saveText: { fontFamily: "Inter_700Bold", fontSize: 17 },
  saveSub: { fontFamily: "Inter_500Medium", fontSize: 12 },
});
