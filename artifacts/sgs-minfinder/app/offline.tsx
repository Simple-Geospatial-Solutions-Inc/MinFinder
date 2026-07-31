import { Feather } from "@/components/Icon";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Camera,
  Map as MapLibreMap,
  OfflineManager,
  type CameraRef,
  type OfflinePack,
} from "@maplibre/maplibre-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { ESRI_STYLE_JSON, ESRI_STYLE_URL } from "@/lib/mapStyle";
import {
  deltaToZoom,
  regionToBounds,
  type Bounds,
  type Region,
} from "@/lib/mapGeo";
import { countTilesInRegion } from "@/lib/tileCache";

const BC_REGION: Region = {
  latitude: 54.5,
  longitude: -125.5,
  latitudeDelta: 12,
  longitudeDelta: 14,
};

const MIN_ZOOM_DEFAULT = 8;
const MAX_ZOOM_DEFAULT = 13;
const TILE_LIMIT = 4000;

// Bumped when a pack's contents stop being comparable to older ones. Packs
// written before v2 were created by passing inline style JSON to createPack,
// which MapLibre silently rejected in favour of its own demo style — they hold
// no Esri tiles at all, so they are deleted on sight rather than shown.
const PACK_STYLE_VERSION = 2;

// Metadata we stash on each MapLibre offline pack so the list can show a name,
// zoom range, and tile estimate (MapLibre packs only carry bounds natively).
interface PackMeta {
  name?: string;
  minZoom?: number;
  maxZoom?: number;
  estTiles?: number;
  createdAt?: number;
  styleVersion?: number;
}

// mbgl parses the offline style with no error handling whatsoever, so any
// response that isn't valid style JSON — a Pages outage, a captive portal, a
// hijacked DNS answer — terminates the process instead of failing the download.
// Checking here turns that class of fatal crash into an alert.
async function styleUrlIsUsable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const body: unknown = JSON.parse(await res.text());
    if (typeof body !== "object" || body === null) return false;
    const style = body as { version?: unknown; sources?: unknown };
    return (
      typeof style.version === "number" &&
      typeof style.sources === "object" &&
      style.sources !== null
    );
  } catch {
    return false;
  }
}

export default function OfflineScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [packs, setPacks] = useState<OfflinePack[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  // Current picker viewport [west, south, east, north]; updated as the map moves.
  const [viewBounds, setViewBounds] = useState<Bounds>(regionToBounds(BC_REGION));
  const cameraRef = useRef<CameraRef | null>(null);
  const activePack = useRef<OfflinePack | null>(null);

  const [downloading, setDownloading] = useState<{
    percentage: number;
    tiles: number;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const all = await OfflineManager.getPacks();
      const usable: OfflinePack[] = [];
      for (const p of all) {
        const meta = (p.metadata ?? {}) as PackMeta;
        if (meta.styleVersion === PACK_STYLE_VERSION) {
          usable.push(p);
          continue;
        }
        // Pre-fix pack: empty of Esri tiles, and listing it would wrongly tell
        // the user this area works offline. Keep it visible if we can't remove
        // it, so at least the manual delete button stays available.
        try {
          await OfflineManager.deletePack(p.id);
        } catch (err) {
          console.warn("stale pack cleanup error", err);
          usable.push(p);
        }
      }
      setPacks(usable);
    } catch (err) {
      console.warn("getPacks error", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Progress events keep arriving from native after this screen goes away; the
  // library only unsubscribes on its own once a pack reports "complete".
  useEffect(() => {
    return () => {
      const pack = activePack.current;
      if (pack) OfflineManager.removeListener(pack.id);
    };
  }, []);

  // Center the picker on the user when the modal opens.
  useEffect(() => {
    if (!showAdd) return;
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return;
      try {
        const loc = await Location.getCurrentPositionAsync({});
        cameraRef.current?.flyTo({
          center: [loc.coords.longitude, loc.coords.latitude],
          zoom: deltaToZoom(0.6),
          duration: 500,
        });
      } catch {}
    })();
  }, [showAdd]);

  const [west, south, east, north] = viewBounds;
  const tileCount = useMemo(
    () =>
      countTilesInRegion(
        south,
        north,
        west,
        east,
        MIN_ZOOM_DEFAULT,
        MAX_ZOOM_DEFAULT,
      ),
    [west, south, east, north],
  );

  const startDownload = useCallback(async () => {
    if (tileCount > TILE_LIMIT) {
      Alert.alert(
        "Region too large",
        `Selected area requires ${tileCount.toLocaleString()} tiles. Zoom in further (limit ${TILE_LIMIT.toLocaleString()}).`,
      );
      return;
    }
    if (Platform.OS === "web") {
      Alert.alert("Not supported", "Offline map download requires the mobile app.");
      return;
    }
    setDownloading({ percentage: 0, tiles: 0 });
    if (!(await styleUrlIsUsable(ESRI_STYLE_URL))) {
      setDownloading(null);
      Alert.alert(
        "Download unavailable",
        "Couldn't reach the map style needed to download this region. Check your connection and try again.",
      );
      return;
    }
    try {
      const pack = await OfflineManager.createPack(
        {
          // Must be a URL, not ESRI_STYLE_JSON — see ESRI_STYLE_URL in lib/mapStyle.ts.
          mapStyle: ESRI_STYLE_URL,
          bounds: viewBounds,
          minZoom: MIN_ZOOM_DEFAULT,
          maxZoom: MAX_ZOOM_DEFAULT,
          metadata: {
            name: `Region ${new Date().toLocaleString()}`,
            minZoom: MIN_ZOOM_DEFAULT,
            maxZoom: MAX_ZOOM_DEFAULT,
            estTiles: tileCount,
            createdAt: Date.now(),
            styleVersion: PACK_STYLE_VERSION,
          },
        },
        (_pack, status) => {
          setDownloading({
            percentage: status.percentage,
            tiles: status.completedTileCount,
          });
          if (status.state === "complete") {
            activePack.current = null;
            setDownloading(null);
            refresh();
            setShowAdd(false);
          }
        },
        (pack, error) => {
          console.warn("offline pack error", error);
          // Use the pack handed to the callback: activePack may not be assigned
          // yet if this fires before createPack's promise resolves.
          OfflineManager.removeListener(pack.id);
          Alert.alert("Download failed", error.message);
          activePack.current = null;
          setDownloading(null);
        },
      );
      activePack.current = pack;
    } catch (err) {
      console.warn("createPack error", err);
      Alert.alert("Download failed", String(err));
      setDownloading(null);
    }
  }, [viewBounds, tileCount, refresh]);

  const cancelDownload = useCallback(async () => {
    const pack = activePack.current;
    activePack.current = null;
    setDownloading(null);
    if (pack) {
      OfflineManager.removeListener(pack.id);
      try {
        await OfflineManager.deletePack(pack.id);
      } catch (err) {
        console.warn("cancel/delete pack error", err);
      }
    }
  }, []);

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <View
          style={[
            styles.headerCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="download-cloud" size={20} color={colors.navy} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>
              Offline map regions
            </Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              Pre-download map tiles to use the app without a data connection.
              MINFILE data is always available offline.
            </Text>
          </View>
        </View>

        <Pressable
          onPress={() => setShowAdd(true)}
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Feather name="plus" size={18} color={colors.primaryForeground} />
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
            Download a new region
          </Text>
        </Pressable>

        {packs.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Feather name="map" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No offline regions yet
            </Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Tap "Download a new region" to cache the map of an area for offline use.
            </Text>
          </View>
        ) : (
          packs.map((p) => {
            const meta = (p.metadata ?? {}) as PackMeta;
            const [w, s, e, n] = p.bounds;
            return (
              <View
                key={p.id}
                style={[
                  styles.regionCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.regionTitle, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {meta.name ?? "Offline region"}
                  </Text>
                  <Text
                    style={[styles.regionMeta, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {(meta.estTiles ?? 0).toLocaleString()} tiles · zoom{" "}
                    {meta.minZoom ?? MIN_ZOOM_DEFAULT}–{meta.maxZoom ?? MAX_ZOOM_DEFAULT}
                  </Text>
                  <Text
                    style={[styles.regionMeta, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {s.toFixed(2)}° to {n.toFixed(2)}° N, {w.toFixed(2)}° to{" "}
                    {e.toFixed(2)}° W
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    Alert.alert("Remove region?", "This deletes the cached map tiles for this area.", [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: async () => {
                          try {
                            await OfflineManager.deletePack(p.id);
                          } catch (err) {
                            console.warn("deletePack error", err);
                          }
                          refresh();
                        },
                      },
                    ]);
                  }}
                  hitSlop={10}
                >
                  <Feather name="trash-2" size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>
            );
          })
        )}

        {packs.length > 0 && (
          <Pressable
            onPress={() => {
              Alert.alert(
                "Clear all offline maps?",
                "This removes every downloaded map region. MINFILE data is unaffected.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear",
                    style: "destructive",
                    onPress: async () => {
                      try {
                        await OfflineManager.resetDatabase();
                      } catch (err) {
                        console.warn("resetDatabase error", err);
                      }
                      refresh();
                    },
                  },
                ],
              );
            }}
            style={({ pressed }) => [
              styles.dangerBtn,
              {
                borderColor: colors.destructive,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.dangerBtnText, { color: colors.destructive }]}>
              Clear all offline maps
            </Text>
          </Pressable>
        )}

        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          Offline maps are stored on this device by MapLibre.
        </Text>
        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          Tiles © Esri, USGS, NOAA and the GIS User Community.
        </Text>
      </ScrollView>

      <Modal visible={showAdd} animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={[styles.modalRoot, { backgroundColor: colors.background }]}>
          <View
            style={[
              styles.modalHeader,
              {
                paddingTop: insets.top + 8,
                backgroundColor: colors.navyDeep,
              },
            ]}
          >
            <Pressable onPress={() => setShowAdd(false)} hitSlop={8} disabled={!!downloading}>
              <Feather name="x" size={22} color="#F4F1EA" />
            </Pressable>
            <Text style={styles.modalTitle}>Select a region</Text>
            <View style={{ width: 22 }} />
          </View>

          <View style={styles.mapWrap}>
            <MapLibreMap
              style={StyleSheet.absoluteFill}
              mapStyle={ESRI_STYLE_JSON}
              attribution={false}
              touchRotate={false}
              touchPitch={false}
              onRegionDidChange={(e) => setViewBounds(e.nativeEvent.bounds)}
            >
              <Camera
                ref={cameraRef}
                initialViewState={{ bounds: regionToBounds(BC_REGION) }}
              />
            </MapLibreMap>
            <View pointerEvents="none" style={styles.selectionFrame} />
          </View>

          <View
            style={[
              styles.modalFooter,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
                paddingBottom: insets.bottom + 12,
              },
            ]}
          >
            <View style={styles.tileInfoRow}>
              <View>
                <Text style={[styles.modalInfoLabel, { color: colors.mutedForeground }]}>
                  Estimated tiles
                </Text>
                <Text
                  style={[
                    styles.modalInfoValue,
                    {
                      color:
                        tileCount > TILE_LIMIT
                          ? colors.destructive
                          : colors.foreground,
                    },
                  ]}
                >
                  {tileCount.toLocaleString()}
                </Text>
              </View>
              <View>
                <Text style={[styles.modalInfoLabel, { color: colors.mutedForeground }]}>
                  Zoom levels
                </Text>
                <Text style={[styles.modalInfoValue, { color: colors.foreground }]}>
                  {MIN_ZOOM_DEFAULT}–{MAX_ZOOM_DEFAULT}
                </Text>
              </View>
            </View>

            {downloading ? (
              <View style={styles.progressWrap}>
                <View
                  style={[
                    styles.progressBar,
                    { backgroundColor: colors.muted },
                  ]}
                >
                  <View
                    style={{
                      height: "100%",
                      width: `${Math.min(100, downloading.percentage)}%`,
                      backgroundColor: colors.primary,
                    }}
                  />
                </View>
                <Text style={[styles.progressText, { color: colors.foreground }]}>
                  {Math.round(downloading.percentage)}% ·{" "}
                  {downloading.tiles.toLocaleString()} tiles
                </Text>
                <Pressable
                  onPress={cancelDownload}
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={startDownload}
                disabled={tileCount > TILE_LIMIT}
                style={({ pressed }) => [
                  styles.downloadBtn,
                  {
                    backgroundColor:
                      tileCount > TILE_LIMIT ? colors.muted : colors.primary,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Feather
                  name="download"
                  size={18}
                  color={
                    tileCount > TILE_LIMIT
                      ? colors.mutedForeground
                      : colors.primaryForeground
                  }
                />
                <Text
                  style={[
                    styles.downloadBtnText,
                    {
                      color:
                        tileCount > TILE_LIMIT
                          ? colors.mutedForeground
                          : colors.primaryForeground,
                    },
                  ]}
                >
                  {tileCount > TILE_LIMIT
                    ? `Too large (max ${TILE_LIMIT.toLocaleString()})`
                    : "Download this region"}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    padding: 16,
    gap: 12,
  },
  headerCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  headerTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  headerSub: { marginTop: 2, fontSize: 12, fontFamily: "Inter_400Regular" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  primaryBtnText: { fontFamily: "Inter_700Bold", fontSize: 15 },
  emptyWrap: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 8,
  },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  emptySub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 24,
  },
  regionCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  regionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  regionMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  dangerBtn: {
    marginTop: 4,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  dangerBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  footer: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    marginTop: 8,
    textAlign: "center",
  },
  modalRoot: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  modalTitle: { color: "#F4F1EA", fontFamily: "Inter_700Bold", fontSize: 16 },
  mapWrap: { flex: 1 },
  selectionFrame: {
    position: "absolute",
    top: 24,
    bottom: 24,
    left: 24,
    right: 24,
    borderColor: "#FCBA19",
    borderWidth: 3,
    borderRadius: 12,
  },
  modalFooter: {
    borderTopWidth: 1,
    padding: 16,
    gap: 12,
  },
  tileInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  modalInfoLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  modalInfoValue: { fontSize: 18, fontFamily: "Inter_700Bold", marginTop: 2 },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  downloadBtnText: { fontFamily: "Inter_700Bold", fontSize: 15 },
  progressWrap: { gap: 8 },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  cancelBtn: {
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
});
