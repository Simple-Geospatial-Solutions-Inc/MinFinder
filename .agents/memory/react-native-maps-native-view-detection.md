---
name: react-native-maps optional native views (Heatmap) in Expo Go
description: Why optional react-native-maps native views like Heatmap can't be safely runtime-detected in Expo Go under the New Architecture, and what to do instead.
---

# Optional react-native-maps native views (Heatmap etc.) in Expo Go

Some react-native-maps components render dedicated native views that exist only
in custom dev/standalone builds, NOT in the Expo Go client or on web. Example:
`<Heatmap>` renders `AIRMapHeatmap` (a Google-Maps-only view). Mounting it where
the view manager isn't registered crashes the app.

## Rule
Do NOT try to runtime-gate these optional native overlays in Expo Go. There is
no reliable detection. Just don't use them — provide a non-native equivalent
(e.g. zoom-scaled cluster pins for a density view) that works everywhere.

**Why:** Two detection approaches were tried and BOTH failed on a real iOS
Expo Go device:
- `expo-constants`: `executionEnvironment` returned `"bare"` on web and did NOT
  report `storeClient` on iOS Expo Go; `appOwnership` is deprecated/unreliable.
- `UIManager.hasViewManagerConfig("AIRMapHeatmap")`: this is a legacy
  (old-architecture / Paper) API. Expo Go FORCES the New Architecture (Fabric)
  on regardless of `newArchEnabled: false` in app.json, and under Fabric this
  check does not reflect real component availability — it let the heatmap mount
  anyway, producing a NATIVE hard crash (app closes, no JS redbox in Metro
  logs) when the heatmap mounted (e.g. zooming out past the heatmap zoom
  threshold).

**How to apply:** If you see a map app that hard-crashes on zoom/pan in Expo Go
with no JS error in logs, suspect an optional native overlay (Heatmap) mounting.
The fix that actually worked: remove the native heatmap entirely and render
cluster pins at every zoom level (clustering scales by latitudeDelta — big
density clusters when zoomed out, individual pins when zoomed in). Also note
that with `PROVIDER_DEFAULT` the iOS map is Apple Maps, where the Google-only
Heatmap never works anyway.
