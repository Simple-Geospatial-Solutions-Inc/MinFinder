---
name: react-native-maps marker perf (zoom churn)
description: Why many custom markers + zoom lags on Android and crashes on iOS, and the quantized-zoom fix.
---

# react-native-maps: marker churn on zoom is the perf/crash driver

A map with many custom-child `<Marker>`s that re-clusters on zoom will lag badly
on Android and **hard-crash on iOS in Expo Go** (forced New Architecture/Fabric).
Isolation test that proves it: the *same* MapView + UrlTile with **no markers**
zooms perfectly — so it is the markers, not the tiles/Apple Maps/UrlTile.

**Root cause:** if the cluster grid cell size is derived from the *raw*
`latitudeDelta`, the grid (and therefore every marker `key`) changes on every
zoom. React then unmounts and recreates *every* native pin view at once. That
mass teardown/recreate is the lag on Android and the crash on iOS.

**Why:** react-native-maps reconciles markers by `key`. Stable keys → native
views are reused across renders even when the JSX array is rebuilt. Unstable
keys → full native remount = the storm.

**How to apply:**
- Quantize zoom into discrete buckets (e.g. `round(log2(delta)*2)`) and derive
  the grid cell size from the *bucket*, not the raw delta. Memoize clustering on
  the bucket so it only recomputes when crossing a bucket — not on pans/small
  zooms. Within a bucket, keys are byte-identical → no remount.
- Keep marker count low (fewer, bigger clusters; ~7 cells across beat ~12) and
  bound the viewport cull pad — native view count is the sustained-frame cost.
- `tracksViewChanges`: keep it on briefly on Android (needed or custom pin
  paints blank), but **off on iOS** — fixed-size pins render fine and the
  snapshot path is iOS-fragile under Fabric.
- A test build vs Expo Go does NOT fix this alone — it is a real
  efficiency/optimization problem; reduce churn first.
