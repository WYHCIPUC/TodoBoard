"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { searchData } = require("./search");

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
fs.writeFileSync(path.join(root, UID, "content.md"), "正文提到浏览器扩展采集", "utf-8");

assert.strictEqual(searchData(data, "Markdown", { entriesDir: root }).length, 1);
assert.deepStrictEqual(searchData(data, "无损迁移", { entriesDir: root })[0].matches, ["notes"]);
assert.deepStrictEqual(searchData(data, "浏览器扩展", { entriesDir: root })[0].matches, ["content"]);
assert.strictEqual(searchData(data, "本地 迁移", { entriesDir: root }).length, 1);
assert.strictEqual(searchData(data, "不存在", { entriesDir: root }).length, 0);

fs.rmSync(root, { recursive: true, force: true });
console.log("search: ALL PASS");
