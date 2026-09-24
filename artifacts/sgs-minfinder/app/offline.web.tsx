import React from "react";
import { StyleSheet, View } from "react-native";

import { Feather } from "@/components/Icon";
import { EmptyState, GUTTER } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export default function OfflineWeb() {
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <EmptyState
        glyph={<Feather name="map" size={32} color={colors.foreground} />}
        title="Offline maps"
        body="Offline tile downloads are only available in the mobile app."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: GUTTER },
});
