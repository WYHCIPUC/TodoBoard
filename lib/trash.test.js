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
  assert.deepStrictEqual(trash.listEntries(), []);
  assert.strictEqual(trash.extractRecord(fs.readFileSync(dataFile, "utf8"), "9.9"), null);
  assert.match(trash.extractRecord("## 1. AI 工具\n### ⏳ 1.1 A\nbody\n### ⏳ 1.2 B", "1.1").block, /body/);
  assert.match(trash.extractRecord("## 1. AI 工具\n### ⏳ 1.1 A\nbody\n---", "1.1").block, /body/);
  await assert.rejects(trash.restoreEntry("../bad"), /非法回收站记录/);
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
  assert.strictEqual(trash.listEntries().length, 0, "恢复后的记录不应继续显示在回收站");
  const restoredMeta = JSON.parse(fs.readFileSync(path.join(trashDir, archived.record, "meta.json"), "utf-8"));
  assert.ok(restoredMeta.restoredAt, "恢复记录应保留可审计的恢复时间");
  assert.strictEqual(restoredMeta.restoredId, "1.1");

  const second = await trash.restoreEntry(archived.record);
  assert.strictEqual(second.alreadyRestored, true);
  assert.strictEqual(await trash.archiveEntry("9.9"), null);

  const invalidRecord = path.join(trashDir, "invalid-record");
  fs.mkdirSync(invalidRecord, { recursive: true });
  fs.writeFileSync(path.join(invalidRecord, "meta.json"), "not-json");
  assert.strictEqual(trash.listEntries().length, 0, "损坏记录必须跳过");

  fs.appendFileSync(dataFile, `\n### ⏳ 1.2 无档案条目\n<!-- linggan:uid=22222222-2222-4222-8222-222222222222 -->\n- **作者 / 来源**：[测试](https://two.example)\n`);
  const noData = await trash.archiveEntry("1.2");
  fs.appendFileSync(dataFile, `\n### ⏳ 1.2 占用编号\n<!-- linggan:uid=99999999-9999-4999-8999-999999999999 -->\n- **作者 / 来源**：[测试](https://replacement.example)\n`);
  const renumbered = await trash.restoreEntry(noData.record);
  assert.notStrictEqual(renumbered.id, "1.2", "编号冲突时必须分配新编号");

  const collisionUid = "33333333-3333-4333-8333-333333333333";
  fs.appendFileSync(dataFile, `\n### ⏳ 1.4 冲突档案\n<!-- linggan:uid=${collisionUid} -->\n- **作者 / 来源**：[测试](https://collision.example)\n`);
  fs.mkdirSync(path.join(entriesDir, collisionUid, "nested"), { recursive: true });
  fs.writeFileSync(path.join(entriesDir, collisionUid, "nested", "file.txt"), "original");
  const collision = await trash.archiveEntry("1.4");
  fs.writeFileSync(path.join(entriesDir, collisionUid, "nested", "file.txt"), "changed");
  await assert.rejects(trash.restoreEntry(collision.record), error => error.code === "trash_restore_collision");

  fs.appendFileSync(dataFile, `\n### ⏳ 1.8 旧式无 UID\n- **作者 / 来源**：[测试](https://legacy.example)\n`);
  const legacyRecord = await trash.archiveEntry("1.8");
  assert.strictEqual(legacyRecord.uid, "");
  const legacyRestored = await trash.restoreEntry(legacyRecord.record);
  assert.strictEqual(legacyRestored.uid, "");

  const specialUid = "88888888-8888-4888-8888-888888888888";
  fs.appendFileSync(dataFile, `\n### ⏳ 1.9 特殊文件\n<!-- linggan:uid=${specialUid} -->\n`);
  fs.mkdirSync(path.join(entriesDir, specialUid), { recursive: true });
  const originalReadDir = fs.readdirSync;
  fs.readdirSync = (directory, options) => path.resolve(String(directory)) === path.resolve(path.join(entriesDir, specialUid)) && options?.withFileTypes
    ? [{ name: "special", isDirectory: () => false, isFile: () => false }]
    : originalReadDir(directory, options);
  try { await assert.rejects(trash.archiveEntry("1.9"), /特殊文件/); }
  finally { fs.readdirSync = originalReadDir; }

  fs.rmSync(root, { recursive: true, force: true });
  console.log("trash: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
