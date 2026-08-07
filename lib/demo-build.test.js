"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildDemo, DEMO_GOAL } = require("../scripts/build-demo");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-demo-test-"));
const output = path.join(root, "site");

try {
  assert.strictEqual(buildDemo(output), output);
  const files = fs.readdirSync(output).sort();
  assert.deepStrictEqual(files, [".nojekyll", "DATA.example.md", "board.css", "board.js", "demo-brainstorm.json", "index.html"]);
  assert.ok(fs.readFileSync(path.join(output, "index.html"), "utf8").includes("在线 Demo"));
  assert.ok(fs.readFileSync(path.join(output, "board.js"), "utf8").includes("demo-brainstorm.json"));
  const analysis = JSON.parse(fs.readFileSync(path.join(output, "demo-brainstorm.json"), "utf8"));
  assert.strictEqual(analysis.ok, true);
  assert.strictEqual(analysis.fusion.goal, DEMO_GOAL);
  assert.ok(analysis.summary.items > 0);
  assert.ok(analysis.fusion.plans.length > 0);
  console.log("demo-build: ALL PASS");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
