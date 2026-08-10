"use strict";

const assert = require("assert");
const schema = require("./schema");
const storeModule = require("./store");
const { createBookmarkService, parseBookmarks } = require("./bookmarks");

const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>工作</H3>
  <DL><p>
    <DT><H3>人工智能</H3>
    <DL><p>
      <DT><A HREF="https://example.com/a" TAGS="教程,稍后读">示例 A</A>
      <DT><A HREF="https://example.com/a/">重复 A</A>
      <DT><A HREF="https://example.com/b">示例 B</A>
    </DL><p>
  </DL><p>
  <DT><A HREF="javascript:alert(1)">非法</A>
</DL><p>`;

const parsed = parseBookmarks(html);
assert.strictEqual(parsed.items.length, 2);
assert.strictEqual(parsed.repeated, 1);
assert.strictEqual(parsed.invalid, 1);
assert.ok(parsed.items[0].tags.includes("浏览器书签"));
assert.ok(parsed.items[0].tags.includes("工作"));
assert.ok(parsed.items[0].tags.includes("人工智能"));
assert.strictEqual(parsed.items[0].folder, "工作 / 人工智能");
assert.throws(() => parseBookmarks("x".repeat(5 * 1024 * 1024 + 1)), /超过 5MB/);

let text = `# Test
<!-- linggan:data-version=2 -->

## 9. 收件箱

### ⏳ 9.1 已有
<!-- linggan:uid=11111111-1111-4111-8111-111111111111 -->
- **作者 / 来源**：[example.com](https://example.com/a)
- **难度**：⭐
- **研究要点**：（待补充）
`;
let writes = 0;
const fakeStore = {
  readAll: () => text,
  mutate: async fn => {
    const change = await fn(text);
    if (change.write !== false) { text = change.text; writes++; }
    return change.result;
  },
  nextIdIn: storeModule.nextIdIn,
  buildSnippet: storeModule.buildSnippet,
  insertSnippet: storeModule.insertSnippet,
};
const service = createBookmarkService({ store: fakeStore, schema });

(async () => {
  const preview = service.preview(html);
  assert.strictEqual(preview.importable, 1);
  assert.strictEqual(preview.duplicates, 1);

  const imported = await service.importHtml(html);
  assert.strictEqual(imported.imported, 1);
  assert.strictEqual(imported.firstId, "9.2");
  assert.strictEqual(writes, 1, "批量导入只能写入一次");
  assert.ok(text.includes("### ⏳ 9.2 示例 B"));
  assert.ok(text.includes("为什么收藏**：从浏览器书签导入"));

  const again = await service.importHtml(html);
  assert.strictEqual(again.imported, 0);
  assert.strictEqual(writes, 1, "全部重复时不应产生新备份");
  const calls = [];
  let unifiedText = "# Empty\n";
  const unifiedStore = {
    readAll: () => unifiedText,
  };
  const unified = createBookmarkService({
    store: unifiedStore,
    schema,
    capture: {
      addUrl: async (url, input) => {
        calls.push({ url, input });
        return { ok: true, duplicate: false, id: "1." + calls.length, archive: { state: "queued" } };
      },
    },
  });
  const unifiedResult = await unified.importHtml('<DL><p><DT><A HREF="https://example.com/unified">Unified</A></DL><p>');
  assert.strictEqual(unifiedResult.imported, 1);
  assert.strictEqual(calls.length, 1, "书签导入复用统一入口");
  assert.strictEqual(calls[0].input.source, "bookmarks");
  assert.strictEqual(calls[0].input.allowUnresolved, true);
  console.log("bookmarks: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
