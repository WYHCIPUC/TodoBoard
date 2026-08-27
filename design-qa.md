# Design QA Report

## Visual baseline

- Source visual truth: `assets/readme/showcase-list.png` (1252 × 700 px, legacy JPEG payload, nominal 1× density).
- Browser implementation: `docs/qa/ui-polish-desktop-final.png` (1398 × 993 px) from a 1440 × 1000 CSS viewport at `devicePixelRatio: 1`.
- State: light theme, list view, nine disposable sample entries, local-only QA data.
- Density normalization: this is a design-language upgrade rather than a pixel clone. The source and implementation were resized into the same 1440 × 500 comparison canvas; no 2× downsampling was required.

## Comparison evidence

- Full view: `docs/qa/ui-polish-desktop-comparison.png` places the source and implementation in one image for hierarchy, spacing, color, typography, and card-system review.
- Focused desktop flow: `docs/qa/ui-polish-entry.png` (1190 × 893 px; 1200 × 900 CSS viewport) verifies the research archive and screenshot region.
- Brainstorm workspace: `docs/qa/ui-polish-brainstorm.png` (1190 × 1330 px full-page capture; 1200 × 900 CSS viewport).
- Responsive focus: `docs/qa/ui-polish-mobile-390.png` (380 × 822 px from 390 × 844 CSS) and `docs/qa/ui-polish-mobile-320.png` (310 × 678 px from 320 × 700 CSS), both at 1× density.

## Findings

- No actionable P0, P1, or P2 visual/interaction issue remains.
- The warm-white, terracotta, editorial-card language is retained. The denser two-stage product navigation and workspace hero are intentional departures from the older statistics-heavy source.
- Typography, spacing rhythm, semantic status colors, image fitting, and primary copy surfaces remain legible without clipping at the tested breakpoints.
- P3 follow-up: the accumulated legacy CSS override layers could be consolidated later; packaged Edge app-mode visuals still merit a separate OS-level screenshot regression.

## Comparison history

### Iteration 1 — pre-build audit

- Findings: strict CSP blocked inline card actions; stale archive requests could overwrite the active entry; screenshot refresh could discard unsaved fields; study exit could lose notes or leave the timer running; menus retained hidden focus targets; card rows stretched; selection controls and semantic colors lacked visibility; the 320 px header was overcrowded; restored trash records remained visible.
- Fixes: delegated all inline actions, added abort/sequence guards and local screenshot refresh, introduced an explicit save/discard/continue exit guard, synchronized menu `hidden`/`inert`/focus state, corrected card alignment and contrast, added a two-row compact header, and made trash restore idempotent.
- Post-fix evidence: desktop comparison, entry view, and both responsive captures listed above.

### Iteration 2 — browser verification

- Search with no matches hides the daily recommendation; clearing search restores it.
- Study timer advanced to 24:59, stopped on exit, showed the unsaved-note guard, and restored the persisted note after discard.
- Screenshot upload preserved an unsaved form marker while updating only the screenshot list.
- Theme menu closed with focus restored; typing `?` inside search did not open shortcuts.
- Brainstorm tabs support Arrow keys and End, update roving `tabindex`, panel visibility, selection state, and `aria-labelledby`.
- Mobile layouts had no horizontal overflow at 390 px or 320 px. Browser warning/error log: empty.

final result: passed
