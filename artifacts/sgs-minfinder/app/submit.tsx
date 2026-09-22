import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  type CircleLayerStyle,
} from "@maplibre/maplibre-react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { Feather } from "@/components/Icon";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useColors } from "@/hooks/useColors";
import { useSignedIn } from "@/lib/auth";
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

// These mirror LIMITS in artifacts/minfinder-api/src/rules.ts. The server is the
// authority; checking here only saves a capture the server would refuse.
const MAX_ACCURACY_M = 30;
const MAX_FIX_AGE_MS = 60_000;
const MAX_NUDGE_M = 48; // the server allows 50; a margin for rounding
const OWN_RADIUS_M = 100;
const DUPLICATE_RADIUS_M = 30;
const MINFILE_NEAR_M = 100;
const MAX_PHOTOS = 3;

interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
  time: number;
}

type LatLon = { lat: number; lon: number };

/** Keep the pin within MAX_NUDGE_M of where the user stood. */
function clampPin(pin: LatLon, at: LatLon): LatLon {
  const d = distanceMeters(at.lat, at.lon, pin.lat, pin.lon);
  if (d <= MAX_NUDGE_M) return pin;
  const f = MAX_NUDGE_M / d; // linear is exact enough over 50 m
  return { lat: at.lat + (pin.lat - at.lat) * f, lon: at.lon + (pin.lon - at.lon) * f };
}

const pinStyle = {
  circleColor: "#FCBA19",
  circleRadius: 9,
  circleStrokeColor: "#0E2444",
  circleStrokeWidth: 3,
} as unknown as CircleLayerStyle;
const youStyle = {
  circleColor: "#2F80ED",
  circleRadius: 6,
  circleStrokeColor: "#ffffff",
  circleStrokeWidth: 2,
} as unknown as CircleLayerStyle;

export default function SubmitScreen() {
  const colors = useColors();
  const signedIn = useSignedIn();

  // --- Live GPS ---------------------------------------------------------------
  const [live, setLive] = useState<Location.LocationObject | null>(null);
  const [locDenied, setLocDenied] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return setLocDenied(true);
      const s = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        (l) => setLive(l),
      );
      if (cancelled) s.remove();
      else sub = s;
    })();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      sub?.remove();
      clearInterval(tick);
    };
  }, []);

  const liveAge = live ? now - live.timestamp : Infinity;
  const mocked = live?.mocked === true;
  const gpsReady =
    !!live && !mocked && liveAge < MAX_FIX_AGE_MS && (live.coords.accuracy ?? Infinity) <= MAX_ACCURACY_M;

  // --- Photos, each paired with the fix at its shutter press -------------------
  const [photos, setPhotos] = useState<string[]>([]);
  // The most accurate fix of any shutter press: where the user proved they stood.
  const [fix, setFix] = useState<Fix | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const takePhoto = async () => {
    if (!live || !gpsReady) return;
    const at: Fix = {
      lat: live.coords.latitude,
      lon: live.coords.longitude,
      accuracy: live.coords.accuracy ?? MAX_ACCURACY_M,
      // The fix's own timestamp, not the phone clock, so a wrong clock can't
      // backdate a capture.
      time: live.timestamp,
    };
    setCameraError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setCameraError("Camera permission is needed to add a mine.");
    // Camera only, never the gallery: a photo taken here, now, is part of the proof.
    // ponytail: full-resolution JPEGs (~2–4 MB each) go up as-is and the server
    // shrinks them to 2048 px. Add expo-image-manipulator to resize on the device if
    // uploads over weak signal prove slow.
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7, exif: false });
    if (r.canceled || !r.assets[0]) return;
    setPhotos((p) => [...p, r.assets[0].uri].slice(0, MAX_PHOTOS));
    setFix((f) => (!f || at.accuracy < f.accuracy ? at : f));
  };

  // --- Pin ------------------------------------------------------------------------
  const [pinRaw, setPinRaw] = useState<LatLon | null>(null);
  const pin = fix ? clampPin(pinRaw ?? fix, fix) : null;
  const nudgeM = pin && fix ? Math.round(distanceMeters(fix.lat, fix.lon, pin.lat, pin.lon)) : 0;
  const pinShape = useMemo(
    () =>
      ({
        type: "FeatureCollection",
        features: pin
          ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [pin.lon, pin.lat] } }]
          : [],
      }) as GeoJSON.FeatureCollection,
    [pin?.lat, pin?.lon],
  );
  const youShape = useMemo(
    () =>
      ({
        type: "FeatureCollection",
        features: fix
          ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [fix.lon, fix.lat] } }]
          : [],
      }) as GeoJSON.FeatureCollection,
    [fix?.lat, fix?.lon],
  );

  // --- What's already here ---------------------------------------------------------
  const [nearby, setNearby] = useState<{ minfile: string | null; community: number; own: boolean }>({
    minfile: null,
    community: 0,
    own: false,
  });
  useEffect(() => {
    if (!pin) return;
    let cancelled = false;
    (async () => {
      const d = (lat: number, lon: number) => distanceMeters(pin.lat, pin.lon, lat, lon);
      const span = MINFILE_NEAR_M / 111_320;
      const occ = await queryOccurrences({
        bbox: {
          minLat: pin.lat - span,
          maxLat: pin.lat + span,
          minLon: pin.lon - span * 2,
          maxLon: pin.lon + span * 2,
        },
      }).catch(() => []);
      const near = occ
        .map((o) => ({ o, m: d(o.LATITUDE!, o.LONGITUDE!) }))
        .filter((x) => x.m <= MINFILE_NEAR_M)
        .sort((a, b) => a.m - b.m)[0];
      const community = (await communityMinesNear(pin.lat, pin.lon, DUPLICATE_RADIUS_M)).filter(
        (m) => d(m.lat, m.lon) <= DUPLICATE_RADIUS_M,
      ).length;
      const own = [
        ...(await getOutbox()).filter((o) => o.state === "queued").map((o) => o.data),
        ...(await getMySubmissions()),
      ].some((m) => d(m.lat, m.lon) <= OWN_RADIUS_M);
      if (!cancelled) {
        setNearby({
          minfile: near ? `${near.o.NAME1?.trim() || "Unnamed"} (MINFILE ${near.o.MINFILNO?.trim()}, ${Math.round(near.m)} m away)` : null,
          community,
          own,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pin?.lat, pin?.lon]);

  // --- Form ---------------------------------------------------------------------------
  const [type, setType] = useState<MineType | null>(null);
  const [name, setName] = useState("");
  const [commodity, setCommodity] = useState("");
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [notes, setNotes] = useState("");
  const [safetyAck, setSafetyAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const missing = !photos.length
    ? "Take at least one photo"
    : !type
      ? "Choose what you found"
      : !safetyAck
        ? "Confirm you stayed outside the workings"
        : nearby.own
          ? "You've already added a mine within 100 m"
          : null;

  const save = async () => {
    if (missing || !fix || !pin || !type) return;
    setSaving(true);
    setSaveError(null);
    try {
      await queueSubmission(
        {
          lat: pin.lat,
          lon: pin.lon,
          user_lat: fix.lat,
          user_lon: fix.lon,
          accuracy_m: fix.accuracy,
          mocked: false,
          captured_at: fix.time,
          type,
          name: name.trim() || undefined,
          commodity: commodity.trim() || undefined,
          hazards,
          notes: notes.trim() || undefined,
          safety_ack: true,
        },
        photos,
      );
      router.replace("/my-submissions");
    } catch (e) {
      console.warn("queueSubmission failed", e);
      setSaveError("Couldn't save this capture on the device. Check free storage and try again.");
      setSaving(false);
    }
  };

  const chip = (active: boolean) => [
    styles.chip,
    {
      backgroundColor: active ? colors.primary : colors.card,
      borderColor: active ? colors.primary : colors.border,
    },
  ];
  const chipText = (active: boolean) => [
    styles.chipText,
    { color: active ? colors.primaryForeground : colors.foreground },
  ];
  const input = [styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }];

  return (
    <KeyboardAwareScrollViewCompat
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.scroll}
    >
      {!signedIn && (
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          You can capture without signing in. It uploads once you sign in on the My submissions screen.
        </Text>
      )}

      {/* GPS lock */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.foreground }]}>1. GPS lock</Text>
        {locDenied ? (
          <Text style={[styles.body, { color: colors.destructive }]}>
            Location permission is needed. A submission has to be made from the site.
          </Text>
        ) : mocked ? (
          <Text style={[styles.body, { color: colors.destructive }]}>
            A mock-location app is active. Turn it off to add a mine.
          </Text>
        ) : !live ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.gold} />
            <Text style={[styles.body, { color: colors.mutedForeground }]}>Getting a fix…</Text>
          </View>
        ) : (
          <>
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: gpsReady ? "#2E9E5B" : colors.gold }]} />
              <Text style={[styles.body, { color: colors.foreground }]}>
                ±{Math.round(live.coords.accuracy ?? 0)} m
                {liveAge >= MAX_FIX_AGE_MS ? " (stale)" : ""}
              </Text>
            </View>
            {!gpsReady && (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                Needs ±{MAX_ACCURACY_M} m or better. Stand in the open, away from the portal and tall trees.
              </Text>
            )}
          </>
        )}
      </View>

      {/* Photos */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.foreground }]}>2. Photos ({photos.length}/{MAX_PHOTOS})</Text>
        <View style={styles.photoRow}>
          {photos.map((uri, i) => (
            <Pressable
              key={uri}
              onPress={() => setPhotos((p) => p.filter((_, j) => j !== i))}
              accessibilityLabel={`Remove photo ${i + 1}`}
            >
              <Image source={{ uri }} style={styles.photo} />
              <View style={styles.photoX}>
                <Feather name="x" size={12} color="#fff" />
              </View>
            </Pressable>
          ))}
          {photos.length < MAX_PHOTOS && (
            <Pressable
              onPress={takePhoto}
              disabled={!gpsReady}
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              style={[styles.photo, styles.shutter, { borderColor: colors.border, opacity: gpsReady ? 1 : 0.4 }]}
            >
              <Feather name="camera" size={24} color={colors.foreground} />
            </Pressable>
          )}
        </View>
        {cameraError && <Text style={[styles.note, { color: colors.destructive }]}>{cameraError}</Text>}
      </View>

      {/* Pin */}
      {fix && pin && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.foreground }]}>3. Pin</Text>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Tap the map to move the pin onto the working, up to 50 m from where you stood (blue).
            {nudgeM > 0 ? ` Moved ${nudgeM} m.` : ""}
          </Text>
          <View style={styles.mapBox}>
            <MapLibreMap
              style={StyleSheet.absoluteFill}
              mapStyle={BASEMAP_STYLE_JSON}
              attribution={false}
              touchRotate={false}
              touchPitch={false}
              onPress={(e) => {
                const [lon, lat] = e.nativeEvent.lngLat as [number, number];
                setPinRaw({ lat, lon });
              }}
            >
              <Camera initialViewState={{ center: [fix.lon, fix.lat], zoom: 17 }} />
              <GeoJSONSource id="you" data={youShape}>
                <Layer id="you" type="circle" style={youStyle} />
              </GeoJSONSource>
              <GeoJSONSource id="pin" data={pinShape}>
                <Layer id="pin" type="circle" style={pinStyle} />
              </GeoJSONSource>
            </MapLibreMap>
          </View>
          {nearby.minfile && (
            <Text style={[styles.note, { color: colors.foreground }]}>
              Near {nearby.minfile}. Only add this if it's a different working.
            </Text>
          )}
          {nearby.community > 0 && (
            <Text style={[styles.note, { color: colors.foreground }]}>
              Another member has already added a mine within {DUPLICATE_RADIUS_M} m. The server will
              refuse a duplicate.
            </Text>
          )}
          {nearby.own && (
            <Text style={[styles.note, { color: colors.destructive }]}>
              You've already added a mine within {OWN_RADIUS_M} m of here.
            </Text>
          )}
        </View>
      )}

      {/* Details */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.foreground }]}>4. What did you find?</Text>
        <View style={styles.chips}>
          {MINE_TYPES.map(([key, label]) => (
            <Pressable key={key} onPress={() => setType(key)} style={chip(type === key)} accessibilityState={{ selected: type === key }}>
              <Text style={chipText(type === key)}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput style={input} placeholder="Name (optional)" placeholderTextColor={colors.mutedForeground} value={name} onChangeText={setName} maxLength={80} />
        <TextInput style={input} placeholder="Commodity (optional), e.g. Au, Cu" placeholderTextColor={colors.mutedForeground} value={commodity} onChangeText={setCommodity} maxLength={40} />
        <Text style={[styles.body, { color: colors.foreground }]}>Hazards</Text>
        <View style={styles.chips}>
          {HAZARDS.map(([key, label]) => {
            const on = hazards.includes(key);
            return (
              <Pressable
                key={key}
                onPress={() => setHazards((h) => (on ? h.filter((x) => x !== key) : [...h, key]))}
                style={chip(on)}
                accessibilityState={{ selected: on }}
              >
                <Text style={chipText(on)}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          style={[input, { minHeight: 80, textAlignVertical: "top" }]}
          placeholder="Notes (optional)"
          placeholderTextColor={colors.mutedForeground}
          value={notes}
          onChangeText={setNotes}
          maxLength={500}
          multiline
        />
      </View>

      <View style={[styles.card, styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Switch value={safetyAck} onValueChange={setSafetyAck} />
        <Text style={[styles.body, { color: colors.foreground, flex: 1 }]}>
          I did not enter the workings. Old mines can collapse and hold bad air.
        </Text>
      </View>

      <Pressable
        onPress={save}
        disabled={!!missing || saving}
        accessibilityRole="button"
        style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: missing || saving ? 0.5 : 1 }]}
      >
        {saving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Feather name="check" size={18} color={colors.primaryForeground} />
        )}
        <Text style={[styles.saveText, { color: colors.primaryForeground }]}>{missing ?? "Save"}</Text>
      </Pressable>
      {saveError && <Text style={[styles.note, { color: colors.destructive }]}>{saveError}</Text>}
      <Text style={[styles.note, { color: colors.mutedForeground }]}>
        Saved captures upload when you have signal. New members' first three submissions are reviewed
        by SGS before they appear on the map.
      </Text>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12, paddingBottom: 48 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 10 },
  label: { fontFamily: "Inter_700Bold", fontSize: 15 },
  body: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  note: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  photoRow: { flexDirection: "row", gap: 10 },
  photo: { width: 88, height: 88, borderRadius: 10 },
  photoX: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 10,
    padding: 3,
  },
  shutter: { borderWidth: 2, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  mapBox: { height: 220, borderRadius: 10, overflow: "hidden" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  chipText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  saveText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
