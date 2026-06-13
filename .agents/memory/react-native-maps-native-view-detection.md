---
name: react-native-maps native view availability detection
description: How to detect whether an optional react-native-maps native view (e.g. Heatmap) is available at runtime, for Expo Go fallbacks.
---

# Detecting optional react-native-maps native views (Heatmap etc.)

Some react-native-maps components render dedicated native views that exist only
in custom dev/standalone builds, NOT in the Expo Go client or on web. Example:
`<Heatmap>` renders `AIRMapHeatmap`; mounting it where the view manager isn't
registered throws `Invariant Violation: View config not found for component
AIRMapHeatmap`.

## Rule
Gate the optional component on a runtime native-capability check, not on the
environment:

```ts
import { Platform, UIManager } from "react-native";
function detectNativeHeatmap() {
  if (Platform.OS === "web") return false;
  try { return UIManager.hasViewManagerConfig?.("AIRMapHeatmap") ?? false; }
  catch { return false; }
}
```

This is the same mechanism react-native-maps uses internally
(`UIManager.hasViewManagerConfig`), so it tracks the real registry.

**Why:** `expo-constants` environment signals are unreliable for this on
Expo SDK 54 (New Architecture). Observed: `Constants.executionEnvironment`
returned `"bare"` on web and did NOT report `storeClient` on the iOS Expo Go
device, so `executionEnvironment !== StoreClient` and `appOwnership === "expo"`
gates both let the crash through. The native registry check is environment-
agnostic (Expo Go, web, dev build, prod build).

**How to apply:** Whenever using an optional native map overlay that may be
absent in Expo Go, compute the capability once at module load and only mount
the component when true; provide a non-native fallback (e.g. cluster pins for
a zoomed-out density view) otherwise.
