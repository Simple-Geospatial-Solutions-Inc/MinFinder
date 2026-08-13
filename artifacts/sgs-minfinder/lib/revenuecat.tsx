import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState, Platform } from "react-native";

// Must exactly match the entitlement identifier configured in RevenueCat
// (Dashboard → Entitlements). It is the key under info.entitlements.active.
const ENTITLEMENT_ID = "SGS MinFinder Pro";
// RevenueCat uses platform-specific public SDK keys: Apple keys start with
// `appl_`, Google keys with `goog_`. iOS keeps the original env var so the
// existing build config is untouched; Android reads its own `goog_` key.
const API_KEY =
  (Platform.OS === "android"
    ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_API_KEY) ?? "";

type Purchases = typeof import("react-native-purchases").default;
type CustomerInfo = import("react-native-purchases").CustomerInfo;
type PurchasesOffering = import("react-native-purchases").PurchasesOffering;
type PurchasesPackage = import("react-native-purchases").PurchasesPackage;

let purchasesModule: Purchases | null = null;
function getPurchases(): Purchases | null {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  if (purchasesModule) return purchasesModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    purchasesModule = require("react-native-purchases").default as Purchases;
    return purchasesModule;
  } catch {
    return null;
  }
}

type SubscriptionState = {
  isPaid: boolean;
  isReady: boolean;
  isLoading: boolean;
  customerInfo: CustomerInfo | null;
  offering: PurchasesOffering | null;
  appUserId: string | null;
  purchase: (pkg: PurchasesPackage) => Promise<boolean>;
  restore: () => Promise<boolean>;
  refresh: () => Promise<void>;
  /**
   * Discards the SDK's cached CustomerInfo and re-reads it from RevenueCat,
   * polling briefly until `isPaid` turns true.
   *
   * Used after redeeming a promo code: the entitlement is granted by our server
   * over the REST API, so this device has no idea anything changed, and the
   * cached CustomerInfo would otherwise keep reporting free. RevenueCat's read
   * path can also lag a write by a beat, hence the retries.
   *
   * Resolves true once the entitlement is visible, false if it never appeared.
   */
  syncAfterGrant: () => Promise<boolean>;
  /**
   * Opens the App Store's code redemption sheet (iOS only).
   *
   * Resolves true once the sheet has been shown — StoreKit reports nothing
   * about whether a code was actually entered, so callers must re-read
   * entitlements rather than treating this as a success signal. Returns false
   * where the sheet is unavailable, which is every non-iOS platform.
   */
  presentCodeRedemption: () => Promise<boolean>;
  /**
   * DEV ONLY. Switches to a brand-new random RevenueCat user so the current
   * entitlement/purchase is cleared, letting you re-run the purchase flow
   * without touching the dashboard or reinstalling. No-op outside __DEV__.
   */
  resetTestUser: () => Promise<void>;
};

const SubscriptionContext = createContext<SubscriptionState | null>(null);

function entitlementActive(info: CustomerInfo | null): boolean {
  if (!info) return false;
  return info.entitlements.active[ENTITLEMENT_ID] != null;
}

export function SubscriptionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [appUserId, setAppUserId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const Purchases = getPurchases();
    if (!Purchases || !API_KEY) {
      if (Purchases && !API_KEY) {
        // The native module is present but the key is empty. This happens when
        // EXPO_PUBLIC_REVENUECAT_API_KEY was not defined in the environment that
        // built/bundled the JS (e.g. an EAS build with no `env` block in
        // eas.json) — the value is inlined at build time, so it silently
        // becomes "". Without this warning the paywall just shows no products.
        console.warn(
          "[RevenueCat] EXPO_PUBLIC_REVENUECAT_API_KEY is empty — RevenueCat " +
            "is not configured and no offerings will load. Set it in the build " +
            "environment (eas.json `env`) and rebuild.",
        );
      }
      setIsReady(true);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        // LOG_LEVEL is exported from the module root; require lazily to avoid web crash.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { LOG_LEVEL } = require("react-native-purchases");
        Purchases.setLogLevel(LOG_LEVEL.WARN);
        await Purchases.configure({ apiKey: API_KEY });

        const [info, offerings, appUserId] = await Promise.all([
          Purchases.getCustomerInfo(),
          Purchases.getOfferings(),
          Purchases.getAppUserID(),
        ]);
        if (cancelled) return;
        setCustomerInfo(info);
        setOffering(offerings.current ?? null);
        setAppUserId(appUserId);
        console.log("[RevenueCat] App User ID:", appUserId);
        if (__DEV__) {
          const cur = offerings.current;
          console.log(
            "[RevenueCat] current offering:",
            cur?.identifier ?? "(none)",
            "packages:",
            cur?.availablePackages.map(
              (p) =>
                `${p.identifier}=${p.product.identifier}@${p.product.priceString}`,
            ) ?? [],
          );
          console.log(
            "[RevenueCat] entitlements attached to products →",
            "all:",
            Object.keys(info.entitlements.all),
            "active:",
            Object.keys(info.entitlements.active),
            "| app unlocks on entitlement:",
            ENTITLEMENT_ID,
          );
        }
      } catch (err) {
        if (!cancelled) console.warn("[RevenueCat] init failed:", err);
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();

    const listener = (info: CustomerInfo) => {
      if (!cancelled) setCustomerInfo(info);
    };
    let listenerAttached = false;
    try {
      Purchases.addCustomerInfoUpdateListener(listener);
      listenerAttached = true;
    } catch (err) {
      console.warn("[RevenueCat] addCustomerInfoUpdateListener failed:", err);
    }

    return () => {
      cancelled = true;
      if (!listenerAttached) return;
      try {
        Purchases.removeCustomerInfoUpdateListener(listener);
      } catch {
        // older SDKs may not expose remove; ignore.
      }
    };
  }, []);

  const refresh = useCallback(async () => {
    const Purchases = getPurchases();
    if (!Purchases) return;
    try {
      const [info, offerings] = await Promise.all([
        Purchases.getCustomerInfo(),
        Purchases.getOfferings(),
      ]);
      setCustomerInfo(info);
      setOffering(offerings.current ?? null);
    } catch (err) {
      console.warn("[RevenueCat] refresh failed:", err);
    }
  }, []);

  const syncAfterGrant = useCallback(async (): Promise<boolean> => {
    const Purchases = getPurchases();
    if (!Purchases) return false;
    setIsLoading(true);
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 1200));
        }
        try {
          // Without invalidating first, getCustomerInfo can be served straight
          // from the SDK's cache and never observe the server-side grant.
          await Purchases.invalidateCustomerInfoCache();
          const info = await Purchases.getCustomerInfo();
          setCustomerInfo(info);
          if (entitlementActive(info)) return true;
        } catch (err) {
          console.warn("[RevenueCat] syncAfterGrant attempt failed:", err);
        }
      }
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Re-read entitlements whenever the app comes back to the foreground.
  //
  // A promo code holds a single seat, so redeeming it elsewhere revokes this
  // device server-side. Nothing pushes that down: the SDK's update listener
  // only fires for changes this device initiated, and its cache would happily
  // report Pro indefinitely. Checking on foreground is what makes the handoff
  // take effect here within seconds. A device kept offline still keeps access
  // until it can reach RevenueCat again.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const Purchases = getPurchases();
      if (!Purchases) return;
      Purchases.getCustomerInfo()
        .then(setCustomerInfo)
        .catch((err: unknown) => {
          console.warn("[RevenueCat] foreground refresh failed:", err);
        });
    });
    return () => sub.remove();
  }, []);

  const presentCodeRedemption = useCallback(async (): Promise<boolean> => {
    const Purchases = getPurchases();
    // The sheet is StoreKit's, so it exists on iOS only. Android redeems offer
    // codes through the Play Store app instead.
    if (!Purchases || Platform.OS !== "ios") return false;
    try {
      await Purchases.presentCodeRedemptionSheet();
      return true;
    } catch (err) {
      console.warn("[RevenueCat] presentCodeRedemptionSheet failed:", err);
      return false;
    }
  }, []);

  const purchase = useCallback(
    async (pkg: PurchasesPackage): Promise<boolean> => {
      const Purchases = getPurchases();
      if (!Purchases) return false;
      setIsLoading(true);
      try {
        const { customerInfo: info } = await Purchases.purchasePackage(pkg);
        setCustomerInfo(info);
        if (__DEV__) {
          console.log(
            "[RevenueCat] purchase completed. active entitlements:",
            Object.keys(info.entitlements.active),
            "→ isPaid:",
            entitlementActive(info),
            entitlementActive(info)
              ? ""
              : `(purchase succeeded but "${ENTITLEMENT_ID}" is not active — attach the ${ENTITLEMENT_ID} entitlement to this product in RevenueCat, or fix the entitlement id)`,
          );
        }
        return entitlementActive(info);
      } catch (err: unknown) {
        const e = err as { userCancelled?: boolean; message?: string };
        if (!e?.userCancelled) {
          console.warn("[RevenueCat] purchase failed:", e?.message ?? err);
        }
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const resetTestUser = useCallback(async () => {
    if (!__DEV__) return;
    const Purchases = getPurchases();
    if (!Purchases) return;
    setIsLoading(true);
    try {
      // Switching to a fresh random user gives us a clean slate with no
      // entitlements. logOut() can't be used here because the current user is
      // anonymous (RevenueCat throws for anonymous log-out).
      const newId = `dev-reset-${Date.now()}-${Math.floor(
        Math.random() * 1_000_000,
      )}`;
      const { customerInfo: info } = await Purchases.logIn(newId);
      setCustomerInfo(info);
      setAppUserId(await Purchases.getAppUserID());
      const offerings = await Purchases.getOfferings();
      setOffering(offerings.current ?? null);
      console.log(
        "[RevenueCat] reset to fresh test user:",
        newId,
        "→ isPaid:",
        entitlementActive(info),
      );
    } catch (err) {
      console.warn("[RevenueCat] resetTestUser failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const restore = useCallback(async (): Promise<boolean> => {
    const Purchases = getPurchases();
    if (!Purchases) return false;
    setIsLoading(true);
    try {
      const info = await Purchases.restorePurchases();
      setCustomerInfo(info);
      return entitlementActive(info);
    } catch (err) {
      console.warn("[RevenueCat] restore failed:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const value = useMemo<SubscriptionState>(
    () => ({
      isPaid: entitlementActive(customerInfo),
      isReady,
      isLoading,
      customerInfo,
      offering,
      appUserId,
      purchase,
      restore,
      refresh,
      syncAfterGrant,
      presentCodeRedemption,
      resetTestUser,
    }),
    [
      customerInfo,
      isReady,
      isLoading,
      offering,
      appUserId,
      purchase,
      restore,
      refresh,
      syncAfterGrant,
      presentCodeRedemption,
      resetTestUser,
    ],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionState {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error("useSubscription must be used inside SubscriptionProvider");
  }
  return ctx;
}
