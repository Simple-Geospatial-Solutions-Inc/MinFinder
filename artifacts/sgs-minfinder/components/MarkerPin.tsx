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
  const wide = !!(showName && name);
  return (
    <View style={[styles.wrap, wide && styles.wrapWide]}>
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
    // Fixed bitmap dimensions so Android captures the full custom view
    // (dot + drop shadow) before the snapshot is taken. Without explicit
    // size the snapshot can be clipped or mis-anchored.
    width: 40,
    height: 40,
    paddingTop: 4,
  },
  wrapWide: {
    // When a name label is shown, reserve enough width AND height up-front
    // so the bitmap captures the full label. Keep top padding the same so
    // the dot stays at a known offset (used by the anchor below).
    width: 200,
    height: 68,
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
