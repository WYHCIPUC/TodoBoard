"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const allowlist = new Set(fs.readFileSync(path.join(ROOT, "scripts", "release-allowlist.txt"), "utf8")
  .split(/\r?\n/)
  .filter(line => line.startsWith("source "))
  .map(line => line.slice("source ".length).trim()));
const missing = new Set();
const seen = new Set();

function scan(file) {
  if (seen.has(file) || !fs.existsSync(path.join(ROOT, file))) return;
  seen.add(file);
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const match of source.matchAll(/require\("(\.[^"]+)"\)/g)) {
    let target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
    if (!target.endsWith(".js")) target += ".js";
    if (!fs.existsSync(path.join(ROOT, target))) continue;
    if (!allowlist.has(target)) missing.add(target);
    scan(target);
  }
}

for (const entry of ["server.js", "guard.js", "scripts/recover.js", "scripts/upgrade-snapshot.js", "scripts/open-browser.js"]) scan(entry);
assert.deepStrictEqual([...missing].sort(), [], "运行时 require 的相对模块必须全部进入发布 allowlist");

const html = fs.readFileSync(path.join(ROOT, "board.html"), "utf8");
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const asset = match[1];
  if (/^(?:https?:|data:|#)/.test(asset)) continue;
  assert.strictEqual(allowlist.has(asset), true, "board.html 引用的本地资源必须进入发布 allowlist: " + asset);
}

console.log("release-allowlist: ALL PASS");
