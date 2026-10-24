"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { searchData, excerpt, createReadCache } = require("./search");

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
/* 缓存：命中、文件变化失效、截断/跳过语义、容量上限 */
const cacheFile = path.join(root, "cache-fixture.txt");
const cache = createReadCache({ maxEntries: 2, maxChars: 1024 });
fs.writeFileSync(cacheFile, "alpha", "utf8");
assert.strictEqual(cache.read(cacheFile), "alpha");
assert.strictEqual(cache.read(cacheFile), "alpha");
assert.strictEqual(cache.stats().hits, 1, "重复读取必须命中缓存");
fs.writeFileSync(cacheFile, "bravo", "utf8");
const later = new Date(Date.now() + 60_000);
fs.utimesSync(cacheFile, later, later);
assert.strictEqual(cache.read(cacheFile), "bravo", "文件重写后不得返回旧内容");
fs.writeFileSync(cacheFile, "0123456789", "utf8");
assert.strictEqual(cache.read(cacheFile, { limit: 4 }), "0123");
assert.strictEqual(cache.read(cacheFile, { limit: 4, truncate: false }), null, "超限且不截断时按跳过处理");
assert.strictEqual(cache.read(path.join(root, "missing-fixture.txt")), null);
assert.strictEqual(cache.read(root), null, "目录不得作为可读文本缓存");
const tiny = createReadCache({ maxEntries: 1, maxChars: 1024 });
fs.writeFileSync(path.join(root, "cache-one.txt"), "one", "utf8");
fs.writeFileSync(path.join(root, "cache-two.txt"), "two", "utf8");
tiny.read(path.join(root, "cache-one.txt"));
tiny.read(path.join(root, "cache-two.txt"));
assert.strictEqual(tiny.stats().entries, 1, "缓存必须有界");
tiny.clear();
assert.deepStrictEqual(tiny.stats(), { entries: 0, chars: 0, hits: 0, misses: 0, maxEntries: 1, maxChars: 1024 });

const searchCache = createReadCache();
assert.strictEqual(searchData(data, "无损迁移", { entriesDir: root, cache: searchCache }).length, 1);
fs.writeFileSync(path.join(root, UID, "notes.md"), "关键发现：缓存失效后的新结论", "utf-8");
assert.deepStrictEqual(searchData(data, "无损迁移", { entriesDir: root, cache: searchCache }), [], "文件变化后旧内容必须失效");
assert.deepStrictEqual(searchData(data, "新结论", { entriesDir: root, cache: searchCache })[0].matches, ["notes"]);
assert.ok(searchCache.stats().hits > 0);

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
