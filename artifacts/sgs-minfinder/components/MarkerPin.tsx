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
          styles.pin,
          {
            backgroundColor: info.color,
            borderColor: selected ? "#FCBA19" : "rgba(255,255,255,0.95)",
            borderWidth: selected ? 3 : 2.5,
            transform: [{ scale: selected ? 1.15 : 1 }],
          },
        ]}
      >
        <Text style={styles.label}>{info.short}</Text>
      </View>
      <View style={[styles.tail, { borderTopColor: info.color }]} />
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
  },
  pin: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 5,
  },
  label: {
    color: "#fff",
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    letterSpacing: 0.3,
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },
  nameWrap: {
    marginTop: 3,
    backgroundColor: "rgba(14,36,68,0.92)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    maxWidth: 140,
  },
  nameText: {
    color: "#F4F1EA",
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    letterSpacing: 0.2,
  },
});
