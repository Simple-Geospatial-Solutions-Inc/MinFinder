import React from "react";
import { StyleSheet, View } from "react-native";

import { Feather } from "@/components/Icon";
import { EmptyState, GUTTER } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export default function IndexWeb() {
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <EmptyState
        glyph={<Feather name="map" size={32} color={colors.foreground} />}
        title="SGS MinFinder"
        body="This is a mobile app. Open it on iOS or Android to use the map."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: GUTTER },
});
