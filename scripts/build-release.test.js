"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repo = path.join(__dirname, "..");
const script = path.join(__dirname, "build-release.ps1");
const source = fs.readFileSync(script, "utf8");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function fixture(entries, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t5-release-fixture-路径 空格-"));
  write(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "2.2.0" }));
  write(path.join(root, "scripts", "release-allowlist.txt"), entries.join("\n") + "\n");
  for (const [name, value] of Object.entries(files)) write(path.join(root, name), value);
  return root;
}

function run(root, ...extra) {
  return spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ProjectRoot", root, ...extra], {
    cwd: repo,
    encoding: "utf8",
  });
}

function output(result) {
  return String(result.stdout || "") + String(result.stderr || "");
}

assert.match(source, /release-allowlist\.txt/);
assert.match(source, /Write-DeterministicZip/);
assert.match(source, /1980-01-01T00:00:00Z/);
assert.match(source, /ReparsePoint/);
assert.match(source, /T5_SENTINEL_SECRET/);
assert.doesNotMatch(source, /Compress-Archive/);
assert.doesNotMatch(source, /git archive|git ls-files/i);

const roots = [];
try {
  const valid = fixture(["source app.js", "source 路径 空格/readme.md"], {
    "app.js": "\"use strict\";\n",
    "路径 空格/readme.md": "fixture\n",
    "DATA.md": "must never leak\n",
    "old-video.mp4": "must never leak\n",
  });
  roots.push(valid);
  const first = path.join(valid, "out-one");
  const second = path.join(valid, "out-two");
  let result = run(valid, "-OutputDirectory", first);
  assert.strictEqual(result.status, 0, output(result));
  result = run(valid, "-OutputDirectory", second);
  assert.strictEqual(result.status, 0, output(result));
  const archive = "linggankanban-2.2.0-windows.zip";
  const manifest = "linggankanban-2.2.0-windows.manifest.json";
  assert.strictEqual(sha256(path.join(first, archive)), sha256(path.join(second, archive)), "small clean builds must be byte-identical");
  assert.strictEqual(sha256(path.join(first, manifest)), sha256(path.join(second, manifest)), "manifests must be deterministic");
  const inventory = JSON.parse(fs.readFileSync(path.join(first, manifest), "utf8")).files.map(item => item.path);
  assert.deepStrictEqual(inventory, ["app.js", "路径 空格/readme.md"]);

  for (const [entries, files, pattern] of [
    [["source DATA.md"], { "DATA.md": "private" }, /Forbidden release path/i],
    [["source ../escape.js"], {}, /Invalid release allowlist path/i],
    [["source secret.env"], { "secret.env": "LINGGAN_API_TOKEN=abcdefghijk" }, /Secret-like content/i],
    [["source missing.js"], {}, /missing/i],
    [["source app*.js"], {}, /Invalid release allowlist path|exact files/i],
  ]) {
    const bad = fixture(entries, files);
    roots.push(bad);
    result = run(bad, "-DryRun");
    assert.notStrictEqual(result.status, 0, `expected failure for ${entries[0]}`);
    assert.match(output(result), pattern);
  }

  const linked = fixture(["source linked.js"], { "target.js": "safe" });
  roots.push(linked);
  try {
    fs.symlinkSync(path.join(linked, "target.js"), path.join(linked, "linked.js"), "file");
    result = run(linked, "-DryRun");
    assert.notStrictEqual(result.status, 0);
    assert.match(output(result), /Linked release input/i);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
    assert.match(source, /Linked release input is forbidden/);
  }
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}

console.log("✓ T5 release allowlist and deterministic archive tests passed");
