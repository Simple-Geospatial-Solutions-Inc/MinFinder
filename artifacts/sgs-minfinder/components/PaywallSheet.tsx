import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Feather } from "@/components/Icon";
import { GUTTER, IconButton, ListRow, ListSection, radius, Sheet, TextButton, type, useLast } from "@/components/ui";
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
 *
 * A bottom sheet sized to its content. The renewal disclosure and the legal
 * links sit in the scroll body with the plans, never behind a tap, as the
 * stores require.
 */
export function PaywallSheet({
  visible,
  feature: current,
  onClose,
}: {
  visible: boolean;
  /** What the user tried to use, as it reads after "Unlock": "navigation", "full details". */
  feature: string;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { offering, purchase, restore, isLoading, isReady, appUserId, refresh, resetTestUser } = useSubscription();
  const [copied, setCopied] = useState(false);
  // Held through the close animation.
  const feature = useLast(visible ? current : null);

  const packages = useMemo<PurchasesPackage[]>(() => {
    if (!offering) return [];
    return [...offering.availablePackages].sort(
      (a, b) => (PACKAGE_PRIORITY[a.identifier] ?? 99) - (PACKAGE_PRIORITY[b.identifier] ?? 99),
    );
  }, [offering]);

  if (feature == null) return null;

  const handlePurchase = async (pkg: PurchasesPackage) => {
    const ok = await purchase(pkg);
    if (ok) onClose();
  };

  const handleRestore = async () => {
    const ok = await restore();
    if (ok) onClose();
  };

  return (
    <Sheet
      open={visible}
      backdrop
      enablePanDownToClose={!isLoading}
      topInset={insets.top}
      onClose={onClose}
    >
      <BottomSheetScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <View style={[styles.badge, { backgroundColor: colors.warningSubtle }]}>
            <Feather name="lock" size={18} color={colors.warning} />
          </View>
          <IconButton icon="x" label="Close" onPress={() => !isLoading && onClose()} />
        </View>

        <View style={styles.intro}>
          <Text style={[type.display, { color: colors.foreground }]} accessibilityRole="header">
            Unlock {feature}
          </Text>
          <Text style={[type.meta, { color: colors.mutedForeground }]}>
            MinFinder Pro adds compass navigation to any mine, its full geology and coordinates, and the exact points
            other visitors have marked.
          </Text>
        </View>

        {!isReady ? (
          <ActivityIndicator color={colors.foreground} style={styles.loader} />
        ) : packages.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.muted }]}>
            <Text style={[type.meta, { color: colors.foreground }]}>
              Couldn't load the plans. They need a connection to the app store: try again when you have signal.
            </Text>
          </View>
        ) : (
          <ListSection title="Choose a plan">
            {packages.map((pkg) => (
              <ListRow
                key={pkg.identifier}
                onPress={() => !isLoading && void handlePurchase(pkg)}
                accessibilityLabel={`${packageLabel(pkg)}, ${pkg.product.priceString}, ${packageSubtitle(pkg)}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[type.label, { color: colors.foreground }]}>{packageLabel(pkg)}</Text>
                  {!!packageSubtitle(pkg) && (
                    <Text style={[type.meta, { color: colors.mutedForeground }]}>{packageSubtitle(pkg)}</Text>
                  )}
                </View>
                <Text style={[type.label, styles.price, { color: colors.foreground }]}>{pkg.product.priceString}</Text>
              </ListRow>
            ))}
          </ListSection>
        )}

        {isLoading && (
          <View style={styles.busy} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.foreground} />
            <Text style={[type.meta, { color: colors.mutedForeground }]}>Waiting for the app store…</Text>
          </View>
        )}

        <View style={styles.links}>
          <TextButton label="Restore purchases" onPress={() => !isLoading && void handleRestore()} />
          <TextButton
            label="Have a promo code?"
            onPress={() => {
              if (isLoading) return;
              onClose();
              router.push("/redeem");
            }}
          />
        </View>

        <View style={styles.fine}>
          <Text style={[type.fine, { color: colors.mutedForeground }]}>
            Monthly and yearly plans are auto-renewing subscriptions that renew unless cancelled at least 24 hours
            before the end of the current period, billed through your app store account. Lifetime is a one-time
            purchase. Manage or cancel anytime in your account settings.
          </Text>
          <View style={styles.legalRow}>
            <TextButton
              label="Privacy Policy"
              accessibilityRole="link"
              onPress={() => void WebBrowser.openBrowserAsync("https://sgss.ca/mobile-apps/minfinder/privacy")}
            />
            <TextButton
              label="Terms of Use (EULA)"
              accessibilityRole="link"
              onPress={() => void WebBrowser.openBrowserAsync("https://sgss.ca/mobile-apps/minfinder/terms")}
            />
          </View>
        </View>

        {__DEV__ && appUserId && (
          <View style={[styles.debugBox, { borderColor: colors.border }]}>
            <Text style={[type.fine, { color: colors.mutedForeground }]}>Dev · App User ID (for RC test purchase)</Text>
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(appUserId);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              accessibilityRole="button"
              accessibilityLabel="Copy App User ID"
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Text selectable style={[type.fine, { color: colors.foreground }]}>
                {appUserId}
              </Text>
              <Text style={[type.fine, { color: colors.primary }]}>{copied ? "Copied!" : "Tap to copy"}</Text>
            </Pressable>
            <TextButton label="Refresh customer info" onPress={refresh} />
            <TextButton label="Start fresh test user (reset purchases)" onPress={resetTestUser} />
          </View>
        )}
      </BottomSheetScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: GUTTER, paddingTop: 4, gap: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  intro: { gap: 6 },
  busy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  loader: { paddingVertical: 8 },
  empty: { borderRadius: radius.md, padding: 16 },
  price: { fontVariant: ["tabular-nums"] },
  links: { flexDirection: "row", flexWrap: "wrap", columnGap: 24 },
  fine: { gap: 4 },
  legalRow: { flexDirection: "row", flexWrap: "wrap", columnGap: 24 },
  debugBox: { borderWidth: 1, borderStyle: "dashed", borderRadius: radius.md, padding: 12, gap: 4 },
});
