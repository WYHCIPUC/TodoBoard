"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const smoke = fs.readFileSync(path.join(__dirname, "smoke-executable.ps1"), "utf8");

for (const marker of [
  "LINGGAN_DATA_DIR",
  "LINGGAN_INSTALL_DIR",
  "LINGGAN_NO_OPEN",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "Invoke-WebRequest",
  "/api/add",
  "/api/health",
  "Idempotency-Key",
  "Second launch replaced or duplicated",
  "repository DATA.md",
  "Get-Sha256",
]) {
  assert.ok(smoke.includes(marker), `EXE smoke is missing: ${marker}`);
}
assert.match(smoke, /offline\.invalid\/t5-smoke/);
assert.match(smoke, /StartsWith\(\$safePrefix/);

console.log("✓ T5 executable smoke contract tests passed");
