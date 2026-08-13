import { Feather } from "@/components/Icon";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { useSubscription } from "@/lib/revenuecat";

type PurchasesPackage = import("react-native-purchases").PurchasesPackage;

const PACKAGE_PRIORITY: Record<string, number> = {
  $rc_lifetime: 0,
  $rc_annual: 1,
  $rc_monthly: 2,
};

function packageLabel(pkg: PurchasesPackage): string {
  switch (pkg.identifier) {
    case "$rc_lifetime":
      return "Lifetime";
    case "$rc_annual":
      return "Yearly";
    case "$rc_monthly":
      return "Monthly";
    default:
      return pkg.product.title || pkg.identifier;
  }
}

function packageSubtitle(pkg: PurchasesPackage): string {
  if (pkg.identifier === "$rc_lifetime") return "One-time payment";
  if (pkg.identifier === "$rc_annual") return "Billed yearly";
  if (pkg.identifier === "$rc_monthly") return "Billed monthly";
  return "";
}

/**
 * Paywall shown when a free user taps a premium feature. Pulls live packages
 * from the current RevenueCat offering and routes purchase / restore through
 * the SubscriptionProvider; entitlement state propagates automatically.
 */
export function PaywallSheet({
  visible,
  feature,
  onClose,
}: {
  visible: boolean;
  /** Short label for the feature the user tried to use, e.g. "Navigate" or "Full details". */
  feature: string;
  onClose: () => void;
}) {
  const colors = useColors();
  const {
    offering,
    purchase,
    restore,
    isLoading,
    isReady,
    appUserId,
    refresh,
    resetTestUser,
  } = useSubscription();
  const [copied, setCopied] = useState(false);

  const packages = useMemo<PurchasesPackage[]>(() => {
    if (!offering) return [];
    return [...offering.availablePackages].sort(
      (a, b) =>
        (PACKAGE_PRIORITY[a.identifier] ?? 99) -
        (PACKAGE_PRIORITY[b.identifier] ?? 99),
    );
  }, [offering]);

  const handlePurchase = async (pkg: PurchasesPackage) => {
    const ok = await purchase(pkg);
    if (ok) onClose();
  };

  const handleRestore = async () => {
    const ok = await restore();
    if (ok) onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: colors.gold + "22" }]}>
              <Feather name="lock" size={18} color={colors.gold} />
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              disabled={isLoading}
              style={({ pressed }) => [
                styles.closeBtn,
                {
                  backgroundColor: colors.muted,
                  opacity: pressed || isLoading ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="x" size={16} color={colors.foreground} />
            </Pressable>
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            {feature} is a premium feature
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            Upgrade to MinFinder Pro to unlock navigation, full occurrence
            details, and more.
          </Text>

          {!isReady ? (
            <View style={styles.loaderRow}>
              <ActivityIndicator color={colors.gold} />
            </View>
          ) : packages.length === 0 ? (
            <Text
              style={[
                styles.emptyText,
                { color: colors.mutedForeground, borderColor: colors.border },
              ]}
            >
              No subscription options available right now. Please try again
              later.
            </Text>
          ) : (
            <ScrollView
              style={styles.packageList}
              contentContainerStyle={{ gap: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {packages.map((pkg) => (
                <Pressable
                  key={pkg.identifier}
                  onPress={() => handlePurchase(pkg)}
                  disabled={isLoading}
                  style={({ pressed }) => [
                    styles.packageRow,
                    {
                      borderColor: colors.gold,
                      backgroundColor: pressed
                        ? colors.gold + "1A"
                        : "transparent",
                      opacity: isLoading ? 0.6 : 1,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.pkgTitle, { color: colors.foreground }]}
                    >
                      {packageLabel(pkg)}
                    </Text>
                    <Text
                      style={[
                        styles.pkgSubtitle,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {packageSubtitle(pkg)}
                    </Text>
                  </View>
                  <Text style={[styles.pkgPrice, { color: colors.foreground }]}>
                    {pkg.product.priceString}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {isLoading && (
            <View style={styles.loaderRow}>
              <ActivityIndicator color={colors.gold} />
            </View>
          )}

          <Pressable
            onPress={handleRestore}
            hitSlop={6}
            disabled={isLoading}
            style={styles.secondaryBtn}
          >
            <Text
              style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}
            >
              Restore purchases
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              // Dismiss before navigating: this sheet is a Modal, and pushing a
              // route out from under an open Modal leaves the navigation stack
              // and the overlay fighting each other on Android.
              onClose();
              router.push("/redeem");
            }}
            hitSlop={6}
            disabled={isLoading}
            style={styles.secondaryBtn}
          >
            <Text
              style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}
            >
              Have a promo code?
            </Text>
          </Pressable>

          <Text style={[styles.disclosure, { color: colors.mutedForeground }]}>
            Monthly and yearly plans are auto-renewing subscriptions that renew
            unless cancelled at least 24 hours before the end of the current
            period, billed through your app store account. Lifetime is a
            one-time purchase. Manage or cancel anytime in your account settings.
          </Text>

          <View style={styles.legalRow}>
            <Pressable
              onPress={() =>
                WebBrowser.openBrowserAsync(
                  "https://sgss.ca/mobile-apps/minfinder/privacy",
                )
              }
              hitSlop={6}
            >
              <Text style={[styles.legalLink, { color: colors.mutedForeground }]}>
                Privacy Policy
              </Text>
            </Pressable>
            <Text style={[styles.legalDot, { color: colors.mutedForeground }]}>
              ·
            </Text>
            <Pressable
              onPress={() =>
                WebBrowser.openBrowserAsync(
                  "https://sgss.ca/mobile-apps/minfinder/terms",
                )
              }
              hitSlop={6}
            >
              <Text style={[styles.legalLink, { color: colors.mutedForeground }]}>
                Terms of Use (EULA)
              </Text>
            </Pressable>
          </View>

          {__DEV__ && appUserId && (
            <View style={[styles.debugBox, { borderColor: colors.border }]}>
              <Text style={[styles.debugLabel, { color: colors.mutedForeground }]}>
                Dev · App User ID (for RC test purchase)
              </Text>
              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(appUserId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <Text
                  selectable
                  style={[styles.debugId, { color: colors.foreground }]}
                >
                  {appUserId}
                </Text>
                <Text style={[styles.debugHint, { color: colors.gold }]}>
                  {copied ? "Copied!" : "Tap to copy"}
                </Text>
              </Pressable>
              <Pressable
                onPress={refresh}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.debugRefresh,
                  { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text
                  style={[styles.debugHint, { color: colors.mutedForeground }]}
                >
                  Refresh customer info
                </Text>
              </Pressable>
              <Pressable
                onPress={resetTestUser}
                disabled={isLoading}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.debugRefresh,
                  {
                    borderColor: colors.border,
                    opacity: pressed || isLoading ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.debugHint, { color: colors.gold }]}>
                  Start fresh test user (reset purchases)
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 18 },
  body: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  packageList: { maxHeight: 240 },
  packageRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 8,
  },
  pkgTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  pkgSubtitle: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  pkgPrice: { fontFamily: "Inter_700Bold", fontSize: 15 },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    textAlign: "center",
  },
  loaderRow: { alignItems: "center", paddingVertical: 6 },
  secondaryBtn: { paddingVertical: 8, alignItems: "center" },
  secondaryBtnText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  disclosure: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
  },
  legalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 2,
  },
  legalLink: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    textDecorationLine: "underline",
  },
  legalDot: { fontFamily: "Inter_400Regular", fontSize: 11 },
  debugBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 10,
    gap: 6,
    marginTop: 4,
  },
  debugLabel: { fontFamily: "Inter_500Medium", fontSize: 11 },
  debugId: { fontFamily: "Inter_400Regular", fontSize: 11 },
  debugHint: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 4 },
  debugRefresh: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    alignItems: "center",
  },
});
