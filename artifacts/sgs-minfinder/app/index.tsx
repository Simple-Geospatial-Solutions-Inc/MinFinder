import { Feather } from "@expo/vector-icons";
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
import MapView, { Marker, PROVIDER_DEFAULT, Region, UrlTile } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailsSheet } from "@/components/DetailsSheet";
import { MarkerPin } from "@/components/MarkerPin";
import { STATUS_MAP, STATUS_ORDER, getStatusInfo } from "@/constants/status";
import { useColors } from "@/hooks/useColors";
import { countAll, queryOccurrences, type Occurrence } from "@/lib/db";
import { TILE_CACHE_DIR, TILE_TEMPLATE_REMOTE } from "@/lib/tileCache";

const BC_REGION: Region = {
  latitude: 54.5,
  longitude: -125.5,
  latitudeDelta: 12,
  longitudeDelta: 14,
};

// Choose how many markers to show based on latitudeDelta (rough zoom proxy).
function markerLimitForZoom(latDelta: number): number {
  if (latDelta > 8) return 250;
  if (latDelta > 4) return 600;
  if (latDelta > 2) return 1200;
  if (latDelta > 1) return 2000;
  if (latDelta > 0.4) return 3000;
  return 5000;
}

export default function MapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const mapRef = useRef<MapView | null>(null);
  const [region, setRegion] = useState<Region>(BC_REGION);
  const [userLoc, setUserLoc] = useState<Location.LocationObject | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [loadingDb, setLoadingDb] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  const [statuses, setStatuses] = useState<string[]>([...STATUS_ORDER]);
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(false);

  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [searchResults, setSearchResults] = useState<Occurrence[] | null>(null);

  // Load DB count and request location on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const n = await countAll();
        if (!cancelled) {
          setTotalCount(n);
          setLoadingDb(false);
        }
      } catch (err) {
        console.warn("countAll error", err);
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
        const next: Region = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        };
        setRegion(next);
        mapRef.current?.animateToRegion(next, 600);
      } catch (err) {
        console.warn("location error", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Query occurrences whenever region/statuses change
  const lastQueryRef = useRef<number>(0);
  useEffect(() => {
    const id = ++lastQueryRef.current;
    const pad = 0.1;
    const bbox = {
      minLat: region.latitude - region.latitudeDelta / 2 - pad,
      maxLat: region.latitude + region.latitudeDelta / 2 + pad,
      minLon: region.longitude - region.longitudeDelta / 2 - pad,
      maxLon: region.longitude + region.longitudeDelta / 2 + pad,
    };
    const limit = markerLimitForZoom(region.latitudeDelta);
    (async () => {
      try {
        const rows = await queryOccurrences({
          bbox,
          statuses: statuses.length === STATUS_ORDER.length ? undefined : statuses,
          limit,
        });
        if (id === lastQueryRef.current) {
          setOccurrences(rows);
        }
      } catch (err) {
        console.warn("queryOccurrences error", err);
      }
    })();
  }, [region, statuses]);

  // Search across the whole dataset (debounced)
  useEffect(() => {
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const rows = await queryOccurrences({
          search,
          statuses: statuses.length === STATUS_ORDER.length ? undefined : statuses,
          limit: 50,
        });
        setSearchResults(rows);
      } catch (err) {
        console.warn("search error", err);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [search, statuses]);

  const recenter = useCallback(async () => {
    if (userLoc) {
      const next: Region = {
        latitude: userLoc.coords.latitude,
        longitude: userLoc.coords.longitude,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      };
      mapRef.current?.animateToRegion(next, 500);
    } else {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLoc(loc);
        setPermissionDenied(false);
        mapRef.current?.animateToRegion(
          {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: 0.5,
            longitudeDelta: 0.5,
          },
          500,
        );
      } else {
        setPermissionDenied(true);
      }
    }
  }, [userLoc]);

  const toggleStatus = useCallback((code: string) => {
    setStatuses((prev) =>
      prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code],
    );
  }, []);

  const tileCacheConfig = useMemo(
    () =>
      Platform.OS === "web"
        ? { urlTemplate: TILE_TEMPLATE_REMOTE }
        : {
            urlTemplate: TILE_TEMPLATE_REMOTE,
            tileCachePath: TILE_CACHE_DIR,
            tileCacheMaxAge: 60 * 60 * 24 * 365, // 1 year
          },
    [],
  );

  const onPickSearchResult = useCallback((row: Occurrence) => {
    Keyboard.dismiss();
    setSearch("");
    setSearchActive(false);
    setSearchResults(null);
    if (row.LATITUDE == null || row.LONGITUDE == null) return;
    const next: Region = {
      latitude: row.LATITUDE,
      longitude: row.LONGITUDE,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
    mapRef.current?.animateToRegion(next, 600);
    setTimeout(() => setSelected(row), 350);
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.navyDeep }]}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={BC_REGION}
        onRegionChangeComplete={setRegion}
        showsUserLocation={!permissionDenied}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        mapType="none"
      >
        <UrlTile
          {...tileCacheConfig}
          maximumZ={19}
          flipY={false}
          zIndex={-1}
        />

        {occurrences.map((o) =>
          o.LATITUDE != null && o.LONGITUDE != null ? (
            <Marker
              key={o.id}
              coordinate={{ latitude: o.LATITUDE, longitude: o.LONGITUDE }}
              onPress={() => setSelected(o)}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 1 }}
            >
              <MarkerPin code={o.STATUS_C} selected={selected?.id === o.id} />
            </Marker>
          ) : null,
        )}
      </MapView>

      {/* Top bar */}
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + 8,
            backgroundColor: "rgba(14,36,68,0.92)",
          },
        ]}
      >
        <View style={styles.titleRow}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandTitle}>SGS MinFinder</Text>
            <Text style={styles.brandSub}>
              {loadingDb
                ? "Loading…"
                : `${totalCount.toLocaleString()} BC MINFILE occurrences`}
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
          style={[
            styles.searchBar,
            { backgroundColor: "rgba(244,241,234,0.12)" },
          ]}
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

        {/* Status filter chips */}
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
                  style={[
                    styles.chipText,
                    { color: active ? "#fff" : "#F4F1EA" },
                  ]}
                >
                  {info.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Search results dropdown */}
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

      {/* FAB: recenter */}
      <View style={[styles.fabStack, { bottom: insets.bottom + 24 }]}>
        <Pressable
          onPress={recenter}
          style={({ pressed }) => [
            styles.fab,
            {
              backgroundColor: colors.gold,
              opacity: pressed ? 0.85 : 1,
            },
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

      <DetailsSheet occurrence={selected} onClose={() => setSelected(null)} />
    </View>
  );
}

function TopIcon({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.topIcon, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Feather name={icon} size={20} color="#F4F1EA" />
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
  topActions: {
    flexDirection: "row",
    gap: 6,
  },
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
  chipsRow: {
    flexDirection: "row",
    gap: 6,
    paddingRight: 8,
  },
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
  chipText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
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
  fabStack: {
    position: "absolute",
    right: 16,
    gap: 12,
  },
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(14,36,68,0.85)",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  dbOverlayText: {
    color: "#F4F1EA",
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
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
