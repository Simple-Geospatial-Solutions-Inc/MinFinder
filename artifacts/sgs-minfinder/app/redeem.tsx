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

import { Feather } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { useSubscription } from "@/lib/revenuecat";

/**
 * Where Google Play sends users to type a promo code. Android has no in-app
 * redemption sheet, so the best available flow is handing off to the Play
 * Store; iOS gets a native sheet without leaving the app.
 */
const PLAY_REDEEM_URL = "https://play.google.com/redeem";

type RedeemState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "opened" }
  | { kind: "error"; message: string };

/**
 * Entry point for redeeming a store offer code.
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

  const [state, setState] = useState<RedeemState>({ kind: "idle" });
  const busy = state.kind === "working";

  const redeem = useCallback(async () => {
    setState({ kind: "working" });
    try {
      if (Platform.OS === "ios") {
        const shown = await presentCodeRedemption();
        if (!shown) throw new Error("Redemption sheet unavailable");
      } else {
        const opened = await Linking.canOpenURL(PLAY_REDEEM_URL);
        if (!opened) throw new Error("Play Store unavailable");
        await Linking.openURL(PLAY_REDEEM_URL);
      }

      // The sheet gives no completion signal — it resolves as soon as it is
      // shown, whether or not a code was entered — so we can only re-read
      // entitlements and let the outcome speak for itself. The AppState
      // listener in SubscriptionProvider covers the Android hand-off, where
      // the user comes back from a different app entirely.
      setState({ kind: "opened" });
      await syncAfterGrant();
    } catch {
      setState({
        kind: "error",
        message:
          Platform.OS === "ios"
            ? "Couldn't open the redemption sheet. You can also redeem the code in the App Store: tap your profile picture, then Redeem Gift Card or Code."
            : "Couldn't open the Play Store. You can redeem the code in the Play Store app under Payments and subscriptions → Redeem code.",
      });
    }
  }, [presentCodeRedemption, syncAfterGrant]);

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

      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Pressable
          onPress={redeem}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.linkRow,
            { opacity: pressed || busy ? 0.6 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="gift" size={14} color={colors.primary} />
          )}
          <Text style={[styles.linkText, { color: colors.primary }]}>
            {Platform.OS === "ios" ? "Redeem a code" : "Redeem in Play Store"}
          </Text>
        </Pressable>

        {state.kind === "opened" && (
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Once the code is accepted, Pro unlocks automatically. If it hasn&apos;t
            appeared yet, reopen the app.
          </Text>
        )}

        {state.kind === "error" && (
          <Text style={[styles.note, { color: colors.destructive }]}>
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
  card: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
  cardText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  note: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16 },
});
