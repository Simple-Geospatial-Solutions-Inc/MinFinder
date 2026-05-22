import { StyleSheet, Text, View } from "react-native";

import { getStatusInfo } from "@/constants/status";

export function MarkerPin({
  code,
  selected,
}: {
  code: string | null | undefined;
  selected?: boolean;
}) {
  const info = getStatusInfo(code);
  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.pin,
          {
            backgroundColor: info.color,
            borderColor: selected ? "#FCBA19" : "rgba(255,255,255,0.95)",
            borderWidth: selected ? 3 : 2,
            transform: [{ scale: selected ? 1.15 : 1 }],
          },
        ]}
      >
        <Text style={styles.label}>{info.short}</Text>
      </View>
      <View style={[styles.tail, { borderTopColor: info.color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
  },
  pin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  label: {
    color: "#fff",
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.3,
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },
});
