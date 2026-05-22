import { StyleSheet, Text, View } from "react-native";

import { getStatusInfo } from "@/constants/status";

export function StatusBadge({
  code,
  size = "md",
}: {
  code: string | null | undefined;
  size?: "sm" | "md";
}) {
  const info = getStatusInfo(code);
  const isSmall = size === "sm";
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: info.color,
          paddingHorizontal: isSmall ? 6 : 10,
          paddingVertical: isSmall ? 2 : 4,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          { fontSize: isSmall ? 11 : 12 },
        ]}
        numberOfLines={1}
      >
        {info.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  text: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
});
