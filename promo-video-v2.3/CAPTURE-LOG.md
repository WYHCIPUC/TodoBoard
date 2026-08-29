# Capture Log

- Capture target: the repository's real browser UI served from `server.js` on isolated loopback port `3988`.
- Data source: `video-demo-data.md`, copied into `out/capture-fixture/DATA.md` before startup.
- Isolation: `README_FILE`, control, entries, brainstorms, trash, and recovered-orphan paths all point under `promo-video-v2.3/out/capture-fixture/`.
- Privacy boundary: the repository's real `DATA.md` is neither opened nor written by `scripts/capture.mjs`.
- Browser state: 1920×1080 viewport, onboarding marked as seen, with deterministic fictional content.
- Captured states: collection library, add-content modal, relationship canvas, recovery surface, brainstorm prompt and result.
- Stability adjustment: relationship footage uses the full real-canvas capture instead of DOM cutouts because canvas rerenders intentionally detach transient node handles.
- Reproduction: set `FORCE_CAPTURE=1` and run `npm run capture`. `BROWSER_EXECUTABLE` may point to a local Edge or Chromium binary.

All visible titles, URLs, summaries, relationships, and brainstorm results are fictional or public examples frozen in `video-demo-data.md`.
