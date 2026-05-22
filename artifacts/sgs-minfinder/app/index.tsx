import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function MinimalIndex() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>SGS MinFinder</Text>
      <Text style={styles.subtitle}>Diagnostic boot — no map</Text>
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
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    color: "#F4F1EA",
    fontSize: 14,
  },
});
