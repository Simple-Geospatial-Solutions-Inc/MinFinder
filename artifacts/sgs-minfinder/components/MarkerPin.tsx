import { StyleSheet, Text, View } from "react-native";

import { getStatusInfo } from "@/constants/status";

// Fixed bitmap dimensions so Android's marker snapshot captures the full
// custom view (dot + halo + drop shadow) on the first layout pass. The
// dot is centred inside the wrap so anchor=(0.5, 0.5) places the dot on
// the GPS point.
export const PIN_SIZE = 44;

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
          styles.dot,
          {
            backgroundColor: info.color,
            borderColor: selected ? "#FCBA19" : "rgba(255,255,255,0.95)",
            borderWidth: selected ? 4 : 3,
          },
        ]}
      >
        <Text style={styles.label}>{info.short}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 5,
  },
  label: {
    color: "#fff",
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    letterSpacing: 0.3,
  },
});
