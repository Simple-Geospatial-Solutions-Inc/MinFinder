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

import { STATUS_MAP, STATUS_ORDER } from "@/constants/status";
import { useColors } from "@/hooks/useColors";
import { useSubscription } from "@/lib/revenuecat";

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

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.scroll}
    >
      <Text style={[styles.h1, { color: colors.foreground }]}>SGS MinFinder</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        A field-ready map of British Columbia MINFILE mineral occurrences.
        Records are bundled in a local SQLite database so the app works
        without a data connection. Pre-download map tiles for an area you
        plan to visit and the basemap will be available offline too.
      </Text>

      <Text style={[styles.h2, { color: colors.foreground }]}>Marker legend</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        MINFILE ranks each occurrence by how far exploration and development
        have gone. Tap a status to see what it means.
      </Text>
      <View style={styles.legendList}>
        {STATUS_ORDER.map((code) => {
          const info = STATUS_MAP[code];
          const isOpen = openStatus === code;
          return (
            <View key={code}>
              <Pressable
                onPress={() => toggleStatus(code)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                accessibilityLabel={info.label}
                accessibilityHint={
                  isOpen
                    ? "Hide what this status means"
                    : "Show what this status means"
                }
                style={({ pressed }) => [
                  styles.legendRow,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <View
                  style={[
                    styles.legendDot,
                    { backgroundColor: info.color },
                  ]}
                >
                  <Text style={styles.legendDotText}>{info.short}</Text>
                </View>
                <Text style={[styles.legendLabel, { color: colors.foreground }]}>
                  {info.label}
                </Text>
                <View style={styles.legendSpacer} />
                <Feather
                  name="chevron-down"
                  size={16}
                  color={colors.mutedForeground}
                  style={isOpen ? styles.chevronOpen : undefined}
                />
              </Pressable>
              {isOpen && info.description ? (
                <Text
                  style={[
                    styles.legendDescription,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {info.description}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>

      <Text style={[styles.h2, { color: colors.foreground }]}>Data sources</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardText, { color: colors.foreground }]}>
          MINFILE: BC Ministry of Energy, Mines and Low Carbon Innovation
        </Text>
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync("https://minfile.gov.bc.ca/")}
          style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="external-link" size={14} color={colors.primary} />
          <Text style={[styles.linkText, { color: colors.primary }]}>
            minfile.gov.bc.ca
          </Text>
        </Pressable>
        <Text style={[styles.cardText, { color: colors.mutedForeground, fontSize: 11, marginTop: 6 }]}>
          SGS MinFinder is an independent app and is not affiliated with, endorsed by, or
          operated by the Government of British Columbia or any government agency.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardText, { color: colors.foreground }]}>
          Basemap tiles: Esri World Topographic Map
        </Text>
        <Text style={[styles.cardText, { color: colors.mutedForeground, fontSize: 11 }]}>
          Sources: Esri, HERE, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors, and the GIS User Community
        </Text>
        <Text style={[styles.cardText, { color: colors.mutedForeground, fontSize: 11, marginTop: 6 }]}>
          Map engine: MapLibre, an open-source map renderer. The Esri
          topographic tiles are drawn on the MapLibre map view.
        </Text>
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync("https://www.esri.com/en-us/legal/terms/data-attributions")}
          style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="external-link" size={14} color={colors.primary} />
          <Text style={[styles.linkText, { color: colors.primary }]}>
            Esri data attributions
          </Text>
        </Pressable>
      </View>

      <Text style={[styles.h2, { color: colors.foreground }]}>Legal</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync("https://sgss.ca/mobile-apps/minfinder/privacy")}
          style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="external-link" size={14} color={colors.primary} />
          <Text style={[styles.linkText, { color: colors.primary }]}>
            Privacy Policy
          </Text>
        </Pressable>
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync("https://sgss.ca/mobile-apps/minfinder/terms")}
          style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="external-link" size={14} color={colors.primary} />
          <Text style={[styles.linkText, { color: colors.primary }]}>
            Terms of Use (EULA)
          </Text>
        </Pressable>
      </View>

      <Text style={[styles.h2, { color: colors.foreground }]}>MinFinder Pro</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardText, { color: colors.foreground }]}>
          {isPaid
            ? "Pro is active on this device."
            : "Compass navigation and full occurrence details are Pro features."}
        </Text>
        <Pressable
          onPress={() => router.push("/redeem")}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.linkRow,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="gift" size={14} color={colors.primary} />
          <Text style={[styles.linkText, { color: colors.primary }]}>
            Redeem a promo code
          </Text>
        </Pressable>
      </View>

      <Text style={[styles.h2, { color: colors.foreground }]}>Version</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.versionRow}>
          <Text style={[styles.cardText, { color: colors.foreground }]}>
            SGS MinFinder {appVersion}
          </Text>
          <Text style={[styles.versionMeta, { color: colors.mutedForeground }]}>
            {bundleLabel}
          </Text>
        </View>

        {Updates.isEnabled ? (
          <>
            <Pressable
              onPress={
                updateState.kind === "ready"
                  ? () => Updates.reloadAsync()
                  : checkForUpdate
              }
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.linkRow,
                { opacity: pressed || busy ? 0.6 : 1 },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather
                  name={
                    updateState.kind === "ready" ? "rotate-cw" : "download-cloud"
                  }
                  size={14}
                  color={colors.primary}
                />
              )}
              <Text style={[styles.linkText, { color: colors.primary }]}>
                {updateState.kind === "checking"
                  ? "Checking…"
                  : updateState.kind === "downloading"
                    ? "Downloading…"
                    : updateState.kind === "ready"
                      ? "Restart to finish updating"
                      : "Check for updates"}
              </Text>
            </Pressable>

            {(updateState.kind === "current" ||
              updateState.kind === "ready" ||
              updateState.kind === "error") && (
              <Text
                style={[
                  styles.cardText,
                  { color: colors.mutedForeground, fontSize: 11 },
                ]}
              >
                {updateState.kind === "current"
                  ? "You're running the latest version."
                  : updateState.kind === "ready"
                    ? "An update is ready and will be applied when you restart."
                    : "Couldn't check right now. Connect to the internet and try again."}
              </Text>
            )}
          </>
        ) : (
          <Text
            style={[
              styles.cardText,
              { color: colors.mutedForeground, fontSize: 11 },
            ]}
          >
            Over-the-air updates are disabled in this build.
          </Text>
        )}
      </View>

      {__DEV__ && (
        <>
          <Text style={[styles.h2, { color: colors.foreground }]}>
            Developer
          </Text>
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderStyle: "dashed",
              },
            ]}
          >
            <Text style={[styles.cardText, { color: colors.foreground }]}>
              Subscription: {isPaid ? "Active (Pro)" : "Free"}
            </Text>
            <Pressable
              onPress={resetTestUser}
              disabled={isLoading}
              style={({ pressed }) => [
                styles.linkRow,
                { opacity: pressed || isLoading ? 0.6 : 1 },
              ]}
            >
              <Feather name="trash-2" size={14} color={colors.gold} />
              <Text style={[styles.linkText, { color: colors.gold }]}>
                Start fresh test user (reset purchases)
              </Text>
            </Pressable>
          </View>
        </>
      )}

      <Text style={[styles.footer, { color: colors.mutedForeground }]}>
        Use as a reference only. Always verify mine status, access, and
        safety information before visiting a site.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, gap: 16, paddingBottom: 40 },
  h1: { fontSize: 24, fontFamily: "Inter_700Bold" },
  h2: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 8 },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  legendList: { gap: 8 },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  legendSpacer: { flex: 1 },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  legendDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.95)",
  },
  legendDotText: {
    color: "#fff",
    fontFamily: "Inter_700Bold",
    fontSize: 10,
  },
  legendLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  legendDescription: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    // Aligns with the label: 30px dot + 12px row gap.
    paddingLeft: 42,
    paddingRight: 4,
    paddingBottom: 4,
  },
  card: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  cardText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  versionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  versionMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  footer: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 8,
  },
});
