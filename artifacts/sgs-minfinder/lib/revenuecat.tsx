import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";

const ENTITLEMENT_ID = "default";
const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY ?? "";

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
  purchase: (pkg: PurchasesPackage) => Promise<boolean>;
  restore: () => Promise<boolean>;
  refresh: () => Promise<void>;
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
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const Purchases = getPurchases();
    if (!Purchases || !API_KEY) {
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
        console.log("[RevenueCat] App User ID:", appUserId);
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

  const purchase = useCallback(
    async (pkg: PurchasesPackage): Promise<boolean> => {
      const Purchases = getPurchases();
      if (!Purchases) return false;
      setIsLoading(true);
      try {
        const { customerInfo: info } = await Purchases.purchasePackage(pkg);
        setCustomerInfo(info);
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
      purchase,
      restore,
      refresh,
    }),
    [customerInfo, isReady, isLoading, offering, purchase, restore, refresh],
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
