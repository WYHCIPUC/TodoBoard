"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const binding = fs.readFileSync(path.join(root, "binding.gyp"), "utf8");
const ci = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
const candidate = fs.readFileSync(path.join(root, ".github", "workflows", "release-candidate.yml"), "utf8");

assert.strictEqual(packageJson.devDependencies["node-gyp"], "^12.4.0");
assert.strictEqual(packageJson.scripts["build:native"], "node-gyp rebuild");
assert.match(binding, /scripts\/detect-windows-sdk\.js/);
assert.doesNotMatch(binding, /msvs_windows_target_platform_version"\s*:\s*"10\./);

for (const [name, workflow] of [["ci", ci], ["release-candidate", candidate]]) {
  assert.strictEqual((workflow.match(/- run: npm ci --ignore-scripts/g) || []).length, 2, name + " 必须隔离 npm 隐式原生构建");
  assert.strictEqual((workflow.match(/run: npm run build:native/g) || []).length, 2, name + " 必须显式使用锁定的 node-gyp 构建原生锁");
  assert.doesNotMatch(workflow, /- run: npm ci\s*$/m);
}

console.log("CI native volume-lock build contract tests passed");
