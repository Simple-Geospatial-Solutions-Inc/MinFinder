import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as Location from "expo-location";

import { FieldReports, onSiteForAny, sectionOf, useReports } from "@/components/FieldReports";
import { Feather } from "@/components/Icon";
import { StatusBadge } from "@/components/StatusBadge";
import { GUTTER, IconButton, ListRow, ListSection, PillButton, radius, Segmented, Sheet, type, useLast } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useEntitlement } from "@/hooks/useEntitlement";
import { getNamesForOccurrence, type Occurrence, type OccurrenceName } from "@/lib/db";
import { formatDMS } from "@/lib/geo";

const SNAPS = ["60%", "100%"];

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

export function DetailsSheet({
  occurrence: current,
  matchedName,
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
  /** Called when a free user taps a gated action; the parent owns the paywall. */
  onRequestUpgrade: (feature: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isPaid } = useEntitlement();

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
    if (picked.current || !m || o!.LATITUDE == null || o!.LONGITUDE == null || reports[0]?.minfilno !== m) return;
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
  }, [last, reports]);

  useEffect(() => {
    if (id == null) return;
    let cancelled = false;
    setNames([]);
    setNamesOpen(false);
    setTab("details");
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

  return (
    <Sheet
      open={!!current}
      snapPoints={SNAPS}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdrop
      topInset={insets.top}
      onClose={onClose}
    >
      <BottomSheetScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.header}>
          <View style={styles.titleCol}>
            <Text style={[type.display, { color: colors.foreground }]} numberOfLines={2} accessibilityRole="header">
              {occurrence.NAME1 || "Unnamed"}
            </Text>
            {!!occurrence.NAME2 && (
              <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                {occurrence.NAME2}
              </Text>
            )}
          </View>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>

        <View>
          <View style={styles.badgeRow}>
            <StatusBadge code={occurrence.STATUS_C} />
            {minfilno && (
              <Text style={[type.meta, { color: colors.mutedForeground }]} selectable>
                MINFILE {minfilno}
              </Text>
            )}
          </View>

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
        </View>

        <View style={styles.pair}>
          <PillButton
            label="Navigate"
            icon={isPaid ? "navigation" : "lock"}
            variant={isPaid ? "primary" : "secondary"}
            onPress={navigate}
            accessibilityHint={isPaid ? undefined : "MinFinder Pro feature"}
          />
          {officialUrl && (
            <PillButton
              label="Official record"
              icon="external-link"
              variant="secondary"
              onPress={() => void WebBrowser.openBrowserAsync(officialUrl)}
            />
          )}
        </View>

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
      </BottomSheetScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: GUTTER, paddingTop: 4, gap: 24 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleCol: { flex: 1, gap: 2 },
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
