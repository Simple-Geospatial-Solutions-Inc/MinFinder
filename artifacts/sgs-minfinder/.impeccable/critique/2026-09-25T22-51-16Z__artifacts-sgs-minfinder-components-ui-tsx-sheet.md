---
target: bottom sheets
total_score: 26
p0_count: 1
p1_count: 4
timestamp: 2026-09-25T22-51-16Z
slug: artifacts-sgs-minfinder-components-ui-tsx-sheet
---
# Critique: bottom sheets (components/ui.tsx Sheet + 8 sheets)

Score 26/40 (Acceptable). P0: 1, P1: 4.

| # | Heuristic | Score |
|---|---|---|
| 1 | Visibility of status | 3 |
| 2 | Match real world | 3 |
| 3 | User control | 2 |
| 4 | Consistency | 2 |
| 5 | Error prevention | 3 |
| 6 | Recognition | 3 |
| 7 | Flexibility | 2 |
| 8 | Minimalist | 3 |
| 9 | Error recovery | 2 |
| 10 | Help | 3 |

## Priority issues
- [P0] Gorhom v5 marks sheet content accessible=true / role adjustable / label "Bottom Sheet"; Sheet never overrides, so VoiceOver may read each sheet as one element. Fix: accessible={false} in Sheet.
- [P1] Android Back on the map with a sheet open exits the app (no BackHandler in app/index.tsx).
- [P1] DetailsSheet's onRequestUpgrade closes the mine sheet before the paywall (index.tsx:1320); QuickInfoCard stacks its own paywall instead.
- [P1] SearchReport sheet: no scroll, no topInset, keyboard can cover Save; Back discards text/photos silently (also NoteForm).
- [P1] Primary pills are 48 pt; PRODUCT.md asks 56 pt for field primaries.
- [P2] Two gold pills in DetailsSheet on site; gold on a locked Navigate in QuickInfoCard vs secondary in DetailsSheet.
- [P2] Capture DetailsSheet footer eats half the 50% snap; SafetyAck before the choice.
- [P2] Reports have no loading/error state; "No reports yet" shows while loading or on a failed read.
- [P3] Photo remove target 42 pt; verdict chips use checkbox role; Report toggle lacks expanded state; QuickInfoCard title 1 line; duplicated hexes in CaptureMap; TextButton role default.

## Minor
Inconsistent header/close/backdrop/gaps across sheets; drag handle on non-draggable sheets; LayoutAnimation ignores reduce-motion; paywall busy/empty copy; "..." vs "…".
