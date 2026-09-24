import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Feather, type FeatherIconName } from "@/components/Icon";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
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
  OfflineManager,
  RasterSource,
  UserLocation,
  type CameraRef,
  type CircleLayerStyle,
  type FillLayerStyle,
  type GeoJSONSourceRef,
  type LineLayerStyle,
  type SymbolLayerStyle,
} from "@maplibre/maplibre-react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailsSheet } from "@/components/DetailsSheet";
import { OfflineRegionPill } from "@/components/OfflineRegionPill";
import { PillMenu } from "@/components/PillMenu";
import { PaywallSheet } from "@/components/PaywallSheet";
import { SatelliteCredit } from "@/components/SatelliteCredit";
import { QuickInfoCard } from "@/components/QuickInfoCard";
import { SearchMatchesPill } from "@/components/SearchMatchesPill";
import {
  floating,
  IconButton,
  MapButton,
  PillButton,
  radius,
  type,
} from "@/components/ui";
import colorTokens from "@/constants/colors";
import { STATUS_MAP, STATUS_ORDER, getStatusInfo } from "@/constants/status";
import { useColors } from "@/hooks/useColors";
import {
  hitIsAlias,
  hitTitle,
  queryOccurrences,
  searchOccurrences,
  toOccurrence,
  type Occurrence,
  type SearchHit,
} from "@/lib/db";
import { takePendingFocusRegion, type FocusRegion } from "@/lib/mapFocus";
import {
  BASEMAP_STYLE_JSON,
  LABEL_FONT,
  PACK_STYLE_VERSION,
} from "@/lib/mapStyle";
import {
  boundsCenter,
  deltaToZoom,
  normalizeBounds,
  occurrencesToBounds,
  occurrencesToFeatureCollection,
  regionToBounds,
  regionsToFeatureCollection,
  type Bounds,
  type Region,
  type RegionOutline,
} from "@/lib/mapGeo";
import {
  DEFAULT_BASEMAP,
  SATELLITE_ANCHOR_LAYER,
  SATELLITE_ATTRIBUTION,
  SATELLITE_MAX_ZOOM,
  SATELLITE_TILES,
  SATELLITE_TILE_SIZE,
  loadBasemap,
  otherBasemap,
  saveBasemap,
  type Basemap,
} from "@/lib/satellite";
import { loadStatuses, saveStatuses } from "@/lib/statusFilter";

const BC_REGION: Region = {
  latitude: 54.5,
  longitude: -125.5,
  latitudeDelta: 12,
  longitudeDelta: 14,
};

// The floating top chrome below the safe-area inset: an 8 pt margin, the search
// pill and the status chips. Places the search dropdown and the pill slot, and
// keeps `fitBounds` from tucking a region under the chrome.
const SEARCH_HEIGHT = 48;
const CHIP_HEIGHT = 36;
const TOP_BAR_HEIGHT = 8 + SEARCH_HEIGHT + 8 + CHIP_HEIGHT;
const REGION_PILL_HEIGHT = 56;
// The bottom row (Add a mine, map buttons) sits this far above the safe area.
const BOTTOM_INSET = 24;
// What fitBounds keeps clear at the bottom: the 48 pt row plus a margin.
const BOTTOM_CHROME = BOTTOM_INSET + 48 + 24;

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

// Sized to match the pre-MapLibre MarkerPin: a 32px dot (radius 16) with a 3px
// white border and 11px code label.
const pointCircleStyle = {
  circleColor: STATUS_COLOR_EXPR,
  circleRadius: 16,
  circleStrokeColor: "#ffffff",
  circleStrokeWidth: 3,
} as unknown as CircleLayerStyle;

const pointTextStyle = {
  textField: STATUS_CODE_EXPR,
  textFont: LABEL_FONT,
  textSize: 11,
  textColor: "#ffffff",
  textAllowOverlap: true,
  textIgnorePlacement: true,
} as unknown as SymbolLayerStyle;

// Kept as a plain object so the search-mode variant below can spread it.
const clusterCircle = {
  circleColor: "#16365C",
  circleOpacity: 0.95,
  circleStrokeColor: "#ffffff",
  circleStrokeWidth: 2,
  circleRadius: ["step", ["get", "point_count"], 16, 25, 20, 100, 26, 500, 32],
};
const clusterCircleStyle = clusterCircle as unknown as CircleLayerStyle;

const clusterTextStyle = {
  textField: ["get", "point_count_abbreviated"],
  textFont: LABEL_FONT,
  textSize: 12,
  textColor: "#ffffff",
  textAllowOverlap: true,
  textIgnorePlacement: true,
} as unknown as SymbolLayerStyle;

// --- Committed-search highlight --------------------------------------------
// Pressing Enter commits the query to the map: the source is swapped to just the
// matches, so they cluster into count bubbles exactly the way the full dataset
// does. Drawing every match as an individual pin was the first attempt and it
// does not survive contact with a real query — 1,883 "CREEK" pins bury the
// province. Non-matches are not drawn at all rather than dimmed, which makes the
// gold halo that used to mark a match redundant: everything on the map is one.
//
// The clusters do get a gold stroke instead of white, so the map still reads as
// "showing a search" at a glance rather than looking like a sparse basemap.
const clusterCircleSearchStyle = {
  ...clusterCircle,
  circleStrokeColor: "#FCBA19",
  circleStrokeWidth: 3,
} as unknown as CircleLayerStyle;

// Enter highlights every match, not just the 50 the dropdown lists. A
// single-letter query matches ~12k occurrences and still returns in tens of
// milliseconds, and capping would make the pill's count a lie. Set above the
// table size so it is a backstop rather than a limit.
const HIGHLIGHT_LIMIT = 20_000;

// A gold ring around the selected pin (transparent fill so it sits on top).
// Sized to hug the radius-16 dot + its 3px white border.
const selectedRingStyle = {
  circleColor: "rgba(0,0,0,0)",
  circleRadius: 18,
  circleStrokeColor: "#FCBA19",
  circleStrokeWidth: 4,
} as unknown as CircleLayerStyle;

// --- Downloaded offline-region outlines ------------------------------------
// Colors are hardcoded rather than themed: the basemap renders the same light
// cartography in both app themes, so these are matched to the basemap, not to
// the UI. Gold = the region the user tapped (continuing the app's "this one,
// right now" signal); navy = other cached regions shown by the coverage toggle.
//
// The dark casing under both strokes is not decorative — a bare gold line
// disappears against sunlit snow, granite and logging slash, which is exactly
// the terrain these regions cover.
//
// NOT YET RE-VERIFIED against the self-hosted basemap that replaced the Esri
// raster. The new style is lighter and adds shaded relief and orange dashed
// resource roads, and the resource-road colour (#B5651D) sits uncomfortably
// close to this gold. Judge it on a device in real terrain before trusting it —
// a desk comparison is what produced the original need for the casing.
const REGION_GOLD = "#FCBA19";
const REGION_NAVY = "#16365C";

const regionCasingStyle = {
  lineColor: "rgba(14,36,68,0.55)",
  lineWidth: ["case", ["get", "focused"], 6, 3.5],
  lineJoin: "round",
} as unknown as LineLayerStyle;

const regionFillStyle = {
  fillColor: ["case", ["get", "focused"], REGION_GOLD, REGION_NAVY],
  fillOpacity: ["case", ["get", "focused"], 0.12, 0.07],
} as unknown as FillLayerStyle;

// `lineDasharray` is not reliably data-driven in the MapLibre style spec, so the
// solid (focused) and dashed (other) strokes are separate filtered layers rather
// than one layer with a "case" expression.
const regionFocusedLineStyle = {
  lineColor: REGION_GOLD,
  lineWidth: 3,
  lineJoin: "round",
  lineCap: "round",
} as unknown as LineLayerStyle;

const regionOtherLineStyle = {
  lineColor: REGION_NAVY,
  lineWidth: 1.5,
  lineDasharray: [2, 2],
  lineJoin: "round",
} as unknown as LineLayerStyle;

const FOCUSED_FILTER = ["==", ["get", "focused"], true] as unknown;
const UNFOCUSED_FILTER = ["!=", ["get", "focused"], true] as unknown;

export default function MapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const cameraRef = useRef<CameraRef | null>(null);
  const shapeRef = useRef<GeoJSONSourceRef | null>(null);
  const [userLoc, setUserLoc] = useState<Location.LocationObject | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [loadingDb, setLoadingDb] = useState(true);
  // A failed DB load used to render as a plausible-looking "0 of 0", which is how
  // a broken build shipped unnoticed. Surface it instead.
  const [dbError, setDbError] = useState(false);

  // Starts with every status on and catches up with the persisted selection,
  // so a cold start never waits on storage to draw the pins.
  const [statuses, setStatuses] = useState<string[]>([...STATUS_ORDER]);
  const statusesLoaded = useRef(false);
  useEffect(() => {
    let cancelled = false;
    loadStatuses().then((s) => {
      // A toggle that landed before storage answered wins — otherwise the
      // stored value would silently undo it.
      if (!cancelled && !statusesLoaded.current) setStatuses(s);
      statusesLoaded.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(false);

  // All occurrences with coords, loaded once.
  const [allRows, setAllRows] = useState<Occurrence[]>([]);
  // Two-tier popup: tapping a marker shows `quickInfo` (the peek sheet). Its
  // Details button promotes that occurrence into `selected`, which opens the
  // full DetailsSheet. DetailsSheet gates its own body and Navigate
  // button on the Pro entitlement, so search picks (which skip quickInfo
  // entirely) stay behind the paywall too.
  const [quickInfo, setQuickInfo] = useState<Occurrence | null>(null);
  const [selected, setSelected] = useState<Occurrence | null>(null);
  // Search hits carry which of the occurrence's names matched, so a row found by
  // an old claim name can show that name rather than the primary one.
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  // A query committed to the map with the keyboard's Search key. Distinct from
  // `searchResults`, which is the (50-row) dropdown list: this is every match,
  // frozen at the moment Enter was pressed, and it drives the map rather than a
  // list. `rows` is empty for a query that matched nothing — the pill still needs
  // to say so.
  const [highlight, setHighlight] = useState<{
    term: string;
    rows: SearchHit[];
  } | null>(null);
  // The matched name for a row picked straight out of the dropdown. That path
  // clears the search state and opens the sheet directly, so it cannot go
  // through `matchedNameById` — but the row the user tapped was titled with the
  // matched name, and the sheet must not silently drop it.
  const [pickedMatch, setPickedMatch] = useState<string | null>(null);
  // Paywall lives here rather than inside DetailsSheet, which unmounts as it
  // hands a free user over to the paywall.
  const [paywallFor, setPaywallFor] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pillWidth, setPillWidth] = useState(0);
  // The search pill's morph into the menu, 0 closed to 1 open (see PillMenu).
  // withTiming follows the system's reduce-motion setting by default.
  const menuProgress = useSharedValue(0);
  useEffect(() => {
    menuProgress.value = withTiming(menuOpen ? 1 : 0, { duration: 480, easing: Easing.bezier(0.2, 0, 0, 1) });
  }, [menuOpen, menuProgress]);
  // The typed query gives way as the divider sweeps over it; the glyph stays.
  const searchFieldStyle = useAnimatedStyle(() => ({
    opacity: interpolate(menuProgress.value, [0, 0.35], [1, 0], Extrapolation.CLAMP),
  }));

  // The downloaded region the user tapped on the Offline screen, plus every
  // cached region for the coverage toggle.
  const [focusRegion, setFocusRegion] = useState<FocusRegion | null>(null);
  const [packRegions, setPackRegions] = useState<RegionOutline[]>([]);
  const [showCoverage, setShowCoverage] = useState(false);
  // Topo vs satellite. Starts on topo and catches up with the persisted choice,
  // so a cold start never waits on storage to draw the map.
  const [basemap, setBasemap] = useState<Basemap>(DEFAULT_BASEMAP);
  useEffect(() => {
    let cancelled = false;
    loadBasemap().then((b) => {
      if (!cancelled) setBasemap(b);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // Mirrored so the focus effect can reconcile against the current focus
  // without listing it as a dependency (which would resubscribe on every change).
  const focusIdRef = useRef<string | null>(null);
  useEffect(() => {
    focusIdRef.current = focusRegion?.id ?? null;
  }, [focusRegion]);

  // Load full dataset once on mount + request location
  useEffect(() => {
    let cancelled = false;
    let watcher: Location.LocationSubscription | undefined;
    (async () => {
      try {
        // Every occurrence with coordinates, deliberately unbounded. A numeric
        // cap here would quietly return an arbitrary subset once the table
        // outgrew it — queryOccurrences has no ORDER BY — and the load would
        // still look complete, which is the same class of failure as the
        // "0 of 0" the check below exists to catch.
        const rows = await queryOccurrences();
        if (rows.length === 0) {
          // The bundled DB always has rows, so an empty result means it opened
          // but has no usable data (wrong/corrupt copy, missing table).
          console.warn(
            "load DB returned 0 occurrences — the bundled minfile.db copy is " +
              "present but empty or unreadable",
          );
        }
        if (!cancelled) {
          setAllRows(rows);
          setDbError(rows.length === 0);
          setLoadingDb(false);
        }
      } catch (err) {
        console.warn("load DB error", err);
        if (!cancelled) {
          setDbError(true);
          setLoadingDb(false);
        }
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

  // A committed search narrows the map to its matches. Status chips still apply
  // on top, so toggling one after pressing Enter narrows the highlight instead
  // of invalidating it.
  const highlightRows = useMemo(() => {
    if (!highlight) return null;
    if (statuses.length === STATUS_ORDER.length) return highlight.rows;
    return highlight.rows.filter((r) => statusSet.has(r.STATUS_C ?? ""));
  }, [highlight, statuses.length, statusSet]);

  // Everything downstream — the source, the header count, the search-mode
  // styling — reads this one list, so the map and the count cannot disagree.
  // A query that matched nothing falls back to the full map on purpose: there is
  // nothing to narrow to, and blanking the map would be a dead end. The pill
  // still reports the miss.
  const drawnRows =
    highlightRows && highlightRows.length > 0 ? highlightRows : allFilteredRows;
  const highlightBounds = useMemo(
    () => (highlightRows ? occurrencesToBounds(highlightRows) : null),
    [highlightRows],
  );

  // GeoJSON fed to the clustered MapLibre source. MapLibre clusters natively on
  // the GPU (no manual grid, no marker pool, no viewport cull) — the layer
  // re-renders from this data whenever the status filter changes.
  const featureCollection = useMemo(
    () => occurrencesToFeatureCollection(drawnRows),
    [drawnRows],
  );
  const occById = useMemo(() => {
    const m = new Map<number, Occurrence>();
    for (const r of allRows) m.set(r.id, r);
    return m;
  }, [allRows]);

  // The pin currently previewed (quickInfo) or opened (selected) gets a ring.
  const selectedId = quickInfo?.id ?? selected?.id ?? null;

  const searchMode = drawnRows === highlightRows;

  // Most occurrences have several names, so a search for "CAMP CREEK" surfaces
  // pins whose primary name is JUNIPER or THORN. Tapping one and reading only
  // "JUNIPER" gives no hint why it is on the map, so the card and the sheet get
  // the name that actually matched. Only aliases are recorded: a hit on the
  // primary name needs no explaining, and a MINFILNO-only hit has no name.
  const matchedNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of highlight?.rows ?? []) {
      if (r.matchedName && hitIsAlias(r)) m.set(r.id, r.matchedName);
    }
    return m;
  }, [highlight]);

  const quickInfoMatch = quickInfo
    ? matchedNameById.get(quickInfo.id) ?? null
    : null;
  const selectedMatch = selected
    ? matchedNameById.get(selected.id) ?? pickedMatch
    : null;

  // The open pin, on a source that never clusters. The `occ` source clusters at
  // z<=14, and a point swallowed by a cluster is not a feature at that zoom — so
  // a filter-based ring on that source draws nothing when zoomed out, which is
  // why the gold ring used to vanish after a search pick (which lands at z~12.8).
  // At most one feature.
  const overlayShape = useMemo(() => {
    const open = quickInfo ?? selected;
    return occurrencesToFeatureCollection(open ? [open] : []);
  }, [quickInfo, selected]);

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

  // The TextInput carries `padding: 0` and so its own touch target is barely
  // taller than one line of text, well short of the pill drawn around it. Taps
  // on the pill's padding hit nothing, which reads as the field needing a couple
  // of tries to focus. The wrapping Pressable forwards those taps here.
  const searchInputRef = useRef<TextInput>(null);

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
        const rows = await searchOccurrences(search, {
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
    statusesLoaded.current = true;
    setStatuses((prev) => {
      const next = prev.includes(code)
        ? prev.filter((s) => s !== code)
        : [...prev, code];
      void saveStatuses(next);
      return next;
    });
  }, []);

  const clearHighlight = useCallback(() => setHighlight(null), []);

  // Enter commits the query to the map. Re-queries without the dropdown's 50-row
  // cap, because "highlight the search results" means all of them.
  const submitSeq = useRef(0);
  const onSubmitSearch = useCallback(async () => {
    const term = search.trim();
    if (!term) return;
    Keyboard.dismiss();
    // Fold the dropdown away — it covers the part of the map we are about to
    // frame. The results stay in state, so refocusing the field reopens it.
    setSearchActive(false);

    const seq = ++submitSeq.current;
    let rows: SearchHit[];
    try {
      rows = await searchOccurrences(term, {
        statuses: statuses.length === STATUS_ORDER.length ? undefined : statuses,
        limit: HIGHLIGHT_LIMIT,
      });
    } catch (err) {
      console.warn("highlight search error", err);
      return;
    }
    if (seq !== submitSeq.current) return;

    const bounds = occurrencesToBounds(rows);
    setHighlight({ term, rows });
    // The change is often entirely off-screen (a result set typically spans most
    // of BC), so confirm it in the hand as well as on the map.
    Haptics.selectionAsync().catch(() => {});

    if (rows.length === 0 || !bounds) return;
    if (rows.length === 1) {
      // Same landing as tapping the row, which keeps some context around a lone
      // hit instead of dropping to street level as a fitBounds would.
      cameraRef.current?.flyTo({
        center: boundsCenter(bounds),
        zoom: deltaToZoom(0.05),
        duration: 600,
      });
      return;
    }

    let reduceMotion = false;
    try {
      reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
    } catch {
      // Fall through to an animated fit.
    }
    cameraRef.current?.fitBounds(normalizeBounds(bounds), {
      padding: {
        top: insets.top + TOP_BAR_HEIGHT + REGION_PILL_HEIGHT + 12,
        bottom: insets.bottom + BOTTOM_CHROME,
        left: 24,
        right: 24,
      },
      duration: reduceMotion ? 0 : 700,
      easing: reduceMotion ? undefined : "ease",
    });
  }, [search, statuses, insets]);

  const onPickSearchResult = useCallback((row: SearchHit) => {
    Keyboard.dismiss();
    setSearch("");
    setSearchActive(false);
    setSearchResults(null);
    setHighlight(null);
    setQuickInfo(null); // search picks go straight to the full sheet
    if (row.LATITUDE == null || row.LONGITUDE == null) return;
    cameraRef.current?.flyTo({
      center: [row.LONGITUDE, row.LATITUDE],
      zoom: deltaToZoom(0.05),
      duration: 600,
    });
    setPickedMatch(hitIsAlias(row) ? row.matchedName : null);
    setTimeout(() => setSelected(toOccurrence(row)), 350);
  }, []);

  // Tapping a region on the Offline screen hands it over through lib/mapFocus
  // (see that file for why not route params) and pops back here. The request is
  // claimed exactly once, so returning from Compass/About does not re-fly the
  // camera. Reloading the pack list on every focus also powers the coverage
  // toggle and drops an outline whose pack was deleted while we were away.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      (async () => {
        try {
          const all = await OfflineManager.getPacks();
          if (cancelled) return;
          // Packs from an older PACK_STYLE_VERSION hold tiles this build never
          // requests (or, before v2, no tiles at all), so outlining one would
          // promise offline coverage that doesn't exist. The Offline screen
          // deletes them, but the map can be opened first.
          const packs = all.filter(
            (p) =>
              ((p.metadata ?? {}) as { styleVersion?: number }).styleVersion ===
              PACK_STYLE_VERSION,
          );
          setPackRegions(
            packs.map((p) => ({
              id: p.id,
              name: String(
                (p.metadata as { name?: string } | null)?.name ?? "Offline region",
              ),
              bounds: p.bounds as Bounds,
            })),
          );
          const focusedId = focusIdRef.current;
          if (focusedId && !packs.some((p) => p.id === focusedId)) {
            setFocusRegion(null);
          }
        } catch (err) {
          console.warn("getPacks error", err);
        }
      })();

      const region = takePendingFocusRegion();
      if (!region) {
        return () => {
          cancelled = true;
        };
      }

      // Clear anything that would sit over the region we're about to frame.
      setQuickInfo(null);
      setSelected(null);
      setSearchActive(false);
      setSearchResults(null);
      setFocusRegion(region);

      let handle: ReturnType<typeof setTimeout> | undefined;
      (async () => {
        let reduceMotion = false;
        try {
          reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
        } catch {
          // Fall through to an animated fit.
        }
        if (cancelled) return;
        // The pop transition is still running; fitting once it lands keeps the
        // animation smooth and lets the camera use the final viewport size.
        handle = setTimeout(() => {
          cameraRef.current?.fitBounds(normalizeBounds(region.bounds), {
            padding: {
              top: insets.top + TOP_BAR_HEIGHT + REGION_PILL_HEIGHT + 12,
              bottom: insets.bottom + BOTTOM_CHROME,
              left: 24,
              right: 24,
            },
            // The library defaults to a 2s "fly" arc, which reads as sluggish
            // when hopping across BC.
            duration: reduceMotion ? 0 : 700,
            easing: reduceMotion ? undefined : "ease",
          });
        }, 260);
      })();

      return () => {
        cancelled = true;
        if (handle) clearTimeout(handle);
      };
    }, [insets.top, insets.bottom]),
  );

  // Anywhere on the map is a "done typing" gesture. This fires for pin and
  // cluster taps too (the source handlers don't stop propagation), which is
  // wanted: reaching for a pin means the search field is finished with.
  const onMapPress = useCallback(() => {
    Keyboard.dismiss();
    setSearchActive(false);
  }, []);

  const toggleCoverage = useCallback(() => {
    // The outlines may be entirely off-screen at the current camera, so without
    // this the toggle can feel dead.
    Haptics.selectionAsync().catch(() => {});
    setShowCoverage((prev) => !prev);
  }, []);

  const toggleBasemap = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setBasemap((prev) => {
      const next = otherBasemap(prev);
      void saveBasemap(next);
      return next;
    });
  }, []);

  // What the outline layers draw: every cached region when coverage is on,
  // otherwise just the focused one. Rendered as null when there is nothing to
  // show, because GeoJSONSource requires `data`.
  const regionShape = useMemo(() => {
    const list: RegionOutline[] = showCoverage
      ? packRegions.map((r) => ({ ...r, focused: r.id === focusRegion?.id }))
      : focusRegion
        ? [{ id: focusRegion.id, name: focusRegion.name, bounds: focusRegion.bounds, focused: true }]
        : [];
    return list.length ? regionsToFeatureCollection(list) : null;
  }, [showCoverage, packRegions, focusRegion]);

  // The pill and the search dropdown occupy the same slot below the top bar.
  const searchDropdownOpen = !!(searchActive && searchResults && searchResults.length > 0);
  // Whether anything occupies the slot below the chips (see the render order).
  const slotTaken = !searchDropdownOpen && (dbError || !!highlight || !!focusRegion || showCoverage);

  return (
    <View style={[styles.root, { backgroundColor: colors.navyDeep }]}>
      <MapLibreMap
        style={StyleSheet.absoluteFill}
        mapStyle={BASEMAP_STYLE_JSON}
        attribution={false}
        touchRotate={false}
        touchPitch={false}
        onPress={onMapPress}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ bounds: regionToBounds(BC_REGION) }}
        />

        {/*
          Online-only satellite imagery, slotted into the topo style below the
          contours so roads, boundaries and labels stay on top (see
          SATELLITE_ANCHOR_LAYER). Permanently mounted and toggled through
          `visibility` rather than conditionally rendered — a remounted layer
          is appended to the top of the style (the trap noted on `occ-overlay`
          below), and a hidden layer costs nothing: MapLibre requests no tiles
          for a source none of whose layers are visible. Offline, failed tiles
          draw nothing and the topo underneath shows through.
        */}
        <RasterSource
          id="satellite"
          tiles={SATELLITE_TILES}
          tileSize={SATELLITE_TILE_SIZE}
          maxzoom={SATELLITE_MAX_ZOOM}
          attribution={SATELLITE_ATTRIBUTION}
        >
          <Layer
            id="satellite"
            type="raster"
            beforeId={SATELLITE_ANCHOR_LAYER}
            layout={{ visibility: basemap === "satellite" ? "visible" : "none" }}
          />
        </RasterSource>

        {/*
          Outlines of downloaded offline regions. `beforeId="clusters"` is
          required, not cosmetic: this source unmounts whenever the overlay is
          cleared, and a layer added back later is appended to the *top* of the
          style — so without it the outline would render over the pins the second
          time a region is opened. Anchoring to the first `occ` layer keeps the
          rectangles underneath regardless of insertion order.
        */}
        {regionShape && (
          <GeoJSONSource id="offline-regions" data={regionShape}>
            <Layer
              id="offline-region-fill"
              type="fill"
              beforeId="clusters"
              style={regionFillStyle}
            />
            <Layer
              id="offline-region-casing"
              type="line"
              beforeId="clusters"
              style={regionCasingStyle}
            />
            <Layer
              id="offline-region-line-other"
              type="line"
              beforeId="clusters"
              filter={UNFOCUSED_FILTER as never}
              style={regionOtherLineStyle}
            />
            <Layer
              id="offline-region-line-focused"
              type="line"
              beforeId="clusters"
              filter={FOCUSED_FILTER as never}
              style={regionFocusedLineStyle}
            />
          </GeoJSONSource>
        )}

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
            style={searchMode ? clusterCircleSearchStyle : clusterCircleStyle}
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
        </GeoJSONSource>

        {/*
          The open pin on an un-clustered source, so its gold ring survives being
          zoomed out (see overlayShape). Declared after `occ` so it paints above
          the base pins, and kept permanently mounted with an empty collection
          when idle rather than conditionally rendered — a source that unmounts
          has its layers re-appended to the top of the style on remount, which is
          the trap the offline-regions source works around with `beforeId` above.

          `onPress` is required, not optional: a press goes to the source whose
          layer has the highest z-index under the touch, so without a handler
          these layers would swallow taps and make the open pin dead.
        */}
        <GeoJSONSource
          id="occ-overlay"
          data={overlayShape as unknown as GeoJSON.FeatureCollection}
          onPress={onFeaturePress}
        >
          <Layer id="overlay-point" type="circle" style={pointCircleStyle} />
          <Layer id="overlay-code" type="symbol" style={pointTextStyle} />
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

      {/* A tap anywhere off the open menu folds it back into the search field. */}
      {menuOpen && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setMenuOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
      )}

      {/* Floating chrome: search pill and status filters, AllTrails-style. */}
      <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable
          onPress={() => (menuOpen ? setMenuOpen(false) : searchInputRef.current?.focus())}
          accessible={false}
          style={styles.searchBar}
        >
          <View style={styles.searchClip} onLayout={(e) => setPillWidth(e.nativeEvent.layout.width)}>
            <Feather name="search" size={18} color={MAP.mapChromeForeground} />
            <Animated.View
              style={[styles.searchField, searchFieldStyle]}
              pointerEvents={menuOpen ? "none" : "box-none"}
              accessibilityElementsHidden={menuOpen}
              importantForAccessibility={menuOpen ? "no-hide-descendants" : "auto"}
            >
              <TextInput
                ref={searchInputRef}
                placeholder="Search a name or MINFILE number"
                placeholderTextColor={MAP.mapChromeMuted}
                value={search}
                onChangeText={(t) => {
                  setSearch(t);
                  setSearchActive(true);
                  // The highlight belongs to the query that was committed; editing
                  // the field invalidates it, and a pill reading "59 matches for
                  // SPAR" above a field saying SPARK is worse than no pill.
                  setHighlight(null);
                }}
                onFocus={() => setSearchActive(true)}
                onSubmitEditing={onSubmitSearch}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="characters"
                returnKeyType="search"
              />
              {search.length > 0 && (
                <IconButton
                  icon="x"
                  label="Clear search"
                  variant="plain"
                  color={MAP.mapChromeForeground}
                  onPress={() => {
                    setSearch("");
                    setSearchResults(null);
                    setHighlight(null);
                  }}
                />
              )}
            </Animated.View>
            <PillMenu
              width={pillWidth}
              progress={menuProgress}
              open={menuOpen}
              items={MENU}
              color={MAP.mapChromeForeground}
              dividerColor={MAP.border}
              onOpen={() => {
                Keyboard.dismiss();
                setSearchActive(false);
                setMenuOpen(true);
              }}
              onPick={(href) => {
                setMenuOpen(false);
                router.push(href);
              }}
            />
          </View>
        </Pressable>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsRow}
        >
          {STATUS_ORDER.map((code) => (
            <FilterChip
              key={code}
              label={STATUS_MAP[code].label}
              color={STATUS_MAP[code].color}
              active={statuses.includes(code)}
              onPress={() => {
                setMenuOpen(false);
                toggleStatus(code);
              }}
            />
          ))}
        </ScrollView>
      </View>

      {searchDropdownOpen && (
        <View
          style={[
            styles.searchResults,
            { top: insets.top + TOP_BAR_HEIGHT + 8, backgroundColor: colors.card },
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
                    <Text style={[type.label, { color: colors.foreground }]} numberOfLines={1}>
                      {hitTitle(r)}
                    </Text>
                    <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {/* An alias hit leads with the primary name, so the row the
                          user taps is still identifiable as the right record. */}
                      {hitIsAlias(r) ? `${r.NAME1?.trim()} · ` : ""}
                      {r.MINFILNO?.trim()} · {info.label}
                    </Text>
                  </View>
                  <Feather name="map-pin" size={16} color={colors.mutedForeground} />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* The sheets own the bottom edge while they're open. */}
      {!quickInfo && !selected && (
        <>
          {Platform.OS !== "web" && (
            <View style={[styles.addMine, { bottom: insets.bottom + BOTTOM_INSET }]}>
              <PillButton label="Add a mine" icon="plus" grow={false} onPress={() => router.push("/submit")} />
            </View>
          )}
          <View style={[styles.mapButtons, { bottom: insets.bottom + BOTTOM_INSET }]}>
            {Platform.OS !== "web" && (
              <MapButton
                icon="satellite"
                label="Satellite imagery"
                accessibilityHint="Imagery needs a connection; the topo map shows wherever it is unavailable"
                active={basemap === "satellite"}
                onPress={toggleBasemap}
              />
            )}
            {/* Offline coverage. Hidden with no downloads so the control is never
                dead, and it doubles as the thumb-reachable way to clear the
                region outline (the pill's Hide sits at the top of the screen). */}
            {packRegions.length > 0 && Platform.OS !== "web" && (
              <MapButton icon="layers" label="Offline coverage" active={showCoverage} onPress={toggleCoverage} />
            )}
            <MapButton icon="locate-fixed" label="Go to my location" onPress={recenter} />
          </View>
        </>
      )}

      {permissionDenied && !quickInfo && !selected && (
        <View style={[styles.mapNotice, styles.mapNoticeBottom, { bottom: insets.bottom + BOTTOM_INSET + 60 }]}>
          <Feather name="alert-triangle" size={16} color={MAP.mapChromeForeground} />
          <Text style={styles.mapNoticeText}>Location is off, so the map starts on all of BC.</Text>
        </View>
      )}

      {loadingDb && (
        <View style={styles.dbOverlay}>
          <ActivityIndicator size="large" color={colors.gold} />
          <Text style={styles.dbOverlayText}>Loading MINFILE database…</Text>
        </View>
      )}

      {/* One slot below the chips, several claimants. The dropdown wins while
          results are open, then a failed load (nothing else works without the
          data); a committed search outranks the offline-region pill, because it
          is the more recent thing the user asked for. */}
      {!searchDropdownOpen && dbError && (
        <View style={[styles.mapNotice, { top: insets.top + TOP_BAR_HEIGHT + 8 }]}>
          <Feather name="alert-triangle" size={16} color={MAP.mapChromeForeground} />
          <Text style={styles.mapNoticeText}>Occurrence data failed to load.</Text>
        </View>
      )}

      {!searchDropdownOpen && !dbError && highlight && (
        <SearchMatchesPill
          term={highlight.term}
          count={highlightRows?.length ?? 0}
          bounds={highlightBounds}
          onClear={clearHighlight}
          topOffset={insets.top + TOP_BAR_HEIGHT + 8}
        />
      )}

      {!searchDropdownOpen && !dbError && !highlight && (
        <OfflineRegionPill
          region={focusRegion}
          coverageCount={showCoverage ? packRegions.length : null}
          userLoc={userLoc ? userLoc.coords : null}
          onClear={() => {
            setFocusRegion(null);
            setShowCoverage(false);
          }}
          topOffset={insets.top + TOP_BAR_HEIGHT + 8}
        />
      )}

      {/* Esri requires its credit on the map while imagery is showing, and the
          map's own attribution control is off. It sits under the top chrome (and
          under the pill when one is up) so no sheet can cover it. */}
      {basemap === "satellite" && (
        <SatelliteCredit top={insets.top + TOP_BAR_HEIGHT + 8 + (slotTaken ? REGION_PILL_HEIGHT + 8 : 0)} />
      )}

      <QuickInfoCard
        occurrence={quickInfo}
        matchedName={quickInfoMatch}
        onClose={() => setQuickInfo(null)}
        onExpand={() => {
          if (quickInfo) {
            setPickedMatch(null);
            setSelected(quickInfo);
          }
          setQuickInfo(null);
        }}
      />

      <DetailsSheet
        occurrence={selected}
        matchedName={selectedMatch}
        onClose={() => setSelected(null)}
        onRequestUpgrade={(feature) => {
          setSelected(null);
          setPaywallFor(feature);
        }}
      />

      <PaywallSheet
        visible={paywallFor != null}
        feature={paywallFor ?? ""}
        onClose={() => setPaywallFor(null)}
      />
    </View>
  );
}

const MENU = [
  ["download-cloud", "Offline", "/offline"],
  ["inbox", "Submissions", "/my-submissions"],
  ["info", "About", "/about"],
] as const satisfies readonly (readonly [FeatherIconName, string, string])[];

/**
 * A status filter on the map. On shows the status colour as a solid dot; off
 * hollows the dot and greys the label, so the state reads without colour.
 */
function FilterChip({
  label,
  color,
  active,
  onPress,
}: {
  label: string;
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`Show ${label}`}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [styles.filterChip, { opacity: pressed ? 0.8 : 1 }]}
    >
      <View style={[styles.filterDot, { borderColor: color, backgroundColor: active ? color : "transparent" }]} />
      <Text style={[styles.filterText, { color: active ? MAP.mapChromeForeground : MAP.mapChromeMuted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// The chrome sits on the light basemap in both colour schemes.
const MAP = colorTokens.light;

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { position: "absolute", left: 0, right: 0, gap: 8 },
  searchBar: {
    height: SEARCH_HEIGHT,
    marginHorizontal: 16,
    borderRadius: SEARCH_HEIGHT / 2,
    backgroundColor: MAP.mapChrome,
    ...floating,
  },
  // Clips the menu button as the divider pushes it out; the bar itself can't
  // clip without losing its shadow on iOS.
  searchClip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 16,
    paddingRight: 4,
    borderRadius: SEARCH_HEIGHT / 2,
    overflow: "hidden",
  },
  searchInput: {
    flex: 1,
    marginLeft: 6,
    color: MAP.mapChromeForeground,
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    padding: 0,
  },
  // Stops short of PillMenu's divider and button: 4 + hairline + 4 + 36.
  searchField: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4, marginRight: 45 },
  // Room for the chips' shadow, which the scroll view would otherwise clip.
  chipsScroll: { marginVertical: -4 },
  chipsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 4 },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: CHIP_HEIGHT,
    paddingHorizontal: 14,
    borderRadius: CHIP_HEIGHT / 2,
    backgroundColor: MAP.mapChrome,
    ...floating,
  },
  filterDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  filterText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  searchResults: {
    position: "absolute",
    left: 16,
    right: 16,
    maxHeight: 320,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...floating,
  },
  searchResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultDot: { width: 10, height: 10, borderRadius: 5 },
  addMine: { position: "absolute", left: 16, flexDirection: "row" },
  mapButtons: { position: "absolute", right: 16, gap: 12 },
  mapNotice: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.lg,
    backgroundColor: MAP.mapChrome,
    ...floating,
  },
  // Stays clear of the map-button column on the right.
  mapNoticeBottom: { right: 16 + 40 + 12 },
  mapNoticeText: { flex: 1, color: MAP.mapChromeForeground, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
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
  dbOverlayText: { color: MAP.background, fontFamily: "Inter_500Medium", fontSize: 14 },
});
