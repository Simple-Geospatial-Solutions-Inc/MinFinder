import { Feather } from "@/components/Icon";
import React, { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

type Mode = "true" | "magnetic";

export function CalibrationModal({
  visible,
  rawHeading,
  declination,
  currentOffset,
  headingReady,
  onSet,
  onClear,
  onClose,
}: {
  visible: boolean;
  /** Latest uncorrected sensor heading, in degrees [0, 360). */
  rawHeading: number;
  /** Local magnetic declination = trueHeading - magneticHeading. May be null if unavailable. */
  declination: number | null;
  /** Currently applied offset, in degrees. 0 means no calibration. */
  currentOffset: number;
  /** True once at least one valid heading reading has been received. */
  headingReady: boolean;
  /** Called with the reference direction the user is pointing at: 0 for true north, or `declination` for magnetic north. */
  onSet: (referenceDegrees: number) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const [mode, setMode] = useState<Mode>("true");

  const declinationKnown = declination != null && Number.isFinite(declination);
  const setDisabled =
    !headingReady || (mode === "magnetic" && !declinationKnown);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Calibrate compass
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [
                styles.closeBtn,
                { backgroundColor: colors.muted, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name="x" size={16} color={colors.foreground} />
            </Pressable>
          </View>

          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            Hold the phone flat and point the top edge at the reference
            direction below, then tap Set.
          </Text>

          <View style={styles.tabs}>
            <ModeTab
              label="True north"
              active={mode === "true"}
              onPress={() => setMode("true")}
            />
            <ModeTab
              label="Magnetic north"
              active={mode === "magnetic"}
              onPress={() => setMode("magnetic")}
              disabled={!declinationKnown}
            />
          </View>

          {mode === "magnetic" && !declinationKnown && (
            <Text style={[styles.warn, { color: colors.mutedForeground }]}>
              Local declination not yet known — move the phone briefly so a
              heading reading is captured, then try again.
            </Text>
          )}

          {mode === "magnetic" && declinationKnown && (
            <Text style={[styles.declination, { color: colors.foreground }]}>
              Local declination:{" "}
              <Text style={{ fontFamily: "Inter_700Bold" }}>
                {Math.abs(declination!).toFixed(1)}°{" "}
                {declination! >= 0 ? "E" : "W"}
              </Text>
            </Text>
          )}

          <Text style={[styles.live, { color: colors.mutedForeground }]}>
            {headingReady
              ? `Sensor reads: ${Math.round(rawHeading)}°`
              : "Waiting for the first heading reading…"}
          </Text>

          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                if (setDisabled) return;
                const ref =
                  mode === "true" ? 0 : ((declination ?? 0) + 360) % 360;
                onSet(ref);
              }}
              disabled={setDisabled}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: setDisabled ? colors.muted : colors.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.primaryBtnText,
                  {
                    color: setDisabled
                      ? colors.mutedForeground
                      : colors.primaryForeground,
                  },
                ]}
              >
                Set
              </Text>
            </Pressable>
            <Pressable
              onPress={onClear}
              disabled={currentOffset === 0}
              style={({ pressed }) => [
                styles.secondaryBtn,
                {
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : currentOffset === 0 ? 0.4 : 1,
                },
              ]}
            >
              <Text
                style={[styles.secondaryBtnText, { color: colors.foreground }]}
              >
                Reset
              </Text>
            </Pressable>
          </View>

          {currentOffset !== 0 && (
            <Text style={[styles.currentOffset, { color: colors.mutedForeground }]}>
              Current calibration offset: {currentOffset.toFixed(1)}°
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ModeTab({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.tab,
        {
          backgroundColor: active ? colors.primary : colors.muted,
          opacity: pressed ? 0.85 : disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.tabText,
          {
            color: active ? colors.primaryForeground : colors.foreground,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
  tabs: {
    flexDirection: "row",
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  tabText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  declination: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  warn: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    fontStyle: "italic",
  },
  live: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    letterSpacing: 0.3,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
  },
  secondaryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  currentOffset: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    textAlign: "center",
  },
});
