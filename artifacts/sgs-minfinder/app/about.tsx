import { Feather } from "@/components/Icon";
import Constants from "expo-constants";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { GUTTER, ListRow, ListSection, TextButton, type } from "@/components/ui";
import { STATUS_MAP, STATUS_ORDER } from "@/constants/status";
import { useColors } from "@/hooks/useColors";
import { useSubscription } from "@/lib/revenuecat";
import { SATELLITE_ATTRIBUTION, SATELLITE_TERMS_URL } from "@/lib/satellite";

/**
 * Where the manual "Check for updates" button is in its cycle. `ready` means a
 * new bundle is downloaded and only takes effect once the app restarts.
 */
type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "downloading" }
  | { kind: "current" }
  | { kind: "ready" }
  | { kind: "error" };

export default function AboutScreen() {
  const colors = useColors();
  const { isPaid, resetTestUser, isLoading } = useSubscription();

  const [updateState, setUpdateState] = useState<UpdateState>({ kind: "idle" });

  const appVersion = Constants.expoConfig?.version ?? "—";

  // Which JS bundle is actually running: the one baked into the store build,
  // or an OTA update downloaded since. `createdAt` is null for embedded launches.
  const bundleLabel = Updates.isEmbeddedLaunch
    ? "Bundled with app"
    : Updates.createdAt
      ? `Updated ${Updates.createdAt.toLocaleDateString()}`
      : "Updated";

  const checkForUpdate = useCallback(async () => {
    setUpdateState({ kind: "checking" });
    try {
      const result = await Updates.checkForUpdateAsync();
      // A rollback is delivered as `isRollBackToEmbedded`, not `isAvailable`,
      // but it still needs fetching and restarting like any other update.
      if (!result.isAvailable && !result.isRollBackToEmbedded) {
        setUpdateState({ kind: "current" });
        return;
      }
      setUpdateState({ kind: "downloading" });
      const fetched = await Updates.fetchUpdateAsync();
      setUpdateState(
        fetched.isNew || fetched.isRollBackToEmbedded
          ? { kind: "ready" }
          : { kind: "current" },
      );
    } catch {
      setUpdateState({ kind: "error" });
    }
  }, []);

  const busy =
    updateState.kind === "checking" || updateState.kind === "downloading";

  // Marker legend doubles as a MINFILE glossary. Single-open accordion: tapping
  // a row expands its explanation and collapses whichever one was open.
  const [openStatus, setOpenStatus] = useState<string | null>(null);
  const toggleStatus = useCallback((code: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenStatus((prev) => (prev === code ? null : code));
  }, []);

  const open = (url: string) => () => void WebBrowser.openBrowserAsync(url);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.scroll}
    >
      <View style={styles.intro}>
        <Text style={[type.display, { color: colors.foreground }]} accessibilityRole="header">
          SGS MinFinder
        </Text>
        <Text style={[type.meta, { color: colors.mutedForeground }]}>
          A field-ready map of British Columbia MINFILE mineral occurrences.
          Records are bundled in a local SQLite database so the app works
          without a data connection. Pre-download map tiles for an area you
          plan to visit and the basemap will be available offline too.
        </Text>
      </View>

      <ListSection
        title="Marker legend"
        subtitle="MINFILE ranks each occurrence by how far exploration and development have gone. Tap a status to see what it means."
      >
        {STATUS_ORDER.map((code) => {
          const info = STATUS_MAP[code];
          const isOpen = openStatus === code;
          return (
            <ListRow key={code}>
              <View style={styles.cell}>
                <Pressable
                  onPress={() => toggleStatus(code)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={info.label}
                  accessibilityHint={isOpen ? "Hide what this status means" : "Show what this status means"}
                  style={({ pressed }) => [styles.legendRow, { opacity: pressed ? 0.7 : 1 }]}
                >
                  {/* The pin as drawn on the map: white code on the status colour. */}
                  <View style={[styles.legendDot, { backgroundColor: info.color, borderColor: colors.card }]}>
                    <Text style={[styles.legendDotText, { color: colors.mapChrome }]}>{info.short}</Text>
                  </View>
                  <Text style={[type.label, styles.grow, { color: colors.foreground }]}>{info.label}</Text>
                  <Feather
                    name="chevron-down"
                    size={16}
                    color={colors.mutedForeground}
                    style={isOpen ? styles.chevronOpen : undefined}
                  />
                </Pressable>
                {isOpen && info.description ? (
                  <Text style={[type.meta, styles.legendDescription, { color: colors.mutedForeground }]}>
                    {info.description}
                  </Text>
                ) : null}
              </View>
            </ListRow>
          );
        })}
      </ListSection>

      <ListSection title="Data sources">
        <ListRow>
          <View style={styles.cell}>
            <Text style={[type.label, { color: colors.foreground }]}>
              MINFILE: BC Ministry of Energy, Mines and Low Carbon Innovation
            </Text>
            <TextButton
              label="minfile.gov.bc.ca"
              icon="external-link"
              accessibilityRole="link"
              onPress={open("https://minfile.gov.bc.ca/")}
            />
            <Text style={[type.fine, { color: colors.mutedForeground }]}>
              SGS MinFinder is an independent app and is not affiliated with, endorsed by, or
              operated by the Government of British Columbia or any government agency.
            </Text>
          </View>
        </ListRow>
        <ListRow>
          <View style={styles.cell}>
            <Text style={[type.label, { color: colors.foreground }]}>
              Basemap: SGS MinFinder Topo, built from OpenStreetMap
            </Text>
            <Text style={[type.fine, { color: colors.mutedForeground }]}>
              © OpenStreetMap contributors, © OpenMapTiles. Elevation, shaded relief
              and contours from MRDEM-30 (Natural Resources Canada) and modified
              Copernicus DEM data. Contains information licensed under the Open
              Government Licence – Canada, and under the Open Government Licence –
              British Columbia: forest tenure and oil & gas road segments,
              recreation lines, parks and ecological reserves, and bedrock geology.
            </Text>
            <Text style={[type.fine, { color: colors.mutedForeground }]}>
              Map engine: MapLibre, an open-source map renderer. Tiles are
              self-hosted by Simple Geospatial Solutions, so downloaded regions
              keep working with no connection.
            </Text>
            <Text style={[type.fine, { color: colors.mutedForeground }]}>
              Resource roads are shown from tenure records. An active tenure means a
              road was permitted and built — not that it is currently passable.
            </Text>
            <Text style={[type.fine, { color: colors.mutedForeground }]}>
              Satellite view (optional, online only) — {SATELLITE_ATTRIBUTION}.
              Imagery is streamed while you look at it and is never stored in
              downloaded regions; where there is no connection the topo map shows
              instead.
            </Text>
            <TextButton
              label="OpenStreetMap copyright"
              icon="external-link"
              accessibilityRole="link"
              onPress={open("https://www.openstreetmap.org/copyright")}
            />
            <TextButton
              label="Open Government Licence – British Columbia"
              icon="external-link"
              accessibilityRole="link"
              onPress={open("https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc")}
            />
            <TextButton
              label="Esri imagery attribution"
              icon="external-link"
              accessibilityRole="link"
              onPress={open(SATELLITE_TERMS_URL)}
            />
          </View>
        </ListRow>
      </ListSection>

      <ListSection title="Legal">
        <ListRow onPress={open("https://sgss.ca/mobile-apps/minfinder/privacy")} accessibilityLabel="Privacy Policy">
          <Text style={[type.label, styles.grow, { color: colors.foreground }]}>Privacy Policy</Text>
        </ListRow>
        <ListRow onPress={open("https://sgss.ca/mobile-apps/minfinder/terms")} accessibilityLabel="Terms of Use (EULA)">
          <Text style={[type.label, styles.grow, { color: colors.foreground }]}>Terms of Use (EULA)</Text>
        </ListRow>
      </ListSection>

      <ListSection
        title="MinFinder Pro"
        subtitle={
          isPaid
            ? "Pro is active on this device."
            : "Compass navigation and full occurrence details are Pro features."
        }
      >
        <ListRow onPress={() => router.push("/redeem")} accessibilityLabel="Redeem a promo code">
          <Feather name="gift" size={20} color={colors.foreground} />
          <Text style={[type.label, styles.grow, { color: colors.foreground }]}>Redeem a promo code</Text>
        </ListRow>
      </ListSection>

      <ListSection title="Version">
        <ListRow>
          <Text style={[type.label, styles.grow, { color: colors.foreground }]}>SGS MinFinder {appVersion}</Text>
          <Text style={[type.meta, { color: colors.mutedForeground }]}>{bundleLabel}</Text>
        </ListRow>
        {Updates.isEnabled ? (
          <ListRow
            onPress={
              busy
                ? undefined
                : updateState.kind === "ready"
                  ? () => void Updates.reloadAsync()
                  : checkForUpdate
            }
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <Feather
                name={updateState.kind === "ready" ? "rotate-cw" : "download-cloud"}
                size={20}
                color={colors.foreground}
              />
            )}
            <View style={styles.cell}>
              <Text style={[type.label, { color: colors.foreground }]}>
                {updateState.kind === "checking"
                  ? "Checking…"
                  : updateState.kind === "downloading"
                    ? "Downloading…"
                    : updateState.kind === "ready"
                      ? "Restart to finish updating"
                      : "Check for updates"}
              </Text>
              {(updateState.kind === "current" ||
                updateState.kind === "ready" ||
                updateState.kind === "error") && (
                <Text style={[type.meta, { color: colors.mutedForeground }]} accessibilityLiveRegion="polite">
                  {updateState.kind === "current"
                    ? "You're running the latest version."
                    : updateState.kind === "ready"
                      ? "An update is ready and will be applied when you restart."
                      : "Couldn't check right now. Connect to the internet and try again."}
                </Text>
              )}
            </View>
          </ListRow>
        ) : (
          <ListRow>
            <Text style={[type.meta, styles.grow, { color: colors.mutedForeground }]}>
              Over-the-air updates are disabled in this build.
            </Text>
          </ListRow>
        )}
      </ListSection>

      {__DEV__ && (
        <ListSection title="Developer" subtitle={`Subscription: ${isPaid ? "Active (Pro)" : "Free"}`}>
          <ListRow onPress={isLoading ? undefined : resetTestUser}>
            <Feather name="trash-2" size={20} color={colors.foreground} />
            <Text style={[type.label, styles.grow, { color: colors.foreground }]}>
              Start fresh test user (reset purchases)
            </Text>
          </ListRow>
        </ListSection>
      )}

      <Text style={[type.fine, styles.footer, { color: colors.mutedForeground }]}>
        Use as a reference only. Always verify mine status, access, and
        safety information before visiting a site.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: GUTTER, paddingTop: 16, gap: 24, paddingBottom: 40 },
  intro: { gap: 6 },
  grow: { flex: 1 },
  cell: { flex: 1, gap: 4 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  legendDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  legendDotText: { fontFamily: "Inter_700Bold", fontSize: 12, lineHeight: 16 },
  // Aligns with the label: 30px dot + 12px row gap.
  legendDescription: { paddingLeft: 42, paddingBottom: 4 },
  footer: { textAlign: "center" },
});
