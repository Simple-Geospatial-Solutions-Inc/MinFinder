# SGS MinFinder — Store Submission Handoff

App Store + Google Play. Internal handoff: listing copy, screenshots, and outstanding tasks before we can submit.

| | |
|---|---|
| **Project** | SGS MinFinder (BC MINFILE offline reference app) |
| **Prepared by** | SGS |
| **Date** | 2026-07-20 |
| **Build status** | Feature-complete. Listing, IAPs, privacy done. Production build uploading via EAS. Remaining: age rating + copyright, then attach build & IAPs to one submission. |

## App identity (set in `app.json`)

| Field | Value |
|---|---|
| App name | SGS MinFinder |
| Slug | sgs-minfinder |
| Version | 1.0.0 |
| iOS bundle identifier | `ca.sgss.minfinder` |
| Android package | `ca.sgss.minfinder` |
| **App Store Connect SKU** | `sgs-minfinder` (private, internal, permanent) |

## 1. Summary

Offline reference and navigation app for BC MINFILE mineral occurrences. The build bundles **16,259 occurrence records** in a local DB; the listing copy advertises this as **"16,000+"** (do **not** use "100,000+" — it's wrong for this build and will likely get the listing rejected).

The app itself is done. What remains is store-account setup: privacy/data declarations, a couple of required URLs, the IAP product config, and Play's graphic assets. Everything outstanding is listed in §2. The final listing text is in §3 and the 12 preview screenshots (6 per store) are in §4.

## 2. Remaining before submission

Status current as of 2026-07-20. Code changes already made: bundle id set to `ca.sgss.minfinder` (iOS + Android), production RevenueCat `appl_` key wired into `eas.json` production profile.

### Both stores — done
- [x] **Support URL**, **Marketing URL**, **Privacy policy URL** (live), **descriptions**, **keywords**, **promotional text**, **screenshots**.
- [x] **PREMIUM paragraph** — reads generically ("a one-time or subscription purchase"), matches the lifetime / yearly / monthly offering.

### Apple App Store Connect
- [x] **App Privacy questionnaire** — Purchases (Purchase History) + Identifiers (User ID, Device ID): purpose **App Functionality**, **Not Linked**, **Not used for tracking**. Location = **Data Not Collected** (used on-device only, never transmitted). Everything else not collected. No ATT prompt.
- [x] **IAP products created** (Lifetime, Yearly, Monthly) — in "Prepare for Submission" with review screenshot (1290×2796).
- [x] **RevenueCat production key** in `eas.json`; App Store app configured as `ca.sgss.minfinder`, products attached to Offering with `SGS MinFinder Pro` entitlement.
- [ ] **Age rating questionnaire** — all "None" → 4+.
- [ ] **Copyright string** (App Information), e.g. © 2026 Simple Geospatial Solutions.
- [ ] **Upload production build** (EAS) and attach to version 1.0.0.
- [ ] **Submit build + all three IAPs together** — new ASC flow: open each product → **Add for Review** → add the app version into the submission → **Submit for Review**. (First subscription + first non-consumable must ride with the build.)

### Google Play Console (later — not blocking the iOS submission)
- [ ] **Data safety form** — Purchases + User ID, not for tracking. Mirror the Apple answers.
- [ ] **Feature graphic** 1024x500 + 512x512 icon.
- [ ] **Content rating questionnaire** (IARC).
- [ ] **Create IAP / subscriptions** in Play Console matching RevenueCat.
- [ ] **Set real `GOOGLE_MAPS_ANDROID_API_KEY`** in `eas.json` (still a placeholder; Android-only, no effect on iOS).

### Copy hygiene — verify before submitting
- [ ] No competitor names.
- [ ] No "best / #1" claims without proof.
- [ ] No pricing in the description text (pricing lives in the IAP config only).
- [ ] No placeholder / "coming soon" features.

## 3. Listing copy (final, ready to paste)

`LIMIT` shows used / max characters for the field.

| Field | Value | Limit |
|---|---|---|
| App name (both stores) | `SGS MinFinder` | 16 / 30 |
| Apple subtitle | `Offline BC MINFILE field map` | 28 / 30 |
| Play short description | `16,000+ BC MINFILE mineral sites with offline maps and compass navigation.` | 74 / 80 |
| Play category | Maps & Navigation (primary; alt. Tools) | — |
| Play tags | Maps & Navigation, Travel, Reference, Education, Productivity | ≤ 5 |

**Apple promotional text** (151 / 170)

> The offline field companion for BC mineral exploration. 16,000+ MINFILE occurrences, topographic maps, and compass navigation that work with zero signal.

**Apple keywords** — no spaces after commas (95 / 100)

```
minfile,mineral,prospecting,geology,exploration,rockhound,claims,topo,offline,compass,mining,BC
```

**Full description** (both stores, ~1,500 / 4,000)

```
SGS MinFinder puts British Columbia's entire MINFILE mineral inventory in your pocket - and keeps it working when the cell signal doesn't.

16,000+ OCCURRENCES, FULLY OFFLINE
Every MINFILE occurrence is bundled in the app in a local database. Browse, search, and filter the whole province with no data connection. Pre-download topographic map tiles for the area you're heading to and the basemap works offline too.

BUILT FOR THE FIELD
- Map every occurrence across BC, clustered so the big picture is instantly clear.
- Filter by status - Producer, Past Producer, Developed Prospect, Prospect, Showing, Anomaly - each colour-coded on the map.
- Search by name or MINFILE number and fly straight to any site.
- Real topographic basemaps from Esri so terrain, contours, and access roads are right there.

THE FULL GEOLOGICAL RECORD
Tap any occurrence for the official details: status, host rock, deposit class, elevation, latitude/longitude (decimal and DMS), and UTM coordinates in both NAD27 and NAD83. One tap opens the official BC MINFILE record online.

NAVIGATE TO THE SITE (Premium)
A live compass dial with real-time bearing and distance guides you to the exact occurrence - no trail required.

DOWNLOAD YOUR REGION BEFORE YOU GO
Draw a box around any area and cache its topographic tiles for offline use. Manage, reopen, or clear your downloaded regions any time.

PREMIUM
A one-time or subscription purchase unlocks compass navigation and the full expanded occurrence details. The map, search, filtering, and offline region downloads are free.

DATA SOURCES
Mineral data: BC Ministry of Energy, Mines and Low Carbon Innovation (MINFILE), https://minfile.gov.bc.ca/. Basemap: Esri World Topographic Map.

SGS MinFinder is an independent, third-party app. It is not affiliated with, endorsed by, or operated by the Government of British Columbia or any government agency.

Use as a reference only. Always verify mine status, land access, and safety information before visiting any site.
```

> Verbatim store text. **Update the PREMIUM block** to match the final RevenueCat offering before submitting (see §2).

## 4. Preview screenshots

Same six screens for each store, in display order. App Store set is in iPhone frames; Play set is in Android frames.

1. Map / occurrence overview
2. Offline map (no signal)
3. Compass navigation (premium)
4. Status filter + list
5. Occurrence detail
6. Offline region download

## 5. Notes

- **Data:** BC Ministry of Energy, Mines and Low Carbon Innovation (MINFILE). Basemap: Esri World Topographic Map. Attribution is in the description.
- **Accuracy:** build ships 16,259 records; advertise "16,000+". Do **not** use "100,000+".
- **RevenueCat** entitlement id used in code is `SGS MinFinder Pro` (see `lib/revenuecat.tsx`). The app unlocks Pro when this entitlement is active, so every product must map to it in the RevenueCat dashboard.
