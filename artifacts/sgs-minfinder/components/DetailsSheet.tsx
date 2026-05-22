import { Feather } from "@/components/Icon";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { StatusBadge } from "@/components/StatusBadge";
import type { Occurrence } from "@/lib/db";
import { formatDMS } from "@/lib/geo";
import { useColors } from "@/hooks/useColors";

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  const colors = useColors();
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.rowValue,
          { color: colors.foreground, fontFamily: mono ? "Inter_500Medium" : "Inter_500Medium" },
        ]}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

export function DetailsSheet({
  occurrence,
  onClose,
}: {
  occurrence: Occurrence | null;
  onClose: () => void;
}) {
  const colors = useColors();
  const visible = !!occurrence;

  const officialUrl = occurrence?.MINFILNO
    ? `https://minfile.gov.bc.ca/Summary.aspx?minfilno=${encodeURIComponent(
        occurrence.MINFILNO.trim(),
      )}`
    : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.handle} />
          {occurrence && (
            <ScrollView contentContainerStyle={styles.content}>
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.title, { color: colors.foreground }]}
                    numberOfLines={2}
                  >
                    {occurrence.NAME1 || "Unnamed"}
                  </Text>
                  {!!occurrence.NAME2 && (
                    <Text
                      style={[
                        styles.subtitle,
                        { color: colors.mutedForeground },
                      ]}
                      numberOfLines={1}
                    >
                      {occurrence.NAME2}
                    </Text>
                  )}
                </View>
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.closeBtn,
                    { backgroundColor: colors.muted, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Feather name="x" size={18} color={colors.foreground} />
                </Pressable>
              </View>

              <View style={styles.badgeRow}>
                <StatusBadge code={occurrence.STATUS_C} />
                <View style={[styles.minfilnoChip, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.minfilnoText, { color: colors.foreground }]}>
                    {occurrence.MINFILNO?.trim()}
                  </Text>
                </View>
              </View>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => {
                    onClose();
                    router.push({
                      pathname: "/compass",
                      params: { id: String(occurrence.id) },
                    });
                  }}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    {
                      backgroundColor: colors.primary,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Feather name="navigation" size={18} color={colors.primaryForeground} />
                  <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                    Navigate
                  </Text>
                </Pressable>
                {officialUrl && (
                  <Pressable
                    onPress={() => {
                      WebBrowser.openBrowserAsync(officialUrl);
                    }}
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.background,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Feather name="external-link" size={18} color={colors.foreground} />
                    <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
                      Official record
                    </Text>
                  </Pressable>
                )}
              </View>

              <View
                style={[
                  styles.section,
                  { backgroundColor: colors.background, borderColor: colors.border },
                ]}
              >
                <Row label="Status" value={occurrence.STATUS_D} />
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
                  label="UTM (NAD27)"
                  value={
                    occurrence.UTM_ZONE
                      ? `Zone ${occurrence.UTM_ZONE} · E ${occurrence.UTM_EAST} · N ${occurrence.UTM_NORT}`
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
                <Row label="Host rock" value={occurrence.HOSTROCK} />
                <Row label="Deposit class" value={occurrence.DEPOSIT_CLASS} />
              </View>

              {officialUrl && (
                <Text
                  style={[styles.urlHint, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {officialUrl}
                </Text>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "85%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    paddingBottom: 24,
  },
  handle: {
    alignSelf: "center",
    marginTop: 8,
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(127,127,127,0.4)",
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  minfilnoChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  minfilnoText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    letterSpacing: 0.5,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
  },
  primaryBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  row: {
    gap: 2,
  },
  rowLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  rowValue: {
    fontSize: 14,
  },
  urlHint: {
    marginTop: 4,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
