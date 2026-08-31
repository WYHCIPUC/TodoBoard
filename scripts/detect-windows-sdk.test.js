"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { compareVersions, findWindowsSdkVersion } = require("./detect-windows-sdk");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "windows-sdk-detect-"));
const libRoot = path.join(root, "Lib");

function addSdk(version, complete = true) {
  fs.mkdirSync(path.join(libRoot, version, "um", "x64"), { recursive: true });
  fs.writeFileSync(path.join(libRoot, version, "um", "x64", "AdvAPI32.Lib"), "fixture");
  if (complete) {
    fs.mkdirSync(path.join(root, "Include", version, "um"), { recursive: true });
    fs.writeFileSync(path.join(root, "Include", version, "um", "Windows.h"), "fixture");
  }
}

try {
  addSdk("10.0.22621.0");
  addSdk("10.0.26100.0");
  addSdk("10.0.99999.0", false);

  assert.ok(compareVersions("10.0.26100.0", "10.0.22621.0") > 0);
  assert.strictEqual(findWindowsSdkVersion({ roots: [libRoot] }), "10.0.26100.0");
  assert.strictEqual(findWindowsSdkVersion({ roots: [libRoot], requested: "10.0.22621.0\\" }), "10.0.22621.0");
  assert.throws(() => findWindowsSdkVersion({ roots: [libRoot], requested: "10.0.19041.0" }), /not installed/);
  assert.throws(() => findWindowsSdkVersion({ roots: [path.join(root, "missing")] }), /No complete/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Windows SDK detection tests passed");
