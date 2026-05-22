import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function IndexWeb() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>SGS MinFinder</Text>
      <Text style={styles.subtitle}>
        This is a mobile app. Open it in Expo Go on iOS or Android to use the
        map.
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
