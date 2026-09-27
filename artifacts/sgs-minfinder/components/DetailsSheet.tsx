import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as Location from "expo-location";

import { StatusChip } from "@/components/capture/StatusChip";
import { FieldReports, onSiteForAny, sectionOf, useReports } from "@/components/FieldReports";
import { Feather } from "@/components/Icon";
import { StatusBadge } from "@/components/StatusBadge";
import { GUTTER, IconButton, ListRow, ListSection, PillButton, radius, Segmented, Sheet, type, useLast } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useEntitlement } from "@/hooks/useEntitlement";
import { getNamesForOccurrence, type Occurrence, type OccurrenceName } from "@/lib/db";
import { formatDMS } from "@/lib/geo";
import { mineSummary } from "@/lib/sync";

// Gorhom's handle: the 5 pt indicator with 10 pt above and below.
const HANDLE = 25;
const PILL = 48;
const CLOSE = 36;
// The peek's title is the details title at this scale.
const PEEK_SCALE = type.title.fontSize / type.display.fontSize;
const CLAMP = Extrapolation.CLAMP;

type Tab = "details" | "reports" | "comments";

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const colors = useColors();
  if (!value) return null;
  return (
    <ListRow>
      <View style={styles.rowText}>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[type.label, { color: colors.foreground }]} selectable>
          {value}
        </Text>
      </View>
    </ListRow>
  );
}

/**
 * `from` as the peek shows it, `to` as details does, faded across on `p`. `to`
 * holds the slot's size; `from` lies over it. Only the side being headed for
 * takes touches.
 */
function Crossfade({
  p,
  up,
  from,
  to,
  style,
  layer,
}: {
  p: SharedValue<number>;
  up: boolean;
  from: React.ReactNode;
  to: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  layer?: StyleProp<ViewStyle>;
}) {
  const toStyle = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.3, 1], [0, 1], CLAMP) }));
  const fromStyle = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.7], [1, 0], CLAMP) }));
  return (
    <View style={style}>
      <Animated.View style={[layer, toStyle]} {...side(up)}>
        {to}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, layer, fromStyle]} {...side(!up)}>
        {from}
      </Animated.View>
    </View>
  );
}

/** Touch and screen-reader access for a piece that is only there on one side of the morph. */
const side = (shown: boolean) =>
  ({
    pointerEvents: shown ? "auto" : "none",
    accessibilityElementsHidden: !shown,
    importantForAccessibility: shown ? "auto" : "no-hide-descendants",
  }) as const;

/**
 * A mine's sheet. A pin tap opens it as a peek (name, status, MINFILNO,
 * Navigate and Details); pulled up, or on Details, the same sheet becomes the
 * full record, its shared pieces sliding and growing into place with the drag
 * while the rest fades in. Pulled down from details, it closes. Navigate is
 * Pro; the record's body gates itself.
 */
export function MineSheet({
  occurrence: current,
  matchedName,
  expanded,
  onExpand,
  onClose,
  onRequestUpgrade,
}: {
  occurrence: Occurrence | null;
  /**
   * The name that put this occurrence in the committed search, when it is not
   * the primary name. Nearly half of all MINFILE names are rank 3 or lower, so
   * the reason a record is on screen is usually inside the collapsed disclosure
   * below — this opens it and marks the name rather than making the user hunt.
   */
  matchedName?: string | null;
  onClose: () => void;
  /** Open as the full record: search picks and field-report points skip the peek. */
  expanded: boolean;
  /** The peek is headed for the full record. */
  onExpand: () => void;
  /** Called when a free user taps a gated action; the parent owns the paywall. */
  onRequestUpgrade: (feature: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isPaid } = useEntitlement();

  const sheet = useRef<BottomSheet>(null);
  // Gorhom drives this with the drag; p runs 0 at the peek to 1 at details.
  const index = useSharedValue(-1);
  const p = useDerivedValue(() => interpolate(index.value, [0, 1], [0, 1], CLAMP));
  // Where the sheet is headed, so touches and the screen reader follow the
  // side that is fading in rather than the one fading out.
  const [target, setTarget] = useState(expanded ? 1 : 0);
  const up = target >= 1;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  // The full record mounts once the sheet heads for it: a pin tap needn't pay for it.
  const [bodyOn, setBodyOn] = useState(up);
  if (up && !bodyOn) setBodyOn(true);

  // MINFILE records up to 20 names per occurrence. The title and subtitle above
  // cover the first two; the rest are worth having (a prospector may only know
  // an occurrence by an old claim name) but would swamp the header, so they sit
  // behind a disclosure. Loaded per-occurrence rather than shipped in every row
  // of the map's in-memory dataset.
  const [names, setNames] = useState<OccurrenceName[]>([]);
  const [namesOpen, setNamesOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("details");
  // Held through the close animation, match and all.
  const last = useLast(useMemo(() => current && { occurrence: current, matchedName }, [current, matchedName]));
  const match = last?.matchedName ?? null;
  const id = last?.occurrence.id ?? null;
  const { reports, state: reportsState } = useReports(last?.occurrence.MINFILNO?.trim());
  // Standing at the mine with something to confirm: open on Reports, where the
  // "Can you see it?" prompt is. Once per mine, and never over a tab the user chose.
  const picked = useRef(false);
  useEffect(() => {
    const o = last?.occurrence;
    const m = o?.MINFILNO?.trim();
    // reports lags a render behind a new mine; don't judge this one by the last one's.
    // Only once the record is showing: the peek has no reports to switch to.
    if (!bodyOn || picked.current || !m || o!.LATITUDE == null || o!.LONGITUDE == null || reports[0]?.minfilno !== m) return;
    let cancelled = false;
    (async () => {
      // Only read a fix the user already allowed; opening a sheet shouldn't prompt.
      if ((await Location.getForegroundPermissionsAsync()).status !== "granted") return;
      const l = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 30 });
      if (cancelled || picked.current || !l) return;
      const fix = { lat: l.coords.latitude, lon: l.coords.longitude, accuracy: l.coords.accuracy ?? Infinity, altitude: null, time: l.timestamp };
      const mine = { minfilno: m, name: "", published: { lat: o!.LATITUDE!, lon: o!.LONGITUDE! } };
      if (onSiteForAny(reports, fix, mine)) {
        picked.current = true;
        setTab("reports");
        AccessibilityInfo.announceForAccessibility("You're at this mine. Showing its reports.");
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [last, reports, bodyOn]);

  useEffect(() => {
    if (id == null) return;
    let cancelled = false;
    setNames([]);
    setNamesOpen(false);
    setTab("details");
    setBodyOn(expandedRef.current);
    picked.current = false;
    getNamesForOccurrence(id)
      .then((rows) => {
        if (cancelled) return;
        setNames(rows);
        // Open the disclosure unprompted when the matched name is hiding in it,
        // so arriving here from a search never buries the reason why.
        if (match && rows.some((r) => r.rank > 2 && r.name === match)) {
          setNamesOpen(true);
        }
      })
      .catch((err) => console.warn("load names error", err));
    return () => {
      cancelled = true;
    };
  }, [id, match]);

  // Details positions, measured; the peek's are stacked from the same heights.
  const [m, setM] = useState({ headerY: 4, titleH: 28, metaY: 72, badgeH: 20, chipH: 0, pairY: 140 });
  const measure = (key: keyof typeof m, what: "y" | "height") => (e: LayoutChangeEvent) => {
    const v = e.nativeEvent.layout[what];
    setM((prev) => (prev[key] === v ? prev : { ...prev, [key]: v }));
  };
  const summary = mineSummary(reports);
  const chip = summary.disputed
    ? ({ icon: "wrench", label: "Location disputed by visitors", tone: "wait" } as const)
    : summary.best
      ? ({ icon: "check", label: "Better location confirmed", tone: "ok" } as const)
      : null;
  const metaPeekY = m.headerY + m.titleH * PEEK_SCALE + 6;
  const chipPeekY = metaPeekY + m.badgeH + 6;
  const colBottom = chip ? chipPeekY + m.chipH : metaPeekY + m.badgeH;
  const pairPeekY = Math.max(colBottom, m.headerY + CLOSE) + 16;
  const peekHeight = Math.round(HANDLE + pairPeekY + PILL + insets.bottom + 16);
  const snapPoints = useMemo(() => [peekHeight, "60%", "100%"], [peekHeight]);

  const titleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(p.value, [0, 1], [PEEK_SCALE, 1]) }],
  }));
  const metaStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: (1 - p.value) * (metaPeekY - m.metaY) }] }),
    [metaPeekY, m.metaY],
  );
  const pairStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: (1 - p.value) * (pairPeekY - m.pairY) }] }),
    [pairPeekY, m.pairY],
  );
  const chipStyle = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.5], [1, 0], CLAMP) }));
  // Everything details has and the peek doesn't.
  const restStyle = useAnimatedStyle(() => {
    const t = interpolate(p.value, [0.4, 1], [0, 1], CLAMP);
    return { opacity: t, transform: [{ translateY: (1 - t) * 12 }] };
  });

  const reduceMotion = useReducedMotion();
  const toggleNames = useCallback(() => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setNamesOpen((prev) => !prev);
  }, [reduceMotion]);

  if (!last) return null;
  const { occurrence } = last;

  // Ranks 1 and 2 are already the title and subtitle.
  const otherNames = names.filter((n) => n.rank > 2);
  const minfilno = occurrence.MINFILNO?.trim();
  const officialUrl = minfilno
    ? `https://minfile.gov.bc.ca/Summary.aspx?minfilno=${encodeURIComponent(minfilno)}`
    : null;

  const reportable = !!minfilno && occurrence.LATITUDE != null && occurrence.LONGITUDE != null;
  const count = (label: string, s: Tab) => {
    const n = reports.filter((r) => sectionOf(r) === s).length;
    return n ? `${label} · ${n}` : label;
  };

  const navigate = () => {
    if (!isPaid) return onRequestUpgrade("navigation");
    onClose();
    router.push({ pathname: "/compass", params: { id: String(occurrence.id) } });
  };

  const onAnimate = (from: number, to: number) => {
    // Pulled down from the record: close rather than settle on the peek.
    if (from >= 1 && to === 0 && expandedRef.current) return sheet.current?.close();
    // A hard fling from the peek stops at the record's height; a second pull
    // takes it the rest of the way. (Leaving full height out of the snap points
    // until then did the same, but made soft swipes rebound.)
    if (from === 0 && to === 2) return sheet.current?.snapToIndex(1);
    setTarget(Math.max(to, 0));
    if (to >= 1 && !expandedRef.current) onExpand();
  };

  const name = occurrence.NAME1 || "Unnamed";
  const title = (text: string) => (
    <Text style={[type.display, { color: colors.foreground }]} numberOfLines={2} accessibilityRole="header">
      {text}
    </Text>
  );
  const minfile = minfilno ? (
    <Text style={[type.meta, { color: colors.mutedForeground }]} selectable>
      MINFILE {minfilno}
    </Text>
  ) : (
    <View />
  );
  const lockedNavigate = (variant: "primary" | "secondary") => (
    <PillButton
      label="Navigate"
      icon="lock"
      variant={variant}
      onPress={navigate}
      accessibilityHint="MinFinder Pro feature"
    />
  );

  return (
    <Sheet
      ref={sheet}
      open={!!current}
      // Held at the record while it is open there, whichever of its heights.
      index={expanded ? Math.max(1, target) : 0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      animatedIndex={index}
      onAnimate={onAnimate}
      backdropComponent={renderBackdrop}
      topInset={insets.top}
      onClose={onClose}
    >
      <BottomSheetScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.header} onLayout={measure("headerY", "y")}>
          <View style={styles.titleCol}>
            {/* The peek leads with the matched name, as the search dropdown
                does; the record's title is the primary name, with the match in
                the names below. */}
            <Animated.View style={[styles.titleOrigin, titleStyle]} onLayout={measure("titleH", "height")}>
              {match && match !== name ? <Crossfade p={p} up={up} from={title(match)} to={title(name)} /> : title(name)}
            </Animated.View>
            {!!occurrence.NAME2 && (
              <Animated.View style={restStyle} {...side(up)}>
                <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {occurrence.NAME2}
                </Text>
              </Animated.View>
            )}
          </View>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>

        <View onLayout={measure("metaY", "y")}>
          <Animated.View style={[styles.badgeRow, metaStyle]} onLayout={measure("badgeH", "height")}>
            <StatusBadge code={occurrence.STATUS_C} />
            {match ? (
              <Crossfade
                p={p}
                up={up}
                style={styles.fill}
                from={
                  <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {`${occurrence.NAME1?.trim() || "Unnamed"} · ${minfilno || "—"}`}
                  </Text>
                }
                to={minfile}
              />
            ) : (
              minfile
            )}
          </Animated.View>

          <Animated.View style={restStyle} {...side(up)}>
            {otherNames.length > 0 && (
              <Pressable
                onPress={toggleNames}
                accessibilityRole="button"
                accessibilityState={{ expanded: namesOpen }}
                accessibilityHint={
                  namesOpen ? "Hide the other names for this occurrence" : "Show the other names for this occurrence"
                }
                style={({ pressed }) => [styles.moreNames, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Feather
                  name="chevron-down"
                  size={16}
                  color={colors.mutedForeground}
                  style={namesOpen ? styles.chevronOpen : undefined}
                />
                <Text style={[type.link, { color: colors.mutedForeground }]}>
                  {otherNames.length} more {otherNames.length === 1 ? "name" : "names"}
                </Text>
              </Pressable>
            )}
            {namesOpen && (
              <Text style={[type.meta, styles.namesList, { color: colors.foreground }]} selectable>
                {otherNames.map((n, i) => (
                  // Nested Text so the matched name can be picked out of a
                  // flowing list without breaking it into rows.
                  <Text
                    key={n.rank}
                    style={n.name === match ? [styles.matchedName, { color: colors.primary }] : undefined}
                  >
                    {i > 0 ? " · " : ""}
                    {n.name}
                  </Text>
                ))}
              </Text>
            )}
          </Animated.View>
        </View>

        {/* The peek's only extra: sits under its meta line, and fades as the rest arrives. */}
        {chip && (
          <Animated.View
            style={[styles.chip, { top: chipPeekY }, chipStyle]}
            onLayout={measure("chipH", "height")}
            {...side(!up)}
            pointerEvents="none"
          >
            <StatusChip status={chip} />
          </Animated.View>
        )}

        <Animated.View style={[styles.pair, pairStyle]} onLayout={measure("pairY", "y")}>
          {/* Free users' Navigate is gold in the peek and steps back in the
              record, where unlocking Pro takes the gold. */}
          {isPaid ? (
            <PillButton label="Navigate" icon="navigation" onPress={navigate} />
          ) : (
            <Crossfade
              p={p}
              up={up}
              style={styles.slot}
              layer={styles.row}
              from={lockedNavigate("primary")}
              to={lockedNavigate("secondary")}
            />
          )}
          {/* ponytail: with no MINFILNO there's no official record, and Navigate stays half width. */}
          <Crossfade
            p={p}
            up={up}
            style={styles.slot}
            layer={styles.row}
            from={<PillButton label="Details" variant="secondary" onPress={() => sheet.current?.snapToIndex(1)} />}
            to={
              officialUrl ? (
                <PillButton
                  label="Official record"
                  icon="external-link"
                  variant="secondary"
                  onPress={() => void WebBrowser.openBrowserAsync(officialUrl)}
                />
              ) : (
                <View />
              )
            }
          />
        </Animated.View>

        {bodyOn && (
          <Animated.View style={[styles.rest, restStyle]} {...side(up)}>
          {reportable && (
            <Segmented
              options={[
                { value: "details", label: "Details" },
                { value: "reports", label: count("Reports", "reports") },
                { value: "comments", label: count("Comments", "comments") },
              ]}
              value={tab}
              onChange={(t) => {
                picked.current = true;
                setTab(t);
              }}
            />
          )}

          {/* Free and Pro alike: comments and searches are for everyone; the exact
              points inside stay behind the same gate as the coordinates. */}
          {reportable && tab !== "details" ? (
            <FieldReports
              mine={{
                minfilno,
                name: occurrence.NAME1?.trim() || `MINFILE ${minfilno}`,
                published: { lat: occurrence.LATITUDE!, lon: occurrence.LONGITUDE! },
              }}
              reports={reports}
              state={reportsState}
              section={tab}
              isPaid={isPaid}
              onLeave={onClose}
              onRequestUpgrade={onRequestUpgrade}
            />
          ) : !isPaid ? (
            // Free tier keeps the summary above (name, status, MINFILNO) and swaps
            // the full record for an upgrade prompt.
            <View style={[styles.upsell, { backgroundColor: colors.muted }]}>
              <View style={styles.upsellHead}>
                <Feather name="lock" size={16} color={colors.foreground} />
                <Text style={[type.label, { color: colors.foreground, flex: 1 }]}>Full details are a Pro feature</Text>
              </View>
              <Text style={[type.meta, { color: colors.foreground }]}>
                MinFinder Pro unlocks coordinates in decimal, DMS and UTM, elevation, host rock and deposit class, plus
                compass navigation to any occurrence.
              </Text>
              <View style={styles.pair}>
                <PillButton label="Unlock MinFinder Pro" onPress={() => onRequestUpgrade("full details")} />
              </View>
            </View>
          ) : (
            <>
              <ListSection title="Geology">
                <Row label="Status" value={occurrence.STATUS_D} />
                <Row label="Deposit class" value={occurrence.DEPOSIT_CLASS} />
                <Row label="Host rock" value={occurrence.HOSTROCK} />
              </ListSection>
              <ListSection title="Location">
                <Row
                  label="Latitude"
                  value={
                    occurrence.LATITUDE != null
                      ? `${occurrence.LATITUDE.toFixed(6)}°  (${formatDMS(occurrence.LATITUDE, true)})`
                      : null
                  }
                />
                <Row
                  label="Longitude"
                  value={
                    occurrence.LONGITUDE != null
                      ? `${occurrence.LONGITUDE.toFixed(6)}°  (${formatDMS(occurrence.LONGITUDE, false)})`
                      : null
                  }
                />
                <Row
                  label="UTM (NAD83)"
                  value={
                    occurrence.N83_ZONE
                      ? `Zone ${occurrence.N83_ZONE} · E ${occurrence.N83_EAST} · N ${occurrence.N83_NORT}`
                      : null
                  }
                />
                <Row label="Elevation" value={occurrence.ELEV ? `${occurrence.ELEV} m` : null} />
              </ListSection>
            </>
          )}
          </Animated.View>
        )}
      </BottomSheetScrollView>
    </Sheet>
  );
}

// Dims only once the peek is on its way to the record, leaving the map live under the peek.
const renderBackdrop = (props: BottomSheetBackdropProps) => (
  <BottomSheetBackdrop {...props} appearsOnIndex={1} disappearsOnIndex={0} opacity={0.25} pressBehavior="close" />
);

const styles = StyleSheet.create({
  content: { paddingHorizontal: GUTTER, paddingTop: 4, gap: 24 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleCol: { flex: 1, gap: 2 },
  titleOrigin: { transformOrigin: "left top" },
  fill: { flex: 1, minWidth: 0 },
  chip: { position: "absolute", left: GUTTER },
  slot: { flex: 1 },
  row: { flexDirection: "row" },
  rest: { gap: 24 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  moreNames: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 44 },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  // Aligns with the label: 16 px chevron + 6 px gap.
  namesList: { paddingLeft: 22 },
  matchedName: { fontFamily: "Inter_700Bold" },
  pair: { flexDirection: "row", gap: 8 },
  upsell: { borderRadius: radius.md, padding: 16, gap: 12 },
  upsellHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowText: { flex: 1, gap: 2 },
});
