# Design QA Report

## Visual baseline

- Source visual truth: `docs/qa/relationship-reference.webp` (1488 × 1058 px).
- Browser implementation: `docs/qa/relationship-desktop-final.png` (1440 × 1024 px, 1× density).
- State: light theme, relationship view, highest-degree node selected, disposable `DATA.example.md` fixture, local service online.
- Comparison normalization: the source was resized to 1440 × 1024; the implementation was captured at the same CSS viewport.

## Comparison evidence

- Full view: `docs/qa/relationship-design-comparison.png` compares hierarchy, layout, typography, color, and density side by side.
- Canvas focus: `docs/qa/relationship-canvas-comparison.png` compares zones, nodes, links, selection, and action dock.
- Detail focus: `docs/qa/relationship-detail-comparison.png` compares source metadata, archive state, backlinks, and actions.
- Responsive focus: `docs/qa/relationship-mobile-390-final.png` verifies the centered selected node and collapsed detail drawer at 390 × 844 px.

## Findings

- No actionable P0, P1, or P2 visual or interaction issue remains.
- The implementation retains the source's warm editorial shell, three evidence territories, selected center node, right-side source detail, minimap, and floating action dock.
- Real local entries replace the reference's illustrative question/conclusion cards. Filters and archive state reflect repository-supported data rather than invented content.
- Typography, spacing, colors, controls, and copy remain legible without clipping at the tested desktop and mobile viewports.
- P3 follow-up: relationship-type edge labels and color coding could make dense datasets easier to scan.

## Comparison history

### Iteration 1

- Findings: nodes were too small, the left zone could clip, unrelated nodes faded excessively, and the canvas left too much unused vertical space.
- Fixes: increased node size and type scale, constrained fitted pan, raised muted opacity, enlarged the canvas, and extended all three territories.

### Iteration 2

- Findings: the strongest cluster was not centered; mobile initially opened the detail panel and did not focus the selected node.
- Fixes: ranked clusters by degree, placed the strongest in the center, centered the selected node on narrow screens, and defaulted the mobile detail panel to collapsed.

## Interaction verification

- Verified source and archive filters, node selection, pan, zoom, drag, persisted positions, minimap, research archive round-trip, and “形成验证方案”.
- Stopping the local service and refreshing analysis preserved nine nodes through the explicit “已使用离线基础关系” fallback.
- Desktop and mobile browser logs contained no warnings or errors.

final result: passed
