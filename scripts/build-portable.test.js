"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const build = fs.readFileSync(path.join(__dirname, "build-portable.ps1"), "utf8");
const runtime = JSON.parse(fs.readFileSync(path.join(__dirname, "runtime-node.json"), "utf8"));
const allowlist = fs.readFileSync(path.join(__dirname, "release-allowlist.txt"), "utf8");

assert.match(runtime.version, /^24\.\d+\.\d+$/);
assert.strictEqual(runtime.platform, "win-x64");
assert.strictEqual(runtime.archive, `node-v${runtime.version}-win-x64.zip`);
assert.strictEqual(runtime.url, `https://nodejs.org/dist/v${runtime.version}/${runtime.archive}`);
assert.match(runtime.sha256, /^[a-f0-9]{64}$/);
assert.match(runtime.nodeExecutableSha256, /^[a-f0-9]{64}$/);
assert.match(build, /runtime-node\.json/);
assert.match(build, /Pinned Node\.js runtime checksum verification failed/);
assert.match(build, /nodeExecutableSha256/);
assert.match(build, /Invoke-ProductionDependencyInstall -NpmCommand \$npmCmd/);
assert.match(build, /\$env:PATH = \$nodeDist/);
assert.match(build, /\$env:PATH = \$originalPath/);
assert.match(build, /\/Brepro/);
assert.match(build, /_LINK_.*\/DEBUG:NONE/);
assert.match(build, /SOURCE_DATE_EPOCH = "315532800"/);
assert.match(build, /volume_lock\.node/);
assert.match(build, /Write-DeterministicZip/);
assert.match(build, /Assert-SafeArchive/);
assert.match(build, /Assert-PortableStage/);
assert.match(build, /\(Test-Path -LiteralPath \$portableArchive\) -or \(Test-Path -LiteralPath \$portableManifest\)/);
assert.match(build, /ReparsePoint/);
assert.doesNotMatch(build, /SHASUMS256|\/latest|Compress-Archive/);
assert.match(allowlist, /^portable runtime\/node\.exe$/m);
assert.match(allowlist, /^portable build\/Release\/volume_lock\.node$/m);
assert.match(allowlist, /^portable node_modules\/\*\*$/m);
assert.match(allowlist, /^source scripts\/detect-windows-sdk\.js$/m);

const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "build-portable.ps1"), "-ProjectRoot", root, "-DryRun"], {
  cwd: root,
  encoding: "utf8",
});
assert.strictEqual(result.status, 0, String(result.stdout || "") + String(result.stderr || ""));

const retryTest = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `
$source = Get-Content -Raw -LiteralPath '${path.join(root, "scripts", "build-portable.ps1").replace(/'/g, "''")}'
$start = $source.IndexOf('function Invoke-ProductionDependencyInstall')
$end = $source.IndexOf('  $originalPath = $env:PATH', $start)
if ($start -lt 0 -or $end -lt 0) { throw 'retry function not found' }
Invoke-Expression $source.Substring($start, $end - $start)
$script:calls = 0
function Mock-Npm { $script:calls++; $global:LASTEXITCODE = 1 }
$stopped = $false
try { Invoke-ProductionDependencyInstall -NpmCommand Mock-Npm -StageDirectory 'unused' -MaxAttempts 3 } catch { $stopped = $true }
if (-not $stopped -or $script:calls -ne 3) { throw 'persistent npm failure did not stop after three attempts' }
$script:calls = 0
function Mock-Npm { $script:calls++; if ($script:calls -eq 2) { $global:LASTEXITCODE = 0 } else { $global:LASTEXITCODE = 1 } }
Invoke-ProductionDependencyInstall -NpmCommand Mock-Npm -StageDirectory 'unused' -MaxAttempts 3
if ($script:calls -ne 2) { throw 'transient npm failure did not recover on retry' }
Write-Output 'retry tests passed'
`], { cwd: root, encoding: "utf8" });
assert.strictEqual(retryTest.status, 0, String(retryTest.stdout || "") + String(retryTest.stderr || ""));

const override = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "build-portable.ps1"), "-ProjectRoot", root, "-NodeVersion", "24.0.0", "-DryRun"], {
  cwd: root,
  encoding: "utf8",
});
assert.notStrictEqual(override.status, 0);
assert.match(String(override.stdout || "") + String(override.stderr || ""), /cannot override/i);

console.log("✓ T5 pinned portable runtime tests passed");
