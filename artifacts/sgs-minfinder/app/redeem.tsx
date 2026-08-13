import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import * as Updates from "expo-updates";

import { Feather } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { useSubscription } from "@/lib/revenuecat";

/**
 * Where Google Play sends users to type a promo code. Android has no in-app
 * redemption sheet, so the best available flow is handing off to the Play
 * Store; iOS gets a native sheet without leaving the app.
 */
const PLAY_REDEEM_URL = "https://play.google.com/redeem";

/**
 * The App Store's own redemption page. Not a fallback — it is the only route
 * for lifetime codes. StoreKit's in-app sheet handles subscription offer codes
 * exclusively, and silently rejects the promo codes issued against a
 * non-consumable.
 */
const APP_STORE_REDEEM_URL = "https://apps.apple.com/redeem";

/**
 * Which kind of code the user holds. This only matters on iOS, where Apple
 * splits redemption across two mechanisms that accept different codes and live
 * in different places. Android's Play Store takes both through one page, so the
 * choice is hidden there rather than asking a question with one answer.
 */
type CodeKind = "subscription" | "lifetime";

type RedeemState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "opened" }
  | { kind: "unlocked" }
  | { kind: "error"; message: string };

/**
 * Entry point for redeeming a store code.
 *
 * Redemption itself happens in the App Store or Play Store, not here — codes
 * are issued in App Store Connect / Play Console and the store applies the
 * purchase to the user's account. RevenueCat then reports the entitlement
 * through the normal `CustomerInfo` path, so nothing about gating changes.
 *
 * The upside of letting the store own this: the entitlement is tied to the
 * user's store account rather than this install, so it survives reinstalls and
 * follows them to a new device, and each code can only be used once.
 */
export default function RedeemScreen() {
  const colors = useColors();
  const { isPaid, syncAfterGrant, presentCodeRedemption } = useSubscription();

  const [codeKind, setCodeKind] = useState<CodeKind>("subscription");
  const [state, setState] = useState<RedeemState>({ kind: "idle" });
  // "opened" keeps the spinner running: the sheet has closed but we are still
  // waiting on the store to reach RevenueCat, which is the part that takes time.
  const busy = state.kind === "working" || state.kind === "opened";

  const selectKind = useCallback((next: CodeKind) => {
    setCodeKind(next);
    // A result from the other route would read as though it applied to this one.
    setState({ kind: "idle" });
  }, []);

  const redeem = useCallback(async () => {
    setState({ kind: "working" });
    try {
      if (Platform.OS !== "ios") {
        const canOpen = await Linking.canOpenURL(PLAY_REDEEM_URL);
        if (!canOpen) throw new Error("Play Store unavailable");
        await Linking.openURL(PLAY_REDEEM_URL);
      } else if (codeKind === "lifetime") {
        await Linking.openURL(APP_STORE_REDEEM_URL);
      } else {
        // Dispatch-only: the native method takes no callback, so this resolves
        // whether or not a sheet ever appears.
        const dispatched = await presentCodeRedemption();
        if (!dispatched) throw new Error("Redemption sheet unavailable");
      }

      // Nothing above reports whether a code was actually entered — the sheet
      // resolves as soon as it is shown, and a browser hand-off tells us even
      // less. So we re-read entitlements and let the outcome speak for itself.
      setState({ kind: "opened" });

      if (await syncAfterGrant()) {
        // Context alone would unlock every gate, but screens the user already
        // visited keep whatever they derived at mount — the map still drawing
        // locks over a live entitlement is the confusing part. Restarting
        // rebuilds all of them against the granted entitlement at once.
        setState({ kind: "unlocked" });
        await new Promise((r) => setTimeout(r, 1200));
        try {
          await Updates.reloadAsync();
        } catch (err) {
          // Reload is unavailable when updates are disabled (notably in Expo
          // Go). The entitlement is live either way, so this is cosmetic.
          console.warn("[Redeem] reload after unlock failed:", err);
        }
      }
    } catch {
      setState({
        kind: "error",
        message:
          Platform.OS !== "ios"
            ? "Couldn't open the Play Store. You can redeem the code in the Play Store app under Payments and subscriptions → Redeem code."
            : "Couldn't open the App Store. You can redeem the code there directly: tap your profile picture, then Redeem Gift Card or Code.",
      });
    }
  }, [codeKind, presentCodeRedemption, syncAfterGrant]);

  const isLifetime = Platform.OS === "ios" && codeKind === "lifetime";
  const actionLabel =
    Platform.OS !== "ios"
      ? "Redeem in Play Store"
      : isLifetime
        ? "Redeem in the App Store"
        : "Redeem a code";

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.scroll}
    >
      {isPaid ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardText, { color: colors.foreground }]}>
            MinFinder Pro is already active on this device.
          </Text>
        </View>
      ) : null}

      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        Have a code for MinFinder Pro? Redeeming it unlocks compass navigation
        and full occurrence details.
      </Text>

      {Platform.OS === "ios" && (
        <View
          style={[
            styles.segment,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          {(
            [
              { key: "subscription", label: "Monthly or annual" },
              { key: "lifetime", label: "Lifetime" },
            ] as const
          ).map((tab) => {
            const selected = codeKind === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => selectKind(tab.key)}
                disabled={busy}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.segmentItem,
                  selected && { backgroundColor: colors.primary },
                  { opacity: pressed && !selected ? 0.6 : 1 },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    {
                      color: selected
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.cardText, { color: colors.foreground }]}>
          {Platform.OS !== "ios"
            ? "Codes are redeemed in the Play Store"
            : isLifetime
              ? "Lifetime codes are redeemed in the App Store"
              : "Subscription codes are redeemed here"}
        </Text>

        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {Platform.OS !== "ios"
            ? "The Play Store accepts every kind of MinFinder code. You'll come straight back once it's applied."
            : isLifetime
              ? "A code that unlocks Pro permanently only works on the App Store's redemption page, not the sheet inside apps. Come back here once it's accepted."
              : "A code for a free month, several months, or a year opens a sheet without leaving MinFinder."}
        </Text>

        <Pressable
          onPress={redeem}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.actionBtn,
            {
              backgroundColor: colors.primary,
              opacity: pressed || busy ? 0.6 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Feather
              name={isLifetime ? "external-link" : "gift"}
              size={16}
              color={colors.primaryForeground}
            />
          )}
          <Text
            style={[styles.actionText, { color: colors.primaryForeground }]}
          >
            {actionLabel}
          </Text>
        </Pressable>

        {state.kind === "opened" && (
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            Checking for your code&hellip; this can take up to a minute. If Pro
            hasn&apos;t appeared by then, reopen the app.
          </Text>
        )}

        {state.kind === "unlocked" && (
          <Text style={[styles.body, { color: colors.foreground }]}>
            MinFinder Pro is active. Restarting&hellip;
          </Text>
        )}

        {state.kind === "error" && (
          <Text style={[styles.body, { color: colors.destructive }]}>
            {state.message}
          </Text>
        )}
      </View>

      <Text style={[styles.note, { color: colors.mutedForeground }]}>
        Codes are redeemed through your{" "}
        {Platform.OS === "ios" ? "Apple" : "Google"} account, so Pro stays with
        you if you reinstall MinFinder or move to a new device. Redeeming needs
        an internet connection; everything else works offline.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, gap: 16, paddingBottom: 40 },
  body: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 10 },
  cardText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  segment: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    textAlign: "center",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 2,
  },
  actionText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  note: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
});
