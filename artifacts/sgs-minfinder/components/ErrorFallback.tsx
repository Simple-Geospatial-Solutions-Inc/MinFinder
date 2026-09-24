import { reloadAppAsync } from "expo";
import React, { useState } from "react";
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GUTTER, IconButton, PillButton, radius, type } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
};

export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [isModalVisible, setIsModalVisible] = useState(false);

  const handleRestart = async () => {
    try {
      await reloadAppAsync();
    } catch (restartError) {
      console.error("Failed to restart app:", restartError);
      resetError();
    }
  };

  const formatErrorDetails = (): string => {
    let details = `Error: ${error.message}\n\n`;
    if (error.stack) {
      details += `Stack Trace:\n${error.stack}`;
    }
    return details;
  };

  const monoFont = Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {__DEV__ ? (
        <View style={[styles.topButton, { top: insets.top + 16 }]}>
          <IconButton icon="alert-circle" label="View error details" onPress={() => setIsModalVisible(true)} />
        </View>
      ) : null}

      <View style={styles.content}>
        <Text style={[type.display, styles.center, { color: colors.foreground }]} accessibilityRole="header">
          Something went wrong
        </Text>

        <Text style={[type.label, styles.center, { color: colors.mutedForeground }]}>
          Please reload the app to continue.
        </Text>

        <View style={styles.actions}>
          <PillButton label="Try again" onPress={handleRestart} />
        </View>
      </View>

      {/* An RN Modal, not the shared Sheet: this renders from the error boundary,
          outside GestureHandlerRootView, where a gesture-driven sheet can't run. */}
      {__DEV__ ? (
        <Modal
          visible={isModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setIsModalVisible(false)}
        >
          <View style={[styles.modalOverlay, { backgroundColor: colors.scrim }]}>
            <View style={[styles.modalContainer, { backgroundColor: colors.card }]}>
              <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
                  Error details
                </Text>
                <IconButton icon="x" label="Close error details" onPress={() => setIsModalVisible(false)} />
              </View>

              <ScrollView
                style={styles.modalScrollView}
                contentContainerStyle={[styles.modalScrollContent, { paddingBottom: insets.bottom + 16 }]}
                showsVerticalScrollIndicator
              >
                <View style={[styles.errorContainer, { backgroundColor: colors.muted }]}>
                  <Text style={[type.fine, { color: colors.foreground, fontFamily: monoFont }]} selectable>
                    {formatErrorDetails()}
                  </Text>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    padding: GUTTER,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    width: "100%",
    maxWidth: 600,
  },
  center: { textAlign: "center" },
  actions: { flexDirection: "row", width: "100%", maxWidth: 320 },
  topButton: { position: "absolute", right: 16, zIndex: 10 },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalContainer: {
    width: "100%",
    height: "90%",
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: GUTTER,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalScrollView: { flex: 1 },
  modalScrollContent: { padding: 16 },
  errorContainer: {
    width: "100%",
    borderRadius: radius.md,
    overflow: "hidden",
    padding: 16,
  },
});
