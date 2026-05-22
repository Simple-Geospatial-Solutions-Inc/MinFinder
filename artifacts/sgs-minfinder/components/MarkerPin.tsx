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
  },
  dot: {
    width: 56,
    height: 56,
    borderRadius: 28,
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
    fontSize: 16,
    letterSpacing: 0.4,
  },
  nameWrap: {
    marginTop: 4,
    backgroundColor: "rgba(14,36,68,0.92)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    maxWidth: 160,
  },
  nameText: {
    color: "#F4F1EA",
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
