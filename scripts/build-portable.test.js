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
assert.match(build, /npmCmd ci --omit=dev/);
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

const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "build-portable.ps1"), "-ProjectRoot", root, "-DryRun"], {
  cwd: root,
  encoding: "utf8",
});
assert.strictEqual(result.status, 0, String(result.stdout || "") + String(result.stderr || ""));

const override = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "build-portable.ps1"), "-ProjectRoot", root, "-NodeVersion", "24.0.0", "-DryRun"], {
  cwd: root,
  encoding: "utf8",
});
assert.notStrictEqual(override.status, 0);
assert.match(String(override.stdout || "") + String(override.stderr || ""), /cannot override/i);

console.log("✓ T5 pinned portable runtime tests passed");
