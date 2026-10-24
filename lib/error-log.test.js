"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createErrorLog } = require("./error-log");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "error-log-test-"));
const originalError = console.error;
try {
  const file = path.join(root, "logs", "server-error.log");
  const log = createErrorLog({ file, maxBytes: 1024 });
  console.error = () => {};
  for (let index = 0; index < 40; index++) {
    log.record("test-" + index, new Error("x".repeat(120)));
  }
  assert.ok(fs.existsSync(file), "错误日志必须存在");
  assert.ok(fs.existsSync(file + ".previous"), "超过上限必须保留上一份日志");
  assert.ok(fs.statSync(file).size <= 2048, "轮换后主日志必须有界");
  assert.ok(fs.readFileSync(file + ".previous", "utf8").includes("[test-"), "上一份日志必须保留错误内容");
  assert.ok(fs.readFileSync(file, "utf8").includes("[test-39]"), "轮换后必须继续记录最新错误");

  const rotated = createErrorLog({ file, maxBytes: 1024 });
  rotated.record("manual", new Error("y".repeat(2048)));
  assert.ok(fs.existsSync(file + ".previous"));

  const blocker = path.join(root, "blocker");
  fs.writeFileSync(blocker, "not a directory", "utf8");
  console.error = () => {};
  const unwritable = createErrorLog({ file: path.join(blocker, "server-error.log") });
  assert.doesNotThrow(() => unwritable.record("unwritable", new Error("ignored")));
  assert.strictEqual(fs.existsSync(path.join(blocker, "server-error.log")), false);
} finally {
  console.error = originalError;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("error-log: ALL PASS");
