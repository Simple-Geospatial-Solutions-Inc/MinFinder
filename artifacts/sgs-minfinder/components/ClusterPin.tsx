import { StyleSheet, Text, View } from "react-native";

import { getStatusInfo } from "@/constants/status";

export function ClusterPin({
  count,
  dominantStatus,
  mixed,
}: {
  count: number;
  dominantStatus: string | null;
  mixed: boolean;
}) {
  const color = mixed
    ? "#16365C"
    : dominantStatus
      ? getStatusInfo(dominantStatus).color
      : "#16365C";
  // Size by count (capped).
  const size =
    count < 10 ? 36 : count < 50 ? 42 : count < 200 ? 50 : count < 1000 ? 58 : 66;
  const fontSize = size < 42 ? 12 : size < 52 ? 13 : 15;
  const display =
    count < 1000 ? String(count) : count < 1_000_000 ? `${Math.round(count / 100) / 10}k` : `${Math.round(count / 100_000) / 10}M`;

  return (
    <View
      style={[
        styles.outer,
        {
          width: size + 10,
          height: size + 10,
          borderRadius: (size + 10) / 2,
          backgroundColor: `${color}55`,
        },
      ]}
    >
      <View
        style={[
          styles.inner,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
          },
        ]}
      >
        <Text style={[styles.text, { fontSize }]} numberOfLines={1}>
          {display}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    alignItems: "center",
    justifyContent: "center",
  },
  inner: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.95)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  text: {
    color: "#fff",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },
});
