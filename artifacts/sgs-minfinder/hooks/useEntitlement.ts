import { useEffect, useState } from "react";

/**
 * Entitlement gate for premium features (Navigate-to-compass and full
 * DetailsSheet expand). Returns `{ isPaid }`.
 *
 * Currently a stub that always returns `false`. When we wire up RevenueCat,
 * the only change needed is the body of this hook — every call site will
 * pick up real entitlement state automatically:
 *
 *   import Purchases from "react-native-purchases";
 *   const info = await Purchases.getCustomerInfo();
 *   setIsPaid(info.entitlements.active["pro"] != null);
 *
 * RevenueCat sits on top of StoreKit (iOS) and Google Play Billing (Android)
 * — the actual purchase still goes through Apple/Google, this hook only
 * reflects the resulting entitlement state.
 */
export function useEntitlement() {
  const [isPaid, setIsPaid] = useState<boolean>(false);

  useEffect(() => {
    // TODO: replace with RevenueCat customerInfo lookup + listener.
    setIsPaid(false);
  }, []);

  return { isPaid };
}
