"use strict";
const assert = require("assert");
const { createCaptureService } = require("./capture");

let text = "seed";
let existing = null;
const store = {
  mutate: async fn => {
    const change = await fn(text);
    if (change.write !== false) text = change.text;
    return change.result;
  },
  findDuplicateUrl: () => existing,
  nextIdIn: () => "1.2",
  buildSnippet: value => "snippet:" + value.name,
  insertSnippet: (current, _category, snippet) => current + "\n" + snippet,
};
const fetcher = {
  assertPublicUrl: async () => true,
  fetchMeta: async () => ({
    title: "自动标题",
    author: "作者",
    category: "AI 工具",
    site: "测试",
  }),
};
const service = createCaptureService({ fetcher, store, guessSource: () => "来源" });

(async () => {
  const added = await service.addUrl("https://example.com/new", { difficulty: 9 });
  assert.strictEqual(added.ok, true);
  assert.strictEqual(added.duplicate, false);
  assert.strictEqual(added.id, "1.2");
  assert.ok(text.includes("snippet:自动标题"));

  existing = { id: "1.1", uid: "uid", title: "已有" };
  const before = text;
  const duplicate = await service.addUrl("https://example.com/existing");
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(duplicate.id, "1.1");
  assert.strictEqual(text, before);

  const forced = await service.addUrl("https://example.com/existing", { allowDuplicate: true, name: "明确保留副本" });
  assert.strictEqual(forced.duplicate, false);
  assert.ok(text.includes("snippet:明确保留副本"));

  await assert.rejects(service.addUrl("javascript:alert(1)"), /有效的 http/);
  console.log("capture: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
