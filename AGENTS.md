# Repository Guidelines

## Project Structure & Module Organization

`server.js` is the HTTP entry point and should remain focused on routing and orchestration. Business logic lives in `lib/`: storage and Markdown updates are in `store.js`, entry operations in `entries.js`, classification in `classifier.js`, outbound URL validation in `safeurl.js`, and site-specific extraction in `lib/scraper/`. The framework-free browser client is split across `board.html`, `board.css`, and `board.js`. Tests sit beside modules as `lib/*.test.js`; scraper tests are under `lib/scraper/`. Design notes and release material belong in `docs/`, especially `docs/plans/`. Treat `DATA.md` as local user data; use `DATA.example.md` for shareable examples.

Before product, architecture, or data-format changes, read `docs/PROJECT-PRINCIPLES.md` and state how the proposal handles user data, network failure, recovery, and verification.

## Build, Test, and Development Commands

- `npm ci` installs the exact locked dependencies used by CI.
- `npm start` runs the local server, normally at `http://127.0.0.1:3865`.
- `npm test` runs the top-level `lib/*.test.js` files through `scripts/run-tests.js`.
- `node lib/scraper/github.test.js` runs a nested scraper test directly; repeat for other scraper adapters.
- `npm run check` checks `server.js` syntax and runs the standard test suite.

Use Node.js 22 or newer (`.nvmrc` pins 22). Windows users may use `start.bat` for normal startup.

## Coding Style & Naming Conventions

Follow the existing plain JavaScript style: CommonJS `require`, `"use strict"`, two-space indentation, semicolons, and double-quoted strings. Use `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for constants, and lowercase filenames such as `safeurl.js`. Keep modules narrow and avoid introducing a framework or build step without prior agreement. There is no configured formatter or linter, so match nearby code and keep diffs minimal.

## Testing Guidelines

Tests use Node's built-in `assert` and executable `*.test.js` files. Add regression coverage beside the affected module, including failure cases for URL handling, persistence, and external-content parsing. Run `npm run check` plus any affected nested scraper test before submitting. Never let tests read or overwrite the real `DATA.md`; use a temporary path through `README_FILE`.

## Commit & Pull Request Guidelines

Use Conventional Commit-style subjects seen in history and `CONTRIBUTING.md`: `feat(scope): summary`, `fix: summary`, `docs: summary`, or `chore: summary`. Keep commits focused. Pull requests should explain behavior changes, link the relevant issue or `docs/plans/` document, list commands actually run, and include screenshots for board UI changes. Do not commit `DATA.md`, generated backups, secrets, or local tunnel credentials.
