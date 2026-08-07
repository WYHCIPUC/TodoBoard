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
const snip = store.buildSnippet({ id: "1.2", name: "新", url: "https://example.com/new", desc: "测试", difficulty: 2, site: "测试", tags: "本地优先, 测试", whySaved: "验证方案" });
assert.ok(snip.startsWith("### ⏳ 1.2 新"));
assert.ok(/<!-- linggan:uid=[^ ]+ -->/.test(snip));
assert.ok(snip.includes("- **难度**：⭐⭐"));
assert.ok(snip.includes("- **标签**：本地优先, 测试"));
assert.ok(snip.includes("- **为什么收藏**：验证方案"));

const inserted = store.insertSnippet(seed, "AI 工具", snip);
assert.ok(inserted.includes("### ⏳ 1.2 新"));
assert.ok(
  inserted.indexOf("- **研究要点**：（待补充）") < inserted.indexOf("### ⏳ 1.2 新"),
  "新条目必须插入在上一条目的完整字段块之后"
);

const deleted = store.deleteEntry(inserted, "1.2");
assert.ok(deleted !== null);
assert.ok(!deleted.includes("### ⏳ 1.2 新"));
assert.ok(deleted.includes("- **简介**：seed"), "删除新条目不能连带删除上一条字段");

const customId = store.nextIdIn(seed, "自定义实验");
assert.strictEqual(customId, "2.1");
const customText = store.insertSnippet(seed, "自定义实验", snip.replace("1.2", customId));
assert.ok(customText.includes("## 2. 自定义实验"));

const stUpdated = store.updateStatus(seed, "1.1", "✅");
assert.ok(stUpdated.includes("### ✅ 1.1 已有条目"));
assert.strictEqual(store.updateStatus(seed, "9.9", "✅"), null);

const noteUpdated = store.updateNote(seed, "1.1", "我的笔记");
assert.ok(noteUpdated.includes("- **研究要点**：我的笔记"));

const merged = store.mergeEntryFields(seed, "1.1", { tags: "本地优先, 测试", whySaved: "用于验证合并" });
assert.ok(merged.includes("- **标签**：本地优先, 测试"));
assert.ok(merged.includes("- **为什么收藏**：用于验证合并"));
assert.ok(merged.indexOf("- **标签**：") < merged.indexOf("- **难度**："));
const mergedAgain = store.mergeEntryFields(merged, "1.1", { tags: "测试, 新标签", whySaved: "用于验证合并" });
assert.ok(mergedAgain.includes("- **标签**：本地优先, 测试, 新标签"));
assert.strictEqual((mergedAgain.match(/用于验证合并/g) || []).length, 1);
assert.strictEqual(store.mergeEntryFields(seed, "9.9", { tags: "x" }), null);

// 文件工具测试
assert.strictEqual(store.readAll(), seed);
store.writeWithBackup(inserted);
assert.ok(store.readAll().includes("### ⏳ 1.2 新"));
const backups = fs.readdirSync(tmpDir).filter(f => /^README\.backup-\d{17}(?:-\d+)?\.md$/.test(f));
assert.ok(backups.length >= 1, "应有备份文件");

// 备份失败时不得继续覆盖当前数据。
const beforeFailedBackup = store.readAll();
const originalCopyFileSync = fs.copyFileSync;
fs.copyFileSync = (source, target, ...args) => {
  if (source === tmpReadme && /\.backup-/.test(target)) throw new Error("模拟备份失败");
  return originalCopyFileSync(source, target, ...args);
};
try {
  assert.throws(() => store.writeWithBackup(seed), /模拟备份失败/);
  assert.strictEqual(store.readAll(), beforeFailedBackup, "备份失败后原数据必须保持不变");
} finally {
  fs.copyFileSync = originalCopyFileSync;
}

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("store: ALL PASS");
