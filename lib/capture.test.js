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
  const events = [];
  let savedText = "seed";
  let enqueues = 0;
  const archive = {
    enqueue: entry => { enqueues++; events.push("enqueue:" + entry.url); return { id: entry.id, state: "queued" }; },
    getStatus: () => null,
  };
  const saveFirstStore = {
    mutate: async fn => {
      events.push("save");
      const change = await fn(savedText);
      if (change.write !== false) savedText = change.text;
      return change.result;
    },
    findDuplicateUrl: () => null,
    nextIdIn: () => "2.1",
    buildSnippet: value => "saved:" + value.name,
    insertSnippet: (current, _category, snippet) => current + "\n" + snippet,
    readAll: () => savedText,
  };
  const saveFirst = createCaptureService({
    store: saveFirstStore,
    archive,
    fetcher: { assertPublicUrl: async () => { events.push("validate"); } },
    guessSource: () => "test",
  });
  const queued = await saveFirst.addUrl("https://example.com/save-first", { name: "Saved" });
  assert.strictEqual(queued.archive.state, "queued");
  assert.strictEqual(enqueues, 1, "一个入口只入队一次");
  assert.deepStrictEqual(events, ["validate", "save", "enqueue:https://example.com/save-first"]);

  const failedArchive = createCaptureService({
    store: Object.assign({}, saveFirstStore, { nextIdIn: () => "2.2" }),
    archive: { enqueue: () => { throw new Error("queue down"); } },
    fetcher: { assertPublicUrl: async () => {} },
    guessSource: () => "test",
  });
  const savedDespiteFailure = await failedArchive.addUrl("https://example.com/queue-failure", { name: "Saved anyway" });
  assert.strictEqual(savedDespiteFailure.ok, true);
  assert.strictEqual(savedDespiteFailure.archive.state, "failed");
  assert.ok(savedText.includes("Saved anyway"), "归档失败不能回滚已保存 URL");
  console.log("capture: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
