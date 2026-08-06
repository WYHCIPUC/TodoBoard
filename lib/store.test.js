"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "store-test-"));
const tmpReadme = path.join(tmpDir, "README.md");
// 注意:正文标点须与 server.js 一致——冒号用全角「：」,括号用全角「（）」,
// 否则 updateNote 的正则无法命中,断言也会失败。
const seed = `# Test

## 1. AI 工具

### ⏳ 1.1 已有条目
- **简介**：seed
- **作者 / 来源**：[测试](https://example.com)
- **难度**：⭐
- **研究要点**：（待补充）
`;
fs.writeFileSync(tmpReadme, seed, "utf-8");
process.env.README_FILE = tmpReadme;

const store = require("./store");

// 纯函数测试(不碰文件)
assert.strictEqual(store.nextIdIn(seed, "AI 工具"), "1.2");
const snip = store.buildSnippet({ id: "1.2", name: "新", url: "https://example.com/new", desc: "测试", difficulty: 2, site: "测试" });
assert.ok(snip.startsWith("### ⏳ 1.2 新"));
assert.ok(snip.includes("- **难度**：⭐⭐"));

const inserted = store.insertSnippet(seed, "AI 工具", snip);
assert.ok(inserted.includes("### ⏳ 1.2 新"));

const deleted = store.deleteEntry(inserted, "1.2");
assert.ok(deleted !== null);
assert.ok(!deleted.includes("### ⏳ 1.2 新"));

const stUpdated = store.updateStatus(seed, "1.1", "✅");
assert.ok(stUpdated.includes("### ✅ 1.1 已有条目"));
assert.strictEqual(store.updateStatus(seed, "9.9", "✅"), null);

const noteUpdated = store.updateNote(seed, "1.1", "我的笔记");
assert.ok(noteUpdated.includes("- **研究要点**：我的笔记"));

// 文件工具测试
assert.strictEqual(store.readAll(), seed);
store.writeWithBackup(inserted);
assert.ok(store.readAll().includes("### ⏳ 1.2 新"));
const backups = fs.readdirSync(tmpDir).filter(f => f.startsWith("README.backup-"));
assert.ok(backups.length >= 1, "应有备份文件");

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("store: ALL PASS");
