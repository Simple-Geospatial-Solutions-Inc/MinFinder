import { router, Stack } from "expo-router";
import { StyleSheet, View } from "react-native";

import { Feather } from "@/components/Icon";
import { EmptyState, GUTTER, PillButton } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export default function NotFoundScreen() {
  const colors = useColors();

  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <EmptyState
          glyph={<Feather name="map-pin" size={32} color={colors.foreground} />}
          title="This screen doesn't exist."
          body="The link may be out of date."
        >
          <View style={styles.actions}>
            <PillButton label="Back to the map" onPress={() => router.replace("/")} />
          </View>
        </EmptyState>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: GUTTER },
  actions: { flexDirection: "row" },
});
