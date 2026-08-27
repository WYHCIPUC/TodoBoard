# Capture Log

- Capture target: the repository's real browser UI served from `server.js` on an isolated loopback port.
- Data source: `video-demo-data.md`, copied to `out/capture-fixture/DATA.md` before the server starts.
- Isolation: `README_FILE`, `CONTROL_DIR`, entries, brainstorms, trash, and recovered-orphan paths all point under `promo-video-v2.2/out/capture-fixture/`.
- Privacy boundary: the repository's real `DATA.md` is neither opened nor written by `scripts/capture.mjs`.
- Browser state: 1920×1080 viewport at 2× device scale, onboarding marked as seen, board view selected.
- Captured product states: eight library cards, search, entry research detail, trusted-recovery modal, brainstorm goal and fusion result.
- Reproduction: set `FORCE_CAPTURE=1` and run `node scripts/capture.mjs`. `BROWSER_EXECUTABLE` may point to a local Chromium binary.

All visible project titles, URLs, summaries, and brainstorm results are fictional or public examples frozen in `video-demo-data.md`.
