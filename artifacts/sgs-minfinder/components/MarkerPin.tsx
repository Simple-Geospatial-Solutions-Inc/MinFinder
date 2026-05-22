import { StyleSheet, Text, View } from "react-native";

import { getStatusInfo } from "@/constants/status";

export function MarkerPin({
  code,
  selected,
  name,
  showName,
}: {
  code: string | null | undefined;
  selected?: boolean;
  name?: string | null;
  showName?: boolean;
}) {
  const info = getStatusInfo(code);
  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.dot,
          {
            backgroundColor: info.color,
            borderColor: selected ? "#FCBA19" : "rgba(255,255,255,0.95)",
            borderWidth: selected ? 4 : 3,
            transform: [{ scale: selected ? 1.15 : 1 }],
          },
        ]}
      >
        <Text style={styles.label}>{info.short}</Text>
      </View>
      {showName && name ? (
        <View style={styles.nameWrap}>
          <Text style={styles.nameText} numberOfLines={1}>
            {name}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    // A little padding so the drop-shadow isn't clipped by Android's bitmap
    // capture (which sizes the snapshot to the measured bounds).
    padding: 4,
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 4,
  },
  label: {
    color: "#fff",
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.3,
  },
  nameWrap: {
    marginTop: 3,
    backgroundColor: "rgba(14,36,68,0.92)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    maxWidth: 160,
  },
  nameText: {
    color: "#F4F1EA",
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
