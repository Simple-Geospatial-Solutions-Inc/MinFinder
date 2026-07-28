import { useSubscription } from "@/lib/revenuecat";

/**
 * Entitlement gate for premium features (Navigate-to-compass and full
 * DetailsSheet expand). Returns `{ isPaid }`.
 *
 * Backed by RevenueCat via `SubscriptionProvider` mounted in `app/_layout.tsx`.
 * Reflects the active "SGS MinFinder Pro" entitlement from the user's CustomerInfo.
 */
export function useEntitlement() {
  const { isPaid } = useSubscription();
  return { isPaid };
}
