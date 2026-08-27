"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const drill = fs.readFileSync(path.join(__dirname, "release-drill.ps1"), "utf8");
for (const marker of [
  "SHA256SUMS.txt",
  "ComparisonDirectory",
  "Reproducible build mismatch",
  "Assert-SafeZip",
  "Archive path traversal detected",
  "Assert-Manifest",
  "Fresh extraction",
  "source allowlist",
  "nodeExecutableSha256",
  "volume_lock.node",
  "HTTP_PROXY",
  "/api/health",
  "/api/add",
  "repository DATA.md",
]) {
  assert.ok(drill.includes(marker), `release drill is missing: ${marker}`);
}
assert.match(drill, /Name -cne "SHA256SUMS\.txt"/);
assert.match(drill, /T5_SENTINEL_SECRET/);
assert.match(drill, /ReparsePoint/);

console.log("✓ T5 release drill contract tests passed");
