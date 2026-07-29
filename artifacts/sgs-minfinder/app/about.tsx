import { Feather } from "@/components/Icon";
import * as WebBrowser from "expo-web-browser";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { STATUS_MAP, STATUS_ORDER } from "@/constants/status";
import { useColors } from "@/hooks/useColors";
import { useSubscription } from "@/lib/revenuecat";

export default function AboutScreen() {
  const colors = useColors();
  const { isPaid, resetTestUser, isLoading } = useSubscription();
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
      <View style={styles.legendList}>
        {STATUS_ORDER.map((code) => {
          const info = STATUS_MAP[code];
          return (
            <View key={code} style={styles.legendRow}>
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
  legendRow: { flexDirection: "row", alignItems: "center", gap: 12 },
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
  card: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  cardText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  footer: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 8,
  },
});
