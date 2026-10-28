"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

const root = path.join(__dirname, "..");
const restoreCheck = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `
$env:README_FILE = 'C:\\original\\DATA.md'
$env:HTTP_PROXY = 'http://proxy.invalid:8080'
$env:HTTPS_PROXY = 'http://proxy.invalid:8080'
$env:NO_PROXY = 'example.invalid'
& '${path.join(root, "scripts", "recovery-drill.ps1").replace(/'/g, "''")}'
if ($LASTEXITCODE -ne 0) { throw 'recovery drill failed' }
$expected = @{
  README_FILE = 'C:\\original\\DATA.md'
  HTTP_PROXY = 'http://proxy.invalid:8080'
  HTTPS_PROXY = 'http://proxy.invalid:8080'
  NO_PROXY = 'example.invalid'
}
foreach ($name in $expected.Keys) {
  if ([Environment]::GetEnvironmentVariable($name) -ne $expected[$name]) {
    throw "environment was not restored: $name"
  }
}
$env:README_FILE = 'C:\\original\\DATA.md'
$env:HTTP_PROXY = 'http://proxy.invalid:8080'
$env:HTTPS_PROXY = 'http://proxy.invalid:8080'
$env:NO_PROXY = 'example.invalid'
try { & '${path.join(root, "scripts", "recovery-drill.ps1").replace(/'/g, "''")}' -NodePath 'C:\\missing\\node.exe' } catch { }
foreach ($name in $expected.Keys) {
  if ([Environment]::GetEnvironmentVariable($name) -ne $expected[$name]) {
    throw "environment was not restored after failure: $name"
  }
}
Write-Output 'environment restored'
`], { cwd: root, encoding: "utf8" });
assert.strictEqual(restoreCheck.status, 0, String(restoreCheck.stdout || "") + String(restoreCheck.stderr || ""));
assert.match(String(restoreCheck.stdout || ""), /environment restored/);

console.log("✓ T5 recovery drill contract tests passed");
