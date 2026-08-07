"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
const dataFile = path.join(root, "DATA.md");
const entriesDir = path.join(root, "entries");
const UID = "77777777-7777-4777-8777-777777777777";
process.env.README_FILE = dataFile;
process.env.ENTRIES_DIR = entriesDir;
fs.writeFileSync(dataFile, `# Test
<!-- linggan:data-version=2 -->

## 1. AI 工具

### ⏳ 1.1 原标题
<!-- linggan:uid=${UID} -->
- **作者 / 来源**：[测试](https://example.com)
`, "utf-8");
fs.mkdirSync(path.join(entriesDir, UID, "screenshots"), { recursive: true });
fs.writeFileSync(path.join(entriesDir, UID, "notes.md"), "original notes", "utf-8");
fs.writeFileSync(path.join(entriesDir, UID, "screenshots", "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));

const backup = require("./backup");

(async () => {
  const bundle = backup.exportBundle();
  assert.strictEqual(bundle.format, "linggan-backup");
  assert.strictEqual(bundle.entries.length, 1);
  assert.strictEqual(bundle.entries[0].files.length, 2);
  assert.strictEqual(backup.validateBundle(bundle).entryCount, 1);

  bundle.data = bundle.data.replace("原标题", "恢复后的标题");
  bundle.entries[0].files.find(file => file.name === "notes.md").data = "restored notes";
  const result = await backup.importBundle(bundle);
  assert.strictEqual(result.entryCount, 1);
  assert.ok(result.backupDir);
  assert.ok(fs.readFileSync(dataFile, "utf-8").includes("恢复后的标题"));
  assert.strictEqual(fs.readFileSync(path.join(entriesDir, UID, "notes.md"), "utf-8"), "restored notes");

  const invalid = JSON.parse(JSON.stringify(bundle));
  invalid.entries[0].files[0].name = "../escape.txt";
  assert.throws(() => backup.validateBundle(invalid), /非法文件/);

  fs.rmSync(root, { recursive: true, force: true });
  console.log("backup: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
