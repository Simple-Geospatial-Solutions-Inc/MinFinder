import { BottomSheetView } from "@gorhom/bottom-sheet";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GUTTER, IconButton, Notice, PillButton, Segmented, Sheet, type } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

type Mode = "true" | "magnetic";

export function CalibrationSheet({
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
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("true");

  const declinationKnown = declination != null && Number.isFinite(declination);
  const setDisabled = !headingReady || (mode === "magnetic" && !declinationKnown);

  return (
    <Sheet open={visible} backdrop enablePanDownToClose onClose={onClose}>
      <BottomSheetView style={[styles.content, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <Text style={[type.display, styles.title, { color: colors.foreground }]} accessibilityRole="header">
            Calibrate compass
          </Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>

        <Text style={[type.meta, { color: colors.mutedForeground }]}>
          Hold the phone flat and point the top edge at the reference direction below, then tap Set.
        </Text>

        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "true", label: "True north" },
            { value: "magnetic", label: "Magnetic north", disabled: !declinationKnown },
          ]}
        />

        {mode === "magnetic" && !declinationKnown && (
          <Notice icon="alert-triangle">
            Local declination not yet known. Move the phone briefly so a heading reading is captured, then try again.
          </Notice>
        )}

        <View style={styles.readings}>
          {mode === "magnetic" && declinationKnown && (
            <Text style={[type.meta, { color: colors.foreground }]}>
              Local declination{" "}
              <Text style={type.label}>
                {Math.abs(declination!).toFixed(1)}° {declination! >= 0 ? "E" : "W"}
              </Text>
            </Text>
          )}
          <Text style={[type.meta, { color: colors.mutedForeground }]}>
            {headingReady ? (
              <>
                Sensor reads{" "}
                <Text style={[type.label, styles.num, { color: colors.foreground }]}>{Math.round(rawHeading)}°</Text>
              </>
            ) : (
              "Waiting for the first heading reading…"
            )}
          </Text>
          {currentOffset !== 0 && (
            <Text style={[type.meta, { color: colors.mutedForeground }]}>
              Current offset <Text style={styles.num}>{currentOffset.toFixed(1)}°</Text>
            </Text>
          )}
        </View>

        <View style={styles.pair}>
          <PillButton label="Reset" variant="secondary" onPress={onClear} disabled={currentOffset === 0} />
          <PillButton
            label="Set heading"
            disabled={setDisabled}
            onPress={() => {
              if (setDisabled) return;
              onSet(mode === "true" ? 0 : ((declination ?? 0) + 360) % 360);
            }}
          />
        </View>
      </BottomSheetView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: GUTTER, paddingTop: 4, gap: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1 },
  readings: { gap: 4 },
  num: { fontVariant: ["tabular-nums"] },
  pair: { flexDirection: "row", gap: 8 },
});
