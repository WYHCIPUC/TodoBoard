# Design QA Report

## Visual baseline

- Source visual truth: `docs/qa/relationship-reference.webp` (1488 × 1058 px).
- Browser implementation: `docs/qa/ui-continuation-desktop-final.png` (1440 × 1024 px, 1440 × 1024 CSS viewport, 1× density).
- State: light theme, relationship view, highest-degree node selected, disposable `DATA.example.md` fixture, local service online.
- Density normalization: the source was resized to 1440 × 1024 before comparison; no device-frame or browser-chrome mismatch was included.

## Comparison evidence

- Full design comparison: `docs/qa/ui-continuation-design-comparison.webp`.
- Focused canvas comparison: `docs/qa/ui-continuation-canvas-comparison.webp`.
- Focused detail comparison: `docs/qa/ui-continuation-detail-comparison.webp`.
- Before/after evidence: `docs/qa/ui-continuation-improvement-comparison.webp`.
- Responsive evidence: `docs/qa/ui-continuation-mobile-final.png` at 390 × 844 px and `docs/qa/ui-continuation-mobile-detail.png` with the detail drawer open.

## Findings

- No actionable P0, P1, or P2 visual or interaction issue remains.
- Fonts and typography: the existing display/body/mono hierarchy remains intact; long detail titles now wrap to two lines and node text remains readable at the 72% mobile fit.
- Spacing and layout: stale dragged positions no longer overlap, nodes stay inside their semantic relationship zone, and detail actions remain reachable in a fixed footer.
- Colors and tokens: the warm editorial shell is unchanged; selected and related nodes use clearer emphasis, while edge colors distinguish theme, source, portfolio, and capability relationships.
- Image quality and assets: this surface contains data visualization and native controls rather than raster content; no target logo, illustration, or product imagery was replaced or omitted.
- Copy and content: zone labels describe relationship roles instead of implying that every contained node shares one category; real item categories remain visible on each node.
- P3 follow-up: very dense datasets may eventually benefit from adaptive canvas height or progressive cluster expansion.

## Comparison history

### Iteration 1 — collision and action hierarchy

- Findings: restored node positions overlapped on desktop and mobile; unrelated nodes faded too heavily; relationship type was only discoverable through details; the detail action group floated above a large empty area.
- Fixes: added collision recovery and drop rejection, raised muted-node visibility, labeled active edges, highlighted related nodes, and moved detail actions into a fixed footer.
- Post-fix evidence: `docs/qa/ui-continuation-improvement-comparison.webp` and `docs/qa/ui-continuation-mobile-detail.png`.

### Iteration 2 — semantic grouping

- Findings: manually dragged nodes could remain inside a visually unrelated category zone, making the zone title contradict the node category.
- Fixes: constrained saved and dropped positions to their assigned zone and renamed zones to relationship roles: 关联来源、重点关系、探索补充.
- Post-fix evidence: `docs/qa/ui-continuation-desktop-final.png` and `docs/qa/ui-continuation-mobile-final.png`.

## Interaction verification

- Verified mobile detail open/close, GitHub filtering to three nodes, reset to nine nodes, zoom from 74% to 83%, fit reset, selected-node detail, and responsive reflow.
- Reloading the pre-fix saved layout automatically removed overlaps and restored zone consistency without changing primary data.
- Browser error log was empty. `DATA.md`, dependency files, and backend data formats were not modified.

final result: passed
