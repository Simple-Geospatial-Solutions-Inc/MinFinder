---
name: SGS MinFinder
description: Offline BC MINFILE map and field-capture app, laid out like a trail map.
colors:
  navy: "#16365C"
  navy-deep: "#0E2444"
  gold: "#FCBA19"
  gold-dim: "#C98F0C"
  ink: "#0E1A2B"
  stone: "#F4F1EA"
  card-white: "#FFFFFF"
  lichen: "#E6DFCE"
  scree: "#D7CFBE"
  slate-muted: "#5F6B7A"
  destructive: "#B3261E"
  night-card: "#142A4A"
  night-muted: "#1B3661"
  night-border: "#1F3E70"
  night-muted-text: "#9BA9BD"
  success: "#1B6B3A"
  success-subtle: "#E3F1E7"
  warning: "#6B4700"
  warning-subtle: "#FFF1CC"
  danger: "#8C1D17"
  danger-subtle: "#FBE4E2"
  scrim: "#0000008C"
  navy-scrim: "#0E2444D9"
  status-producer: "#D7263D"
  status-past-producer: "#8B1E3F"
  status-developed-prospect: "#F46036"
  status-prospect: "#FCBA19"
  status-showing: "#2E86AB"
  status-anomaly: "#8E9AAF"
typography:
  display:
    fontFamily: "Inter_700Bold, Inter, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: "28px"
  title:
    fontFamily: "Inter_700Bold, Inter, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: "24px"
  label:
    fontFamily: "Inter_600SemiBold, Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "20px"
  meta:
    fontFamily: "Inter_400Regular, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  link:
    fontFamily: "Inter_600SemiBold, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  fine:
    fontFamily: "Inter_400Regular, Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  reading:
    fontFamily: "Inter_600SemiBold, Inter, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "28px"
    fontFeature: "tnum"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  gutter: "24px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.navy-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 16px"
  button-secondary:
    backgroundColor: "{colors.lichen}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 16px"
  button-disabled:
    backgroundColor: "{colors.lichen}"
    textColor: "{colors.slate-muted}"
    rounded: "{rounded.pill}"
    height: "48px"
  text-button:
    textColor: "{colors.navy}"
    typography: "{typography.link}"
    height: "44px"
  icon-button:
    backgroundColor: "{colors.lichen}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "36px"
  map-button:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "40px"
  map-button-active:
    backgroundColor: "{colors.navy-deep}"
    textColor: "{colors.card-white}"
    rounded: "{rounded.pill}"
    size: "40px"
  search-pill:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 4px 0 16px"
  filter-chip:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "36px"
    padding: "0 14px"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stone}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "0 16px"
  segmented-track:
    backgroundColor: "{colors.lichen}"
    rounded: "{rounded.pill}"
    padding: "4px"
  segmented-selected:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    typography: "{typography.link}"
    rounded: "{rounded.pill}"
    height: "40px"
  sheet:
    backgroundColor: "{colors.card-white}"
    rounded: "{rounded.lg}"
    padding: "0 24px"
  list-section:
    backgroundColor: "{colors.card-white}"
    rounded: "{rounded.lg}"
  list-row:
    typography: "{typography.label}"
    padding: "12px 16px"
    height: "56px"
  notice:
    backgroundColor: "{colors.lichen}"
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.md}"
    padding: "12px"
  input:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "48px"
    padding: "0 12px"
  status-chip-ok:
    backgroundColor: "{colors.success-subtle}"
    textColor: "{colors.success}"
    typography: "{typography.fine}"
    rounded: "{rounded.pill}"
  status-chip-wait:
    backgroundColor: "{colors.warning-subtle}"
    textColor: "{colors.warning}"
    typography: "{typography.fine}"
    rounded: "{rounded.pill}"
  status-chip-bad:
    backgroundColor: "{colors.danger-subtle}"
    textColor: "{colors.danger}"
    typography: "{typography.fine}"
    rounded: "{rounded.pill}"
  header:
    backgroundColor: "{colors.navy-deep}"
    textColor: "{colors.stone}"
---

# Design System: SGS MinFinder

## 1. Overview

**Creative North Star: "The Field Map"**

MinFinder is a map you carry into the backcountry, and the map is the screen. Controls float on it the way they do in AllTrails: a white search pill and status chips across the top, a gold "Add a mine" pill and white map buttons along the bottom within thumb reach, and bottom sheets that rise over the map to carry content. They never replace the map with a full-screen form. Everything outside the map, such as lists, settings and the paywall, uses the same small kit, so a sheet on the map and a screen behind a navy header feel like one app.

Gold marks the one thing to do next. Navy frames the app: stack headers, the loading veil and the compass instrument. The rest is quiet: white cards on stone, lichen fills, ink text. The map and the MINFILE legend carry the colour.

The system rejects the four things PRODUCT.md names: government forms (long scrolls of fields and legal boilerplate), social or gamified apps (badges, streaks, confetti), consumer-cute apps (pastel blobs, mascots, jokey copy) and enterprise GIS (dense attribute tables in the style of ArcGIS Field Maps).

**Key Characteristics:**
- Map-first layouts: floating chrome on the map, and bottom sheets for content.
- One gold pill per screen; everything else is white, lichen or ink.
- A single kit in `components/ui.tsx`; screens compose it and don't restyle it.
- Inter in four weights on a six-step type scale, with tabular figures for every reading.
- Two fixed surfaces: map chrome is light in both schemes, and the compass is dark in both.
- Every sheet animates both ways, and motion follows the system's reduce-motion setting.

## 2. Colors: The Field Map Palette

This is a restrained palette: stone and white surfaces, navy framing and a single gold accent. The MINFILE legend is data, not decoration.

The source of truth is `constants/colors.ts` (light and dark themes, read through `useColors()`) and `constants/status.ts` (the legend). The hex values here mirror those files. Add colours there, never inline.

### Primary
- **Gold** (`gold`): The primary action (`PillButton` primary, "Add a mine") and the header's back tint. **Gold Dim** (`gold-dim`) is its low-emphasis form.
- **Navy Deep** (`navy-deep`): The frame. It's used for stack headers, active map toggles, the text on gold, the compass screen and the dark-theme background.
- **Navy** (`navy`): The light theme's `primary`, used for text links (`TextButton`) and emphasis icons.

### Neutral
- **Stone** (`stone`): The light-theme page background, and the text colour on navy.
- **Card White** (`card-white`): Sheets, list sections, map chrome and the selected segment.
- **Lichen** (`lichen`): Secondary buttons, icon-button discs, the segmented track, notices and empty-state tiles.
- **Scree** (`scree`): Borders, input strokes, sheet handles and hairline row dividers.
- **Ink** (`ink`): Body text and icons, and the fill of a selected chip.
- **Slate Muted** (`slate-muted`): Meta text and placeholders.
- **Night Card / Night Muted / Night Border / Night Muted Text**: The dark-theme counterparts of the above.

### Tones
`success`, `warning` and `danger` each have a `-subtle` pair: strong text on a weak fill, in both themes. They're used for capture status chips, Redeem results and the paywall lock. **Destructive** (`destructive`) is only for destructive actions (Discard, Delete, Clear all) and hazard chips.

### Fixed surfaces
- **Map chrome** (`mapChrome`, `mapChromeForeground`, `mapChromeMuted`): Anything floating on the basemap reads `colors.light` in both schemes, because the basemap is light. In code it's `const MAP = colorTokens.light`.
- **Compass instrument:** The compass screen reads `colors.dark` in both schemes. In code it's `const DIAL = colorTokens.dark`.
- **Scrims:** `scrim` (black at 55%) sits behind modals. `navyScrim` (navy at 85%) is used for the map's loading veil and the satellite credit.

### Named Rules
**The One Gold Rule.** At most one gold pill per screen or sheet. If two things are gold, one of them is wrong.

**The Legend Is Data Rule.** MINFILE status colours appear only on map pins, status badges, filter-chip dots and the About legend, always beside the status name.

**The Token Rule.** Every colour comes from `useColors()`, `MAP`/`DIAL` or `STATUS_MAP`. The only literals allowed are in MapLibre layer styles and the pin SVGs.

## 3. Typography

**Font:** Inter (`@expo-google-fonts/inter`) in 400, 500, 600 and 700, with the system sans as fallback. There is no display face and no second family.

**Character:** Plain and even, and legible in glare. Hierarchy comes from weight and a tight scale.

### Hierarchy
The scale is `type` in `components/ui.tsx`; use it rather than setting sizes.
- **Display** (700, 22/28): Screen and sheet titles, and empty-state headings.
- **Title** (700, 18/24): List-section titles and sheet headers inside a screen.
- **Label** (600, 15/20): List-row titles and emphasised values. Buttons use 600 at 16.
- **Meta** (400, 14/20): Descriptions, secondary lines and helper copy. Cap prose at 65–75 characters.
- **Link** (600, 14/20): `TextButton`, the segmented control and inline actions.
- **Fine** (400, 12/16): Store disclosures, the legal line, the satellite credit and status chips. It's the floor: nothing is set below 12.
- **Reading** (600, 22/28, tabular figures): `Stat` values. The unit steps back to 500 at 14. The compass's live Distance/Bearing readout is the one larger size, at 28.

### Named Rules
**The Instrument Reading Rule.** Every number a user navigates by (distance, bearing, coordinates, elevation, prices) is set in tabular figures.

**The Scale Survives Rule.** No text container has a fixed height; layouts are checked at large Dynamic Type and Android font scaling.

## 4. Elevation

The app has one shadow, `floating` (`shadowColor #000, offset 0/2, opacity 0.16, radius 4, elevation 4`, exported from `components/ui.tsx`). It belongs to anything that sits above the page: map buttons, the search pill, filter chips, map notices, bottom sheets and the selected segment. Flat content (list sections, notices, cards on stone) gets tonal layering instead: a white card with a hairline Scree border on a stone page.

### Named Rules
**The Float Rule.** A shadow means "this is above something". List sections and inline cards never get one.

**The One Shadow Rule.** Use the `floating` export and don't restate its values. The compass dial's own body shadow is the single exception.

## 5. Components

Every piece lives in `components/ui.tsx`. Screens compose these; a screen-level style that restates one of them is drift.

### Buttons
- **`PillButton`:** A 48pt full pill. **Primary** is gold with navy-deep text, one per screen. **Secondary** is lichen with ink text and sits beside the primary. **Outline** has a 1px ink border and is reserved for third-party sign-in. Pressed drops to 0.85 opacity. Busy swaps the icon for a spinner. Disabled is lichen with slate text and never gold. It fills its row unless `grow={false}` (e.g. "Add a mine" on the map).
- **`TextButton`:** An inline link-weight action, 44pt tall, in the primary colour or the `destructive` tone. It takes `accessibilityRole="link"` for external links.
- **`IconButton`:** A 36pt disc (44pt with hit slop). **Muted** is on a lichen disc and used for sheet close buttons. **Plain** is used inside fields.

### Map chrome
- **Search pill:** A 48pt white pill with the search glyph, the field, a clear button, a hairline divider and the menu.
- **Menu morph:** Tapping the menu (`components/PillMenu.tsx`) slides the divider left over the field. The three hamburger lines ride left together, and each breaks off at its option (Offline, Submissions, About) and becomes its icon, while the options are revealed from the right. It runs 800ms on a `bezier(0.2, 0, 0, 1)` curve, and a tap anywhere else reverses it.
- **Filter chips:** 36pt white pills. When on, the status dot is solid and the label is ink. When off, the dot is hollow and the label is slate.
- **`MapButton`:** A 40pt white disc with a 20pt ink icon. As a toggle, it fills navy-deep when on and is announced as a switch.
- **Map notices:** The region and search pills are white cards with a 16 radius, `floating`, and a title plus meta line.

### Selection
- **`Chip`:** A 44pt full pill with a hairline border. Selected fills solid ink (or `destructive` for hazards). It uses the radio or checkbox role.
- **`Segmented`:** Two or three exclusive options on a lichen track. The chosen one lifts out on a white card with `floating`. Used by compass calibration and Redeem.

### Sheets
- **`Sheet`:** The app's single bottom-sheet look (`@gorhom/bottom-sheet`): a card fill, a 24 top radius (`radius.xl`, half a 48pt pill, so the sheet shares the curve of the buttons on it), a 32×5 Scree handle (only on sheets that resize or pan shut), `floating`, and an optional `backdrop` (25% dim, tap to close). Its content stays reachable by screen readers: the wrapper turns off Gorhom's default of grouping the whole sheet into one element.
- **Opening and closing:** Pass `open`. The sheet mounts at index 0 when `open` turns true and animates shut before unmounting when it turns false. Use `useLast(value)` to keep the content on screen while it closes.
- **Sizing:** Sheets size to their content, with `topInset` set to the safe area. The mine details sheet snaps at 60% and 100%.
- **Where they're used:** Mine preview, mine details, the paywall, compass calibration and the capture flow.
- **Exceptions:** The region picker (a full-screen map a sheet's drag would fight) and the error fallback (it renders outside the gesture-handler root) stay RN Modals.

### Lists and containers
- **`ListSection`:** A title (with an optional subtitle and a TextButton action) over a white card with a 16 radius and a hairline border.
- **`ListRow`:** 12/16 padding with hairline dividers. When pressable it's at least 56pt with a trailing chevron.
- **`Notice`:** An icon and a meta sentence on a lichen fill with a 12 radius, in a default or danger tone.
- **`EmptyState`:** A 64pt lichen tile holding a 32–36pt glyph, then a display title, a label-weight muted body and optional steps or actions. Used by My submissions, Offline, the "not found" screen and the web stubs.
- **`Stat`:** A reading value (with a smaller unit) over a meta label.

### Inputs
- **Style:** Card white fill, a 1px `input` stroke, a 12 radius, a 48pt height (notes fields grow from 96pt), and body text at 16 so iOS doesn't zoom on focus. Placeholders are slate muted.
- **Focus:** Only the platform caret today. This is a known gap.
- **Error:** A plain-language sentence under the field, not only a red outline.

### Navigation
- **Stack headers:** Navy-deep with a stone title in 700 and a gold back tint (`app/_layout.tsx`). There's no custom tab bar.
- **Map screen:** It's headerless. Its chrome floats on the map, and its links live in the search pill's menu.

### Motion
- **Durations:** Small state changes run 160–250ms. Sheets use Gorhom's own spring. The menu morph is 800ms.
- **Reduced motion:** Reanimated's `withTiming` follows the system setting by default. Anything else checks `AccessibilityInfo.isReduceMotionEnabled` and switches instantly.
- **Closing:** Nothing that animates in may vanish on the way out.
- **Easing:** Use an exponential ease-out. No bounce, and no choreographed entrance sequences.

## 6. Do's and Don'ts

### Do:
- **Do** start from `components/ui.tsx`: `PillButton`, `TextButton`, `IconButton`, `Chip`, `Segmented`, `Sheet`, `ListSection`/`ListRow`, `Notice`, `EmptyState`, `Stat`, `MapButton`.
- **Do** put content in a bottom sheet over the map rather than on a new full-screen form.
- **Do** use exactly one gold pill per screen.
- **Do** read `MAP` (light) for anything on the basemap and `DIAL` (dark) on the compass, whatever the scheme.
- **Do** give every sheet `open` plus `useLast` so it animates shut.
- **Do** set navigational numbers and prices in tabular figures.
- **Do** keep every touch target at 44pt or more; primary actions are 48pt pills.
- **Do** pair every status colour with its words ("Waiting for signal", "Past Producer").

### Don't:
- **Don't** set a font size, radius or colour that isn't in `type`, `radius` or the tokens. There's no 9, 10, 11 or 13, and no inline hex.
- **Don't** build government forms: long scrolls of fields and legal boilerplate. Hide optional fields.
- **Don't** add social or gamified patterns: badges, streaks, confetti or leaderboards.
- **Don't** go consumer-cute: pastel blobs, mascots or jokey copy.
- **Don't** drift into enterprise GIS: dense attribute tables in the style of ArcGIS Field Maps.
- **Don't** use MINFILE status colours for buttons, chrome or decoration.
- **Don't** put `floating` on flat content such as list sections and inline cards.
- **Don't** use a centred RN `Modal` for new dialogs; use `Sheet`.
- **Don't** show anything Pro (coordinates, elevation, host rock, deposit class) in front of the paywall.
- **Don't** use `border-left` or `border-right` wider than 1px as a coloured accent stripe.
