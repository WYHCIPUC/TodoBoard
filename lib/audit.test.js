"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAudit, safeText } = require("./audit");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-audit-"));
try {
  const file = path.join(root, "audit.log");
  const audit = createAudit({ file, maxBytes: 1024 });
  assert.strictEqual(audit.record({ method: "POST\nBAD", route: "/api/status\nsecret", status: 200, auth: "session", local: true }), true);
  const entry = JSON.parse(fs.readFileSync(file, "utf8").trim());
  assert.strictEqual(entry.method, "POST BAD");
  assert.strictEqual(entry.route, "/api/status secret");
  assert.strictEqual(entry.local, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(entry, "body"), false);
  assert.strictEqual(safeText("a\nb", 20), "a b");

  for (let i = 0; i < 30; i++) audit.record({ method: "POST", route: "/api/note", status: 200, auth: "token" });
  assert.ok(fs.existsSync(file + ".previous"), "超过上限时应保留上一份审计日志");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("audit: ALL PASS");
