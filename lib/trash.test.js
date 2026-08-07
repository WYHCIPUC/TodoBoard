"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "trash-test-"));
const dataFile = path.join(root, "DATA.md");
const entriesDir = path.join(root, "entries");
const trashDir = path.join(root, "trash");
const UID = "55555555-5555-4555-8555-555555555555";
process.env.README_FILE = dataFile;
process.env.ENTRIES_DIR = entriesDir;
process.env.TRASH_DIR = trashDir;
fs.writeFileSync(dataFile, `# Test
<!-- linggan:data-version=2 -->

## 1. AI 工具

### ⏳ 1.1 待删除
<!-- linggan:uid=${UID} -->
- **作者 / 来源**：[测试](https://example.com)
- **研究要点**：保留
`, "utf-8");
fs.mkdirSync(path.join(entriesDir, UID), { recursive: true });
fs.writeFileSync(path.join(entriesDir, UID, "notes.md"), "notes", "utf-8");

const trash = require("./trash");
const schema = require("./schema");

(async () => {
  const archived = await trash.archiveEntry("1.1");
  assert.strictEqual(archived.uid, UID);
  assert.strictEqual(schema.findEntry(fs.readFileSync(dataFile, "utf-8"), "1.1"), null);
  assert.strictEqual(trash.listEntries().length, 1);
  assert.strictEqual(
    fs.readFileSync(path.join(trashDir, archived.record, "data", "notes.md"), "utf-8"),
    "notes"
  );

  const restored = await trash.restoreEntry(archived.record);
  assert.strictEqual(restored.id, "1.1");
  assert.strictEqual(schema.findEntry(fs.readFileSync(dataFile, "utf-8"), UID).title, "待删除");
  assert.strictEqual(fs.readFileSync(path.join(entriesDir, UID, "notes.md"), "utf-8"), "notes");

  const second = await trash.restoreEntry(archived.record);
  assert.strictEqual(second.alreadyRestored, true);
  assert.strictEqual(await trash.archiveEntry("9.9"), null);

  fs.rmSync(root, { recursive: true, force: true });
  console.log("trash: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
