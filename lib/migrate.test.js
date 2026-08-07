"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const migrate = require("./migrate");
const schema = require("./schema");

const UID = "33333333-3333-4333-8333-333333333333";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-test-"));
const dataFile = path.join(root, "DATA.md");
const entriesDir = path.join(root, "entries");
const legacy = `# Test

## 1. AI 工具

### ⏳ 1.1 旧条目
- **作者 / 来源**：[测试](https://example.com)
`;

fs.writeFileSync(dataFile, legacy, "utf-8");
fs.mkdirSync(path.join(entriesDir, "1.1"), { recursive: true });
fs.writeFileSync(path.join(entriesDir, "1.1", "notes.md"), "legacy notes", "utf-8");
fs.mkdirSync(path.join(entriesDir, "1.1", "attachments", "empty"), { recursive: true });
fs.writeFileSync(path.join(entriesDir, "1.1", "attachments", "evidence.txt"), "evidence", "utf-8");

const result = migrate.migrateData({
  dataFile,
  entriesDir,
  uidFactory: () => UID,
  now: new Date("2026-08-06T00:00:00.000Z"),
});
assert.strictEqual(result.copiedEntries, 1);
assert.ok(result.backupDir);
assert.strictEqual(schema.getDataVersion(fs.readFileSync(dataFile, "utf-8")), 2);
assert.strictEqual(fs.readFileSync(path.join(entriesDir, UID, "notes.md"), "utf-8"), "legacy notes");
assert.strictEqual(fs.readFileSync(path.join(entriesDir, UID, "attachments", "evidence.txt"), "utf-8"), "evidence");
assert.ok(fs.existsSync(path.join(entriesDir, UID, "attachments", "empty")), "空目录也应被迁移");
assert.ok(fs.existsSync(path.join(entriesDir, "1.1")), "迁移期应保留旧档案目录以降低风险");
assert.ok(fs.existsSync(path.join(result.backupDir, "DATA.md")));

const again = migrate.migrateData({ dataFile, entriesDir });
assert.strictEqual(again.changed, false);
assert.strictEqual(again.copiedEntries, 0);
assert.strictEqual(again.backupDir, "");

fs.writeFileSync(dataFile, "changed", "utf-8");
fs.writeFileSync(path.join(entriesDir, UID, "notes.md"), "changed notes", "utf-8");
const rolledBack = migrate.rollback(result.backupDir, {
  dataFile,
  entriesDir,
  now: new Date("2026-08-06T01:00:00.000Z"),
});
assert.strictEqual(fs.readFileSync(dataFile, "utf-8"), legacy);
assert.strictEqual(fs.readFileSync(path.join(entriesDir, "1.1", "notes.md"), "utf-8"), "legacy notes");
assert.ok(!fs.existsSync(path.join(entriesDir, UID)), "回滚后应恢复迁移前档案结构");
assert.ok(fs.existsSync(rolledBack.preservedDir), "回滚前的当前状态也必须保留");

fs.rmSync(root, { recursive: true, force: true });
console.log("migrate: ALL PASS");
