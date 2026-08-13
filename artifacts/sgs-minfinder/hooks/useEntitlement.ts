import { useSubscription } from "@/lib/revenuecat";

/**
 * Entitlement gate for premium features (Navigate-to-compass and full
 * DetailsSheet body). Returns `{ isPaid, isReady }`.
 *
 * Backed by RevenueCat via `SubscriptionProvider` mounted in `app/_layout.tsx`.
 * Reflects the active "SGS MinFinder Pro" entitlement from the user's CustomerInfo.
 *
 * `isReady` is false until RevenueCat has answered. Callers that would
 * otherwise flash a paywall during startup should wait on it; callers that
 * only draw a lock badge can ignore it, since locked-until-proven-paid is the
 * safe default.
 */
export function useEntitlement() {
  const { isPaid, isReady } = useSubscription();
  return { isPaid, isReady };
}
