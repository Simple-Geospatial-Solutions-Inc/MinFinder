import { Feather, type FeatherIconName } from "@/components/Icon";
import { router } from "expo-router";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  UserLocation,
  type CameraRef,
  type CircleLayerStyle,
  type GeoJSONSourceRef,
  type SymbolLayerStyle,
} from "@maplibre/maplibre-react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailsSheet } from "@/components/DetailsSheet";
import { QuickInfoCard } from "@/components/QuickInfoCard";
import { STATUS_MAP, STATUS_ORDER, getStatusInfo } from "@/constants/status";
import { useColors } from "@/hooks/useColors";
import { queryOccurrences, type Occurrence } from "@/lib/db";
import { ESRI_STYLE_JSON, LABEL_FONT } from "@/lib/mapStyle";
import {
  deltaToZoom,
  occurrencesToFeatureCollection,
  regionToBounds,
  type Region,
} from "@/lib/mapGeo";

const BC_REGION: Region = {
  latitude: 54.5,
  longitude: -125.5,
  latitudeDelta: 12,
  longitudeDelta: 14,
};

// --- MapLibre layer styling. Markers are a data-driven clustered symbol layer
// (GPU-rendered from a GeoJSON source), not per-marker views — which is why the
// New-Arch marker drop/revert bugs of react-native-maps cannot occur here.
// Expressions are typed loosely (the style-spec union is deep); the layer
// `style` objects are cast to their MapLibre style types.

// Occurrence STATUS_C → dot color / 2-char code (mirrors constants/status.ts).
const STATUS_COLOR_EXPR: unknown = [
  "match",
  ["get", "STATUS_C"],
  "PROD", STATUS_MAP.PROD.color,
  "PAPR", STATUS_MAP.PAPR.color,
  "DEPR", STATUS_MAP.DEPR.color,
  "PROS", STATUS_MAP.PROS.color,
  "SHOW", STATUS_MAP.SHOW.color,
  "ANOM", STATUS_MAP.ANOM.color,
  "#5F6B7A",
];
const STATUS_CODE_EXPR: unknown = [
  "match",
  ["get", "STATUS_C"],
  "PROD", "PR", "PAPR", "PP", "DEPR", "DP",
  "PROS", "PS", "SHOW", "SH", "ANOM", "AN",
  "??",
];

const CLUSTER_FILTER = ["has", "point_count"] as unknown;
const POINT_FILTER = ["!", ["has", "point_count"]] as unknown;

const pointCircleStyle = {
  circleColor: STATUS_COLOR_EXPR,
  circleRadius: 8,
  circleStrokeColor: "#ffffff",
  circleStrokeWidth: 2,
} as unknown as CircleLayerStyle;

const pointTextStyle = {
  textField: STATUS_CODE_EXPR,
  textFont: LABEL_FONT,
  textSize: 10,
  textColor: "#ffffff",
  textAllowOverlap: true,
  textIgnorePlacement: true,
} as unknown as SymbolLayerStyle;

const clusterCircleStyle = {
  circleColor: "#16365C",
  circleOpacity: 0.95,
  circleStrokeColor: "#ffffff",
  circleStrokeWidth: 2,
  circleRadius: ["step", ["get", "point_count"], 16, 25, 20, 100, 26, 500, 32],
} as unknown as CircleLayerStyle;

const clusterTextStyle = {
  textField: ["get", "point_count_abbreviated"],
  textFont: LABEL_FONT,
  textSize: 12,
  textColor: "#ffffff",
  textAllowOverlap: true,
  textIgnorePlacement: true,
} as unknown as SymbolLayerStyle;

// A gold ring around the selected pin (transparent fill so it sits on top).
const selectedRingStyle = {
  circleColor: "rgba(0,0,0,0)",
  circleRadius: 11,
  circleStrokeColor: "#FCBA19",
  circleStrokeWidth: 4,
} as unknown as CircleLayerStyle;

export default function MapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const cameraRef = useRef<CameraRef | null>(null);
  const shapeRef = useRef<GeoJSONSourceRef | null>(null);
  const [userLoc, setUserLoc] = useState<Location.LocationObject | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [loadingDb, setLoadingDb] = useState(true);

  const [statuses, setStatuses] = useState<string[]>([...STATUS_ORDER]);
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(false);

  // All occurrences with coords, loaded once.
  const [allRows, setAllRows] = useState<Occurrence[]>([]);
  // Two-tier popup: tapping a marker shows `quickInfo` (small preview card).
  // The "+" expand button promotes that occurrence into `selected`, which
  // opens the full DetailsSheet. The expand action is intended to be
  // paywalled in a future release.
  const [quickInfo, setQuickInfo] = useState<Occurrence | null>(null);
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [searchResults, setSearchResults] = useState<Occurrence[] | null>(null);

  // Load full dataset once on mount + request location
  useEffect(() => {
    let cancelled = false;
    let watcher: Location.LocationSubscription | undefined;
    (async () => {
      try {
        const rows = await queryOccurrences({ limit: 100_000 });
        if (!cancelled) {
          setAllRows(rows);
          setLoadingDb(false);
        }
      } catch (err) {
        console.warn("load DB error", err);
        if (!cancelled) setLoadingDb(false);
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        if (!cancelled) setPermissionDenied(true);
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setUserLoc(loc);
        cameraRef.current?.flyTo({
          center: [loc.coords.longitude, loc.coords.latitude],
          zoom: deltaToZoom(0.5),
          duration: 600,
        });
      } catch (err) {
        console.warn("location error", err);
      }

      // Keep the blue dot moving as the user walks around.
      try {
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 5,
            timeInterval: 2000,
          },
          (loc) => {
            if (!cancelled) setUserLoc(loc);
          },
        );
        // If the component unmounted while watchPositionAsync was resolving,
        // remove the subscription immediately so it doesn't leak.
        if (cancelled) sub.remove();
        else watcher = sub;
      } catch (err) {
        console.warn("watchPosition error", err);
      }
    })();
    return () => {
      cancelled = true;
      watcher?.remove();
    };
  }, []);

  // In-memory filter by status. Search hits the DB (whole-dataset).
  const statusSet = useMemo(() => new Set(statuses), [statuses]);
  const allFilteredRows = useMemo(() => {
    if (statuses.length === STATUS_ORDER.length) return allRows;
    return allRows.filter((r) => statusSet.has(r.STATUS_C ?? ""));
  }, [allRows, statuses.length, statusSet]);

  // GeoJSON fed to the clustered MapLibre source. MapLibre clusters natively on
  // the GPU (no manual grid, no marker pool, no viewport cull) — the layer
  // re-renders from this data whenever the status filter changes.
  const featureCollection = useMemo(
    () => occurrencesToFeatureCollection(allFilteredRows),
    [allFilteredRows],
  );
  const occById = useMemo(() => {
    const m = new Map<number, Occurrence>();
    for (const r of allRows) m.set(r.id, r);
    return m;
  }, [allRows]);

  // The pin currently previewed (quickInfo) or opened (selected) gets a ring.
  const selectedId = quickInfo?.id ?? selected?.id ?? null;

  // Tap on the source: a cluster zooms to its expansion level; a point opens the
  // quick-info card.
  const onFeaturePress = useCallback(
    async (e: { nativeEvent?: { features?: GeoJSON.Feature[] } }) => {
      const f = e.nativeEvent?.features?.[0];
      if (!f || f.geometry?.type !== "Point") return;
      const props = (f.properties ?? {}) as {
        id?: number;
        cluster_id?: number;
        point_count?: number;
      };
      const [lng, lat] = f.geometry.coordinates as [number, number];
      if (props.point_count) {
        let zoom = deltaToZoom(0.5);
        try {
          if (props.cluster_id != null) {
            const z = await shapeRef.current?.getClusterExpansionZoom(
              props.cluster_id,
            );
            if (typeof z === "number") zoom = z + 0.25;
          }
        } catch {
          // fall back to a fixed zoom-in
        }
        cameraRef.current?.flyTo({ center: [lng, lat], zoom, duration: 400 });
      } else if (props.id != null) {
        const occ = occById.get(props.id);
        if (occ) setQuickInfo(occ);
      }
    },
    [occById],
  );

  // Search across the whole dataset (debounced, DB-backed for substring match).
  const searchSeq = useRef(0);
  useEffect(() => {
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }
    const seq = ++searchSeq.current;
    const handle = setTimeout(async () => {
      try {
        const rows = await queryOccurrences({
          search,
          statuses: statuses.length === STATUS_ORDER.length ? undefined : statuses,
          limit: 50,
        });
        if (seq === searchSeq.current) {
          setSearchResults(rows);
        }
      } catch (err) {
        console.warn("search error", err);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [search, statuses]);

  const flyToUser = useCallback((loc: Location.LocationObject) => {
    cameraRef.current?.flyTo({
      center: [loc.coords.longitude, loc.coords.latitude],
      zoom: deltaToZoom(0.5),
      duration: 500,
    });
  }, []);

  const recenter = useCallback(async () => {
    if (userLoc) {
      flyToUser(userLoc);
    } else {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLoc(loc);
        setPermissionDenied(false);
        flyToUser(loc);
      } else {
        setPermissionDenied(true);
      }
    }
  }, [userLoc, flyToUser]);

  const toggleStatus = useCallback((code: string) => {
    setStatuses((prev) =>
      prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code],
    );
  }, []);

  const onPickSearchResult = useCallback((row: Occurrence) => {
    Keyboard.dismiss();
    setSearch("");
    setSearchActive(false);
    setSearchResults(null);
    setQuickInfo(null); // search picks go straight to the full sheet
    if (row.LATITUDE == null || row.LONGITUDE == null) return;
    cameraRef.current?.flyTo({
      center: [row.LONGITUDE, row.LATITUDE],
      zoom: deltaToZoom(0.05),
      duration: 600,
    });
    setTimeout(() => setSelected(row), 350);
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.navyDeep }]}>
      <MapLibreMap
        style={StyleSheet.absoluteFill}
        mapStyle={ESRI_STYLE_JSON}
        attribution={false}
        touchRotate={false}
        touchPitch={false}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ bounds: regionToBounds(BC_REGION) }}
        />

        <GeoJSONSource
          id="occ"
          ref={shapeRef}
          data={featureCollection as unknown as GeoJSON.FeatureCollection}
          cluster
          clusterRadius={50}
          clusterMaxZoom={14}
          onPress={onFeaturePress}
        >
          <Layer
            id="clusters"
            type="circle"
            filter={CLUSTER_FILTER as never}
            style={clusterCircleStyle}
          />
          <Layer
            id="cluster-count"
            type="symbol"
            filter={CLUSTER_FILTER as never}
            style={clusterTextStyle}
          />
          <Layer
            id="points"
            type="circle"
            filter={POINT_FILTER as never}
            style={pointCircleStyle}
          />
          <Layer
            id="point-code"
            type="symbol"
            filter={POINT_FILTER as never}
            style={pointTextStyle}
          />
          <Layer
            id="point-selected"
            type="circle"
            filter={
              ["==", ["get", "id"], selectedId ?? -1] as never
            }
            style={selectedRingStyle}
          />
        </GeoJSONSource>

        {userLoc && <UserLocation animated heading />}
      </MapLibreMap>

      {/* Top bar */}
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top + 8, backgroundColor: "rgba(14,36,68,0.92)" },
        ]}
      >
        <View style={styles.titleRow}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandTitle}>SGS MinFinder</Text>
            <Text style={styles.brandSub}>
              {loadingDb
                ? "Loading…"
                : `${allFilteredRows.length.toLocaleString()} of ${allRows.length.toLocaleString()} BC MINFILE occurrences`}
            </Text>
          </View>
          <View style={styles.topActions}>
            <TopIcon
              icon="download-cloud"
              label="Offline"
              onPress={() => router.push("/offline")}
            />
            <TopIcon
              icon="info"
              label="About"
              onPress={() => router.push("/about")}
            />
          </View>
        </View>

        <View
          style={[styles.searchBar, { backgroundColor: "rgba(244,241,234,0.12)" }]}
        >
          <Feather name="search" size={16} color="#F4F1EA" />
          <TextInput
            placeholder="Search name or MINFILNO"
            placeholderTextColor="rgba(244,241,234,0.6)"
            value={search}
            onChangeText={(t) => {
              setSearch(t);
              setSearchActive(true);
            }}
            onFocus={() => setSearchActive(true)}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="characters"
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable
              onPress={() => {
                setSearch("");
                setSearchResults(null);
              }}
              hitSlop={10}
            >
              <Feather name="x" size={16} color="#F4F1EA" />
            </Pressable>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {STATUS_ORDER.map((code) => {
            const info = STATUS_MAP[code];
            const active = statuses.includes(code);
            return (
              <Pressable
                key={code}
                onPress={() => toggleStatus(code)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: active ? info.color : "rgba(244,241,234,0.10)",
                    borderColor: active ? info.color : "rgba(244,241,234,0.18)",
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.chipDot,
                    { backgroundColor: active ? "#fff" : info.color },
                  ]}
                />
                <Text
                  style={[styles.chipText, { color: active ? "#fff" : "#F4F1EA" }]}
                >
                  {info.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {searchActive && searchResults && searchResults.length > 0 && (
        <View
          style={[
            styles.searchResults,
            {
              top: insets.top + 132,
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            {searchResults.map((r) => {
              const info = getStatusInfo(r.STATUS_C);
              return (
                <Pressable
                  key={r.id}
                  onPress={() => onPickSearchResult(r)}
                  style={({ pressed }) => [
                    styles.searchResult,
                    {
                      borderBottomColor: colors.border,
                      backgroundColor: pressed ? colors.muted : "transparent",
                    },
                  ]}
                >
                  <View style={[styles.resultDot, { backgroundColor: info.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.resultTitle, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {r.NAME1 || "Unnamed"}
                    </Text>
                    <Text
                      style={[styles.resultSub, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {r.MINFILNO?.trim()} · {info.label}
                    </Text>
                  </View>
                  <Feather name="map-pin" size={14} color={colors.mutedForeground} />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View style={[styles.fabStack, { bottom: insets.bottom + 24 }]}>
        <Pressable
          onPress={recenter}
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: colors.gold, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Feather name="navigation" size={20} color={colors.navyDeep} />
        </Pressable>
      </View>

      {loadingDb && (
        <View style={styles.dbOverlay}>
          <ActivityIndicator size="large" color={colors.gold} />
          <Text style={styles.dbOverlayText}>Loading MINFILE database…</Text>
        </View>
      )}

      {permissionDenied && (
        <View style={[styles.permissionBanner, { bottom: insets.bottom + 88 }]}>
          <Feather name="alert-triangle" size={14} color="#FCBA19" />
          <Text style={styles.permissionText}>
            Location permission denied — map is centered on BC.
          </Text>
        </View>
      )}

      <QuickInfoCard
        occurrence={quickInfo}
        onClose={() => setQuickInfo(null)}
        onExpand={() => {
          if (quickInfo) setSelected(quickInfo);
          setQuickInfo(null);
        }}
        bottomOffset={insets.bottom + 96}
      />

      <DetailsSheet occurrence={selected} onClose={() => setSelected(null)} />
    </View>
  );
}

function TopIcon({
  icon,
  label,
  onPress,
  accent,
}: {
  icon: FeatherIconName;
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.topIcon,
        accent && { backgroundColor: "rgba(252,186,25,0.22)" },
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Feather name={icon} size={20} color={accent ? "#FCBA19" : "#F4F1EA"} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 10,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandBlock: { flex: 1, paddingRight: 8 },
  brandTitle: {
    color: "#FCBA19",
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    letterSpacing: 0.2,
  },
  brandSub: {
    color: "rgba(244,241,234,0.8)",
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    marginTop: 1,
  },
  topActions: { flexDirection: "row", gap: 6 },
  topIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,241,234,0.10)",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 6,
  },
  searchInput: {
    flex: 1,
    color: "#F4F1EA",
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    padding: 0,
  },
  chipsRow: { flexDirection: "row", gap: 6, paddingRight: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  searchResults: {
    position: "absolute",
    left: 16,
    right: 16,
    maxHeight: 320,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  searchResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultDot: { width: 10, height: 10, borderRadius: 5 },
  resultTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  resultSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  fabStack: { position: "absolute", right: 16, gap: 12 },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  dbOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(14,36,68,0.85)",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  dbOverlayText: { color: "#F4F1EA", fontFamily: "Inter_500Medium", fontSize: 14 },
  permissionBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(14,36,68,0.92)",
    borderColor: "rgba(252,186,25,0.4)",
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
  },
  permissionText: {
    flex: 1,
    color: "#F4F1EA",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
});
