"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { searchData, excerpt } = require("./search");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "search-test-"));
const UID = "66666666-6666-4666-8666-666666666666";
const data = `# Test
<!-- linggan:data-version=2 -->

## 1. AI 工具

### ⏳ 1.1 本地研究工具
<!-- linggan:uid=${UID} -->
- **标签**：Markdown, 本地优先
- **作者 / 来源**：[测试](https://example.com)
`;
fs.mkdirSync(path.join(root, UID), { recursive: true });
fs.writeFileSync(path.join(root, UID, "notes.md"), "关键发现：支持无损迁移", "utf-8");
fs.mkdirSync(path.join(root, UID, "archive"), { recursive: true });
fs.writeFileSync(path.join(root, UID, "archive", "content.md"), "正文提到浏览器扩展采集", "utf-8");

assert.strictEqual(searchData(data, "Markdown", { entriesDir: root }).length, 1);
assert.deepStrictEqual(searchData(data, "无损迁移", { entriesDir: root })[0].matches, ["notes"]);
assert.deepStrictEqual(searchData(data, "浏览器扩展", { entriesDir: root })[0].matches, ["content"]);
assert.strictEqual(searchData(data, "本地 迁移", { entriesDir: root }).length, 1);
assert.strictEqual(searchData(data, "不存在", { entriesDir: root }).length, 0);
assert.deepStrictEqual(searchData(data), []);
assert.deepStrictEqual(searchData("# empty", "query"), []);
assert.strictEqual(excerpt(null, []), "");
assert.strictEqual(excerpt("plain text", ["missing"]), "plain text");
const longExcerpt = excerpt("x".repeat(80) + "needle" + "y".repeat(220), ["needle"]);
assert.ok(longExcerpt.startsWith("…") && longExcerpt.endsWith("…"));

fs.rmSync(path.join(root, UID, "notes.md"));
fs.mkdirSync(path.join(root, UID, "notes.md"));
fs.rmSync(path.join(root, UID, "archive", "content.md"));
fs.mkdirSync(path.join(root, UID, "archive", "content.md"));
assert.strictEqual(searchData(data, "Markdown", { entriesDir: root, limit: -5 }).length, 1, "目录型 notes/content 必须安全跳过");

const two = data + `\n### ⏳ 1.2 另一个本地工具\n- **作者 / 来源**：[测试](https://example.net)\n`;
fs.mkdirSync(path.join(root, "1.2"), { recursive: true });
assert.strictEqual(searchData(two, "本地", { entriesDir: root, limit: 1 }).length, 1);
const missingArchive = `# D\n### ⏳ 9.1 Only metadata\n- **标签**：unique-metadata\n`;
assert.strictEqual(searchData(missingArchive, "unique-metadata", { entriesDir: root }).length, 1);

fs.rmSync(root, { recursive: true, force: true });
console.log("search: ALL PASS");
