import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function OfflineWeb() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Offline maps</Text>
      <Text style={styles.subtitle}>
        Offline tile downloads are only available in the mobile app.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0E2444",
    padding: 24,
  },
  title: {
    color: "#E5C76B",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    color: "#F4F1EA",
    fontSize: 14,
    textAlign: "center",
    maxWidth: 320,
  },
});
