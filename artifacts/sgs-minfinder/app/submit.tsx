import { router, Stack } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, BackHandler, Pressable, StyleSheet, View } from "react-native";

import { DetailsStep } from "@/components/capture/DetailsStep";
import { useLiveFix, type LiveFix } from "@/components/capture/gps";
import { MarkStep, type LatLon } from "@/components/capture/MarkStep";
import { Feather } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";

/**
 * Add a mine, in two steps: mark the spot on the map, then say what's there.
 * The GPS watch lives here so it runs across both steps, and the details step
 * stays mounted while the user goes back to adjust the pin, so nothing typed or
 * photographed is lost.
 */
export default function SubmitScreen() {
  const colors = useColors();
  const { fix, state } = useLiveFix();
  const [step, setStep] = useState<"mark" | "details">("mark");
  const [marked, setMarked] = useState<{ pin: LatLon; at: LiveFix } | null>(null);

  // Once there's something to lose, leaving asks first. Photos and typing live
  // only in this screen until Save.
  const leave = useCallback(() => {
    if (!marked) return router.back();
    Alert.alert("Discard this mine?", "The pin and anything you've added will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  }, [marked]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (step === "details") setStep("mark");
      else leave();
      return true;
    });
    return () => sub.remove();
  }, [step, leave]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: step === "details",
          title: "Mine details",
          // A swipe would drop the capture without asking.
          gestureEnabled: false,
          headerLeft: () => (
            <Pressable
              onPress={() => setStep("mark")}
              accessibilityRole="button"
              accessibilityLabel="Back to the pin"
              hitSlop={12}
              style={styles.headerBtn}
            >
              <Feather name="chevron-left" size={26} color={colors.gold} />
            </Pressable>
          ),
        }}
      />
      {step === "mark" && (
        <MarkStep
          fix={fix}
          gps={state}
          startAt={marked?.pin ?? null}
          onMark={(pin, at) => {
            setMarked({ pin, at });
            setStep("details");
          }}
          onClose={leave}
        />
      )}
      {marked && (
        <View style={[styles.root, step !== "details" && styles.hidden]}>
          <DetailsStep
            pin={marked.pin}
            markedAt={marked.at}
            fix={fix}
            gps={state}
            onAdjust={() => setStep("mark")}
            onSaved={() => router.replace("/my-submissions")}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hidden: { display: "none" },
  headerBtn: { minWidth: 44, minHeight: 44, justifyContent: "center" },
});
