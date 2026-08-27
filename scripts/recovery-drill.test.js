"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const drill = fs.readFileSync(path.join(__dirname, "recovery-drill.ps1"), "utf8");
for (const marker of [
  "backup-format.test.js",
  "backup-transaction.test.js",
  "idempotency.test.js",
  "recovery.test.js",
  "recover-cli.test.js",
  "upgrade.test.js",
  "volume-lock.test.js",
  "interrupted_write",
  "lock_contention_and_owner_crash",
  "ambiguous_candidates_no_guess",
  "upgrade_and_rollback",
  "verification_failure",
  "idempotent_rerun",
  "repository DATA.md",
]) {
  assert.ok(drill.includes(marker), `recovery drill is missing: ${marker}`);
}
assert.match(drill, /README_FILE/);
assert.match(drill, /HTTP_PROXY/);
assert.match(drill, /scripts\/recover\.js/);

console.log("✓ T5 recovery drill contract tests passed");
