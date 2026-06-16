---
name: react-native-maps iOS pitfalls (Apple Maps) in Expo Go
description: Android-first react-native-maps config that breaks or hard-crashes on iOS (Apple Maps / MKMapKit), especially UrlTile tile caching and mapType.
---

# react-native-maps iOS pitfalls (Apple Maps / Expo Go)

When a react-native-maps map works on Android but hard-crashes or misbehaves on
iPhone, suspect Android-only config being applied cross-platform. With
`provider={PROVIDER_DEFAULT}` the iOS map is Apple Maps (MKMapKit), which has a
different feature set than Google Maps.

## Concrete iOS-hostile settings (make these Android-only)
- **`UrlTile` `tileCachePath` / `tileCacheMaxAge`** — pointing UrlTile at a
  `file://` cache path switches iOS from plain `MKTileOverlay` to the custom
  `AIRMapUrlTileCachedOverlay` (file IO + async fetch + scaling). This is the
  most likely cause of a **hard native crash specifically when ZOOMING OUT**
  (zoom-out fans out many tile requests through that fragile path). No JS
  redbox — the app just closes and Metro disconnects. Fix: only pass
  `tileCachePath`/`tileCacheMaxAge` on `Platform.OS === "android"`; iOS uses the
  plain remote `urlTemplate`.
- **`mapType="none"`** — Android/Google-Maps only; not a valid `MKMapType`.
  iOS silently falls back to standard, so it's not the strongest crash cause but
  is still wrong. Use `Platform.OS === "android" ? "none" : "standard"`. Opaque
  custom topo tiles via `<UrlTile>` cover the Apple base map anyway, so the
  look is preserved.

## Debugging signal
A crash with NO JS error in Metro logs + "Disconnected from Metro (1006)" =
NATIVE crash. Don't look for a JS stack trace; reason about which native view /
overlay mounted or got stressed by the gesture (here: zoom-out → tile loading).

**Why:** This codebase was written Android-first (comments referenced Android
behavior). The same MapView+UrlTile config that's fine on Android crashed on
iPhone in Expo Go.

**How to apply:** Gate every advanced react-native-maps overlay/option on the
platform. Default to the simplest iOS-safe config and only enable the richer
Android path explicitly. If iOS still crashes after this, escalate to an EAS
dev build (Expo Go forces the New Architecture on regardless of
`newArchEnabled:false`, which can expose Fabric bugs in advanced overlays).
