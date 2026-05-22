import { Feather } from "@/components/Icon";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import MapView, { PROVIDER_DEFAULT, Region, UrlTile } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import {
  countTilesInRegion,
  deleteRegion,
  downloadRegion,
  listRegions,
  type OfflineRegion,
  TILE_CACHE_DIR,
  TILE_TEMPLATE_REMOTE,
  clearAllTiles,
} from "@/lib/tileCache";

const BC_REGION: Region = {
  latitude: 54.5,
  longitude: -125.5,
  latitudeDelta: 12,
  longitudeDelta: 14,
};

const MIN_ZOOM_DEFAULT = 8;
const MAX_ZOOM_DEFAULT = 13;
const TILE_LIMIT = 4000;

export default function OfflineScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [regions, setRegions] = useState<OfflineRegion[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [region, setRegion] = useState<Region>(BC_REGION);
  const mapRef = useRef<MapView | null>(null);

  const [downloading, setDownloading] = useState<{
    done: number;
    total: number;
    failed: number;
  } | null>(null);
  const cancelRef = useRef(false);

  const refresh = useCallback(async () => {
    const items = await listRegions();
    setRegions(items);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === "granted") {
        try {
          const loc = await Location.getCurrentPositionAsync({});
          mapRef.current?.animateToRegion(
            {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              latitudeDelta: 0.6,
              longitudeDelta: 0.6,
            },
            500,
          );
        } catch {}
      }
    })();
  }, [showAdd]);

  const bbox = {
    minLat: region.latitude - region.latitudeDelta / 2,
    maxLat: region.latitude + region.latitudeDelta / 2,
    minLon: region.longitude - region.longitudeDelta / 2,
    maxLon: region.longitude + region.longitudeDelta / 2,
  };
  const tileCount = countTilesInRegion(
    bbox.minLat,
    bbox.maxLat,
    bbox.minLon,
    bbox.maxLon,
    MIN_ZOOM_DEFAULT,
    MAX_ZOOM_DEFAULT,
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
      Alert.alert("Not supported", "Offline tile download requires the mobile app.");
      return;
    }
    cancelRef.current = false;
    setDownloading({ done: 0, total: tileCount, failed: 0 });
    try {
      await downloadRegion(
        {
          name: `Region ${new Date().toLocaleString()}`,
          minLat: bbox.minLat,
          maxLat: bbox.maxLat,
          minLon: bbox.minLon,
          maxLon: bbox.maxLon,
          minZoom: MIN_ZOOM_DEFAULT,
          maxZoom: MAX_ZOOM_DEFAULT,
        },
        (p) => setDownloading(p),
        () => cancelRef.current,
      );
      await refresh();
      setShowAdd(false);
    } catch (err) {
      console.warn("download error", err);
      Alert.alert("Download failed", String(err));
    } finally {
      setDownloading(null);
    }
  }, [bbox, tileCount, refresh]);

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

        {regions.length === 0 ? (
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
          regions.map((r) => (
            <View
              key={r.id}
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
                  {r.name}
                </Text>
                <Text
                  style={[styles.regionMeta, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {r.tileCount.toLocaleString()} tiles · zoom {r.minZoom}–{r.maxZoom}
                </Text>
                <Text
                  style={[styles.regionMeta, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {r.minLat.toFixed(2)}° to {r.maxLat.toFixed(2)}° N, {r.minLon.toFixed(2)}° to {r.maxLon.toFixed(2)}° W
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  Alert.alert("Remove region?", "Tile cache is shared between regions; tiles remain cached.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Remove",
                      style: "destructive",
                      onPress: async () => {
                        await deleteRegion(r.id);
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
          ))
        )}

        {regions.length > 0 && (
          <Pressable
            onPress={() => {
              Alert.alert(
                "Clear all cached tiles?",
                "This removes every downloaded map tile. MINFILE data is unaffected.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear",
                    style: "destructive",
                    onPress: async () => {
                      await clearAllTiles();
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
              Clear all cached tiles
            </Text>
          </Pressable>
        )}

        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          Cache dir: {TILE_CACHE_DIR}
        </Text>
        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          Tiles © OpenStreetMap contributors.
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
            <MapView
              ref={mapRef}
              provider={PROVIDER_DEFAULT}
              style={StyleSheet.absoluteFill}
              initialRegion={region}
              onRegionChangeComplete={setRegion}
              mapType="none"
            >
              <UrlTile
                urlTemplate={TILE_TEMPLATE_REMOTE}
                tileCachePath={Platform.OS === "web" ? undefined : TILE_CACHE_DIR}
                tileCacheMaxAge={60 * 60 * 24 * 365}
                maximumZ={19}
                zIndex={-1}
              />
            </MapView>
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
                      width: `${downloading.total ? Math.min(100, (downloading.done / downloading.total) * 100) : 0}%`,
                      backgroundColor: colors.primary,
                    }}
                  />
                </View>
                <Text style={[styles.progressText, { color: colors.foreground }]}>
                  {downloading.done.toLocaleString()} / {downloading.total.toLocaleString()} tiles
                  {downloading.failed ? ` · ${downloading.failed} failed` : ""}
                </Text>
                <Pressable
                  onPress={() => {
                    cancelRef.current = true;
                  }}
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
