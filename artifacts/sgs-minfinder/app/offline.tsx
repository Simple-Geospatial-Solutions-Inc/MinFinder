import { Feather } from "@/components/Icon";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  Map as MapLibreMap,
  OfflineManager,
  type CameraRef,
  type OfflinePack,
  type OfflinePackStatus,
} from "@maplibre/maplibre-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { countOccurrencesInBbox, queryOccurrences } from "@/lib/db";
import { formatBytes, formatShortDate } from "@/lib/format";
import { setPendingFocusRegion } from "@/lib/mapFocus";
import { ESRI_STYLE_JSON } from "@/lib/mapStyle";
import {
  boundsCenter,
  boundsToPlaceName,
  deltaToZoom,
  distanceToBoundsKm,
  formatSpanKm,
  regionToBounds,
  type Bounds,
  type Region,
} from "@/lib/mapGeo";
import { distanceMeters } from "@/lib/geo";
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
// Inset of the gold selection frame inside the picker map, in points. Shared by
// the frame's style and the bounds math so the two cannot drift apart.
const SELECTION_INSET = 24;
// Ground resolution of the deepest cached zoom level, at BC latitudes. Shown so
// users aren't surprised when the basemap blurs past this.
const MAX_DETAIL_M_PER_PX = 12;

// Metadata we stash on each MapLibre offline pack so the list can show a name,
// zoom range, and tile estimate (MapLibre packs only carry bounds natively).
interface PackMeta {
  name?: string;
  minZoom?: number;
  maxZoom?: number;
  estTiles?: number;
  createdAt?: number;
  /** Reverse-geocoded place name, resolved at download time while online. */
  place?: string;
}

function formatKm(km: number): string {
  return km < 10 ? km.toFixed(1) : String(Math.round(km));
}

/**
 * MapLibre reports "inactive" both for a paused download and, on some
 * platforms, for a fully-cached pack restored from disk — so treat 100% as
 * complete regardless of the reported state.
 */
function isPackComplete(st: OfflinePackStatus): boolean {
  return st.state === "complete" || st.percentage >= 100;
}

/**
 * Best available name for a region about to be downloaded, plus the place it
 * resolved to (stored in metadata so the list can say "Centred near Kamloops"
 * later, offline, without geocoding again).
 *
 * Creating a pack is the one moment the app is guaranteed to have a connection
 * (it is about to fetch thousands of tiles), so reverse geocoding is reliable
 * here and nowhere else. Falls back to the nearest MINFILE occurrence — a
 * showing name is often more meaningful to a prospector than a town — and
 * finally to plain coordinates.
 */
async function suggestRegionName(
  bounds: Bounds,
): Promise<{ name: string; place?: string }> {
  const [lon, lat] = boundsCenter(bounds);

  try {
    const [geo] = await Location.reverseGeocodeAsync({
      latitude: lat,
      longitude: lon,
    });
    const label = geo?.city || geo?.subregion;
    if (label) return { name: label, place: label };
  } catch {
    // Geocoder unavailable or offline — fall through.
  }

  try {
    const [w, s, e, n] = bounds;
    const rows = await queryOccurrences({
      bbox: { minLat: s, maxLat: n, minLon: w, maxLon: e },
      limit: 100,
    });
    let best: { name: string; d: number } | null = null;
    for (const r of rows) {
      if (r.LATITUDE == null || r.LONGITUDE == null || !r.NAME1) continue;
      const d = distanceMeters(lat, lon, r.LATITUDE, r.LONGITUDE);
      if (!best || d < best.d) best = { name: r.NAME1, d };
    }
    if (best) return { name: `${best.name} area` };
  } catch {
    // DB unavailable — fall through.
  }

  return { name: boundsToPlaceName(bounds) };
}

export default function OfflineScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [packs, setPacks] = useState<OfflinePack[]>([]);
  const [loading, setLoading] = useState(true);
  // Real on-disk size and download progress live behind an async native call,
  // so they're fetched per refresh into maps the rows can read synchronously.
  const [statuses, setStatuses] = useState<Record<string, OfflinePackStatus>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [userLoc, setUserLoc] = useState<Location.LocationObjectCoords | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  // Current picker viewport [west, south, east, north]; updated as the map moves.
  const [viewBounds, setViewBounds] = useState<Bounds>(regionToBounds(BC_REGION));
  const [mapSize, setMapSize] = useState<{ w: number; h: number } | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const cameraRef = useRef<CameraRef | null>(null);
  const activePack = useRef<OfflinePack | null>(null);

  const [downloading, setDownloading] = useState<{
    percentage: number;
    tiles: number;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await OfflineManager.getPacks();
      setPacks(list);

      const statusEntries = await Promise.all(
        list.map(async (p) => {
          try {
            return [p.id, await p.status()] as const;
          } catch (err) {
            console.warn("pack status error", err);
            return null;
          }
        }),
      );
      setStatuses(
        Object.fromEntries(
          statusEntries.filter(
            (e): e is readonly [string, OfflinePackStatus] => e != null,
          ),
        ),
      );

      const countEntries = await Promise.all(
        list.map(async (p) => {
          const [w, s, e, n] = p.bounds;
          try {
            const n_ = await countOccurrencesInBbox({
              minLat: s,
              maxLat: n,
              minLon: w,
              maxLon: e,
            });
            return [p.id, n_] as const;
          } catch (err) {
            console.warn("bbox count error", err);
            return null;
          }
        }),
      );
      setCounts(
        Object.fromEntries(
          countEntries.filter((e): e is readonly [string, number] => e != null),
        ),
      );
    } catch (err) {
      console.warn("getPacks error", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh on focus, not just mount: packs change when a download finishes or
  // a region is removed, and the user can come back here from the map.
  useFocusEffect(
    useCallback(() => {
      refresh();
      // Only read a position we already have permission for — this screen must
      // not be the thing that prompts for location.
      (async () => {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status !== "granted") return;
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setUserLoc(loc.coords);
        } catch {
          // No fix — the distance line is simply omitted.
        }
      })();
    }, [refresh]),
  );

  // Centre the picker on the user when the modal opens.
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

  /**
   * What actually gets downloaded. The gold frame is inset from the map edges,
   * but MapLibre reports the whole viewport — so the frame used to be decorative
   * and the app cached more ground than it showed. Scaling the viewport by the
   * frame's inset makes the box honest and makes the tile estimate match the
   * download. Latitude isn't linear in Mercator, so this is an approximation:
   * over a 24pt inset at zoom 8-13 the error is far below a single tile.
   */
  const selectionBounds = useMemo<Bounds>(() => {
    const [w, s, e, n] = viewBounds;
    if (!mapSize || mapSize.w <= 0 || mapSize.h <= 0) return viewBounds;
    const fx = (SELECTION_INSET / mapSize.w) * (e - w);
    const fy = (SELECTION_INSET / mapSize.h) * (n - s);
    return [w + fx, s + fy, e - fx, n - fy];
  }, [viewBounds, mapSize]);

  const [west, south, east, north] = selectionBounds;
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

  const tooLarge = tileCount > TILE_LIMIT;

  // Nudge when the selection crosses the cap — the button greying out is easy
  // to miss while panning.
  const wasTooLarge = useRef(false);
  useEffect(() => {
    if (showAdd && tooLarge && !wasTooLarge.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
        () => {},
      );
    }
    wasTooLarge.current = tooLarge;
  }, [tooLarge, showAdd]);

  // Keep the name field in step with the selection until the user types a name
  // of their own. Debounced so panning doesn't hammer the geocoder.
  const suggestedPlace = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!showAdd || nameEdited) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const { name, place } = await suggestRegionName(selectionBounds);
      if (cancelled) return;
      suggestedPlace.current = place;
      setNameInput(name);
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [showAdd, nameEdited, selectionBounds]);

  const openPicker = useCallback(() => {
    setNameInput("");
    setNameEdited(false);
    setShowAdd(true);
  }, []);

  const showOnMap = useCallback(
    (p: OfflinePack) => {
      const meta = (p.metadata ?? {}) as PackMeta;
      const st = statuses[p.id];
      Haptics.selectionAsync().catch(() => {});
      setPendingFocusRegion({
        id: p.id,
        name: meta.name?.trim() || "Offline region",
        bounds: p.bounds as Bounds,
        createdAt: meta.createdAt,
        incomplete: st ? !isPackComplete(st) : undefined,
      });
      // Pops back to the already-mounted map rather than pushing a second copy
      // of it, and falls back to replacing this screen if the map isn't in the
      // stack (e.g. arriving here from a deep link).
      router.dismissTo("/");
    },
    [statuses],
  );

  const startDownload = useCallback(async () => {
    if (tooLarge) {
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

    // Fall back to the suggestion if the user cleared the field, and de-duplicate
    // against the names already in the list.
    const typed = nameInput.trim();
    let place = suggestedPlace.current;
    let base = typed;
    if (!base) {
      const suggestion = await suggestRegionName(selectionBounds);
      base = suggestion.name;
      place = suggestion.place;
    }
    const existing = new Set(
      packs.map((p) => ((p.metadata ?? {}) as PackMeta).name?.trim()).filter(Boolean),
    );
    let name = base;
    for (let i = 2; existing.has(name); i++) name = `${base} (${i})`;

    setDownloading({ percentage: 0, tiles: 0 });
    try {
      const pack = await OfflineManager.createPack(
        {
          mapStyle: ESRI_STYLE_JSON,
          bounds: selectionBounds,
          minZoom: MIN_ZOOM_DEFAULT,
          maxZoom: MAX_ZOOM_DEFAULT,
          metadata: {
            name,
            minZoom: MIN_ZOOM_DEFAULT,
            maxZoom: MAX_ZOOM_DEFAULT,
            estTiles: tileCount,
            createdAt: Date.now(),
            place,
          } satisfies PackMeta,
        },
        (_pack, status) => {
          setDownloading({
            percentage: status.percentage,
            tiles: status.completedTileCount,
          });
          if (status.state === "complete") {
            activePack.current = null;
            setDownloading(null);
            // Downloads take minutes on rural LTE, by which point the phone is
            // usually in a pocket.
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            ).catch(() => {});
            refresh();
            setShowAdd(false);
          }
        },
        (_pack, error) => {
          console.warn("offline pack error", error);
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
  }, [selectionBounds, tileCount, tooLarge, nameInput, packs, refresh]);

  const cancelDownload = useCallback(async () => {
    const pack = activePack.current;
    activePack.current = null;
    setDownloading(null);
    if (pack) {
      try {
        await OfflineManager.deletePack(pack.id);
      } catch (err) {
        console.warn("cancel/delete pack error", err);
      }
    }
  }, []);

  const removePack = useCallback(
    (p: OfflinePack) => {
      Alert.alert(
        "Remove region?",
        "This deletes the cached map tiles for this area.",
        [
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
        ],
      );
    },
    [refresh],
  );

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
              Pre-download map tiles so the basemap works without a data
              connection. MINFILE occurrence data is always available offline.
              One region can cover up to about 165 km across.
            </Text>
          </View>
        </View>

        <Pressable
          onPress={openPicker}
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

        {loading ? (
          <View style={styles.emptyWrap}>
            <ActivityIndicator color={colors.navy} />
          </View>
        ) : packs.length === 0 ? (
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
            const bounds = p.bounds as Bounds;
            const st = statuses[p.id];
            const incomplete = st ? !isPackComplete(st) : false;
            const title = meta.name?.trim() || "Offline region";
            const saved = formatShortDate(meta.createdAt);
            const occCount = counts[p.id];

            // Line 2 is the sentence the user came for, so it always uses the
            // full-contrast foreground colour rather than the muted one.
            let answer: string;
            let answerColor = colors.foreground;
            if (incomplete && st) {
              if (st.state === "active") {
                answer = `Downloading ${Math.round(st.percentage)}% · ${st.completedTileCount.toLocaleString()} tiles so far`;
              } else {
                // A half-cached region is the failure that strands someone, so
                // it gets the warning colour rather than a muted note.
                answerColor = colors.destructive;
                answer = `Paused at ${Math.round(st.percentage)}% — may have blank areas`;
              }
            } else if (userLoc) {
              const near = distanceToBoundsKm(
                userLoc.latitude,
                userLoc.longitude,
                bounds,
              );
              answer = near.inside
                ? `You're inside · ${formatKm(near.km)} km to the edge ${near.octant}`
                : `${formatKm(near.km)} km away · ${near.octant}`;
            } else if (meta.place) {
              answer = `Centred near ${meta.place}`;
            } else {
              answer = `Centred at ${boundsToPlaceName(bounds)}`;
            }

            return (
              <Pressable
                key={p.id}
                onPress={() => showOnMap(p)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${title} on the map`}
                style={({ pressed }) => [
                  styles.regionCard,
                  {
                    backgroundColor: pressed ? colors.muted : colors.card,
                    borderColor: pressed ? colors.gold : colors.border,
                  },
                ]}
              >
                <Text
                  style={[styles.regionTitle, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {title}
                </Text>

                <Text style={[styles.regionAnswer, { color: answerColor }]}>
                  {answer}
                </Text>

                <Text style={[styles.regionMeta, { color: colors.mutedForeground }]}>
                  {formatSpanKm(bounds)}
                  {occCount != null
                    ? occCount === 0
                      ? " · no MINFILE occurrences inside"
                      : ` · ${occCount.toLocaleString()} MINFILE occurrences`
                    : ""}
                </Text>

                <Text style={[styles.regionMeta, { color: colors.mutedForeground }]}>
                  {st ? formatBytes(st.completedTileSize) : "…"} ·{" "}
                  {(st?.completedTileCount ?? meta.estTiles ?? 0).toLocaleString()}{" "}
                  tiles · detail to ~{MAX_DETAIL_M_PER_PX} m/pixel
                </Text>

                {saved ? (
                  <Text style={[styles.regionMeta, { color: colors.mutedForeground }]}>
                    Downloaded {saved}
                  </Text>
                ) : null}

                <View style={styles.regionActions}>
                  {/* Not its own Pressable — the whole card is the target, so
                      Remove stays the only nested touchable. */}
                  <View
                    style={[
                      styles.actionBtn,
                      styles.actionPrimary,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.background,
                      },
                    ]}
                  >
                    <Feather name="square-dashed" size={16} color={colors.foreground} />
                    <Text style={[styles.actionText, { color: colors.foreground }]}>
                      Show on map
                    </Text>
                  </View>

                  {incomplete && st?.state === "inactive" ? (
                    <Pressable
                      onPress={async () => {
                        try {
                          await p.resume();
                        } catch (err) {
                          console.warn("resume pack error", err);
                        }
                        refresh();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Resume downloading ${title}`}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        { borderColor: colors.gold, opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Feather name="play" size={16} color={colors.goldDim} />
                      <Text style={[styles.actionText, { color: colors.goldDim }]}>
                        Resume
                      </Text>
                    </Pressable>
                  ) : null}

                  <Pressable
                    onPress={() => removePack(p)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove offline region ${title}`}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      { borderColor: colors.destructive, opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Feather name="trash-2" size={16} color={colors.destructive} />
                    <Text style={[styles.actionText, { color: colors.destructive }]}>
                      Remove
                    </Text>
                  </Pressable>
                </View>
              </Pressable>
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

          <View
            style={styles.mapWrap}
            onLayout={(e) =>
              setMapSize({
                w: e.nativeEvent.layout.width,
                h: e.nativeEvent.layout.height,
              })
            }
          >
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
            <View
              pointerEvents="none"
              style={[
                styles.selectionFrame,
                { borderColor: tooLarge ? "#E66A60" : "#FCBA19" },
              ]}
            />
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
            <View>
              <Text style={[styles.modalInfoLabel, { color: colors.mutedForeground }]}>
                Name this region
              </Text>
              <TextInput
                value={nameInput}
                onChangeText={(t) => {
                  setNameInput(t);
                  setNameEdited(true);
                }}
                placeholder="Naming from the map…"
                placeholderTextColor={colors.mutedForeground}
                editable={!downloading}
                returnKeyType="done"
                style={[
                  styles.nameInput,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              />
            </View>

            <View style={styles.tileInfoRow}>
              <View>
                <Text style={[styles.modalInfoLabel, { color: colors.mutedForeground }]}>
                  Estimated tiles
                </Text>
                <Text
                  style={[
                    styles.modalInfoValue,
                    { color: tooLarge ? colors.destructive : colors.foreground },
                  ]}
                >
                  {tileCount.toLocaleString()}
                </Text>
              </View>
              <View>
                <Text style={[styles.modalInfoLabel, { color: colors.mutedForeground }]}>
                  Area
                </Text>
                <Text
                  style={[
                    styles.modalInfoValue,
                    { color: tooLarge ? colors.destructive : colors.foreground },
                  ]}
                >
                  {formatSpanKm(selectionBounds)}
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
                disabled={tooLarge}
                style={({ pressed }) => [
                  styles.downloadBtn,
                  {
                    backgroundColor: tooLarge ? colors.muted : colors.primary,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Feather
                  name="download"
                  size={18}
                  color={tooLarge ? colors.mutedForeground : colors.primaryForeground}
                />
                <Text
                  style={[
                    styles.downloadBtnText,
                    {
                      color: tooLarge
                        ? colors.mutedForeground
                        : colors.primaryForeground,
                    },
                  ]}
                >
                  {tooLarge
                    ? `Too large (max ${TILE_LIMIT.toLocaleString()} tiles)`
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
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  regionTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  regionAnswer: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginTop: 3,
  },
  regionMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  regionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionPrimary: { flex: 1 },
  actionText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
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
    top: SELECTION_INSET,
    bottom: SELECTION_INSET,
    left: SELECTION_INSET,
    right: SELECTION_INSET,
    borderWidth: 3,
    borderRadius: 12,
  },
  modalFooter: {
    borderTopWidth: 1,
    padding: 16,
    gap: 12,
  },
  nameInput: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 6,
    fontFamily: "Inter_500Medium",
    fontSize: 15,
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
