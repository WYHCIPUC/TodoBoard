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
  await assert.rejects(service.addUrl("https://user:secret@example.com/private"), /用户名或密码/);
  await assert.rejects(service.addUrl("http://127.0.0.1/private"), /本地|内网/);
  await assert.rejects(service.addUrl("http://[::1]/private"), /本地|内网/);
  await assert.rejects(service.addUrl("http://[::ffff:127.0.0.1]/private"), /本地|内网/);
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
  assert.deepStrictEqual(events, ["save", "enqueue:https://example.com/save-first"]);

  const unresolvedEvents = [];
  const unresolved = createCaptureService({
    store: Object.assign({}, saveFirstStore, {
      mutate: async fn => {
        unresolvedEvents.push("save");
        const change = await fn(savedText);
        if (change.write !== false) savedText = change.text;
        return change.result;
      },
      nextIdIn: () => "2.3",
    }),
    archive: {
      enqueue: entry => {
        unresolvedEvents.push("enqueue:" + entry.url);
        return { id: entry.id, state: "queued" };
      },
    },
    fetcher: {
      assertPublicUrl: async () => {
        unresolvedEvents.push("dns");
        throw new Error("域名解析失败：ENOTFOUND");
      },
    },
    guessSource: () => "test",
  });
  const unresolvedResult = await unresolved.addUrl("https://not-resolved.invalid/article", { name: "Unresolved" });
  assert.strictEqual(unresolvedResult.ok, true);
  assert.strictEqual(unresolvedResult.archive.state, "queued");
  assert.deepStrictEqual(unresolvedEvents, ["save", "enqueue:https://not-resolved.invalid/article"]);

  let duplicateEnqueue = null;
  const duplicateArchive = createCaptureService({
    store: Object.assign({}, saveFirstStore, {
      findDuplicateUrl: () => ({ id: "2.4", uid: "uid-2.4", title: "Existing" }),
    }),
    archive: {
      getStatus: () => null,
      enqueue: entry => {
        duplicateEnqueue = entry;
        return { id: entry.id, state: "queued" };
      },
    },
    fetcher: { assertPublicUrl: async () => {} },
    guessSource: () => "test",
  });
  const duplicateQueued = await duplicateArchive.addUrl("https://example.com/existing-again");
  assert.strictEqual(duplicateQueued.duplicate, true);
  assert.strictEqual(duplicateQueued.archive.state, "queued");
  assert.deepStrictEqual(duplicateEnqueue, {
    id: "2.4",
    uid: "uid-2.4",
    url: "https://example.com/existing-again",
    title: "Existing",
    source: "capture",
  });
  const duplicateKnown = createCaptureService({
    store: Object.assign({}, saveFirstStore, { findDuplicateUrl: () => ({ id: "2.4", uid: "uid-2.4", title: "Existing" }) }),
    archive: { getStatus: () => ({ id: "2.4", state: "running" }) },
  });
  assert.strictEqual((await duplicateKnown.addUrl("https://example.com/known")).archive.state, "running");

  const enrichmentFailure = createCaptureService({
    store: Object.assign({}, saveFirstStore, { nextIdIn: () => "2.8", readAll: () => { throw new Error("read failed"); } }),
    archive: { enqueue: entry => ({ id: entry.id, state: "queued" }) },
    fetcher: { fetchMeta: async () => { throw new Error("offline"); } },
  });
  assert.strictEqual((await enrichmentFailure.addUrl("https://example.com/offline", { category: "#", difficulty: -1 })).ok, true);

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

  const archiveCalls = [];
  let knownStatus = null;
  const manualStore = Object.assign({}, saveFirstStore, {
    readAll: () => `# Data\n<!-- linggan:data-version=2 -->\n## 1. AI 工具\n### ⏳ 3.1 Manual\n<!-- linggan:uid=33333333-3333-4333-8333-333333333333 -->\n- **作者 / 来源**：[site](https://example.com/manual)\n`,
  });
  const archiveApi = {
    queue: { start: () => archiveCalls.push("start") },
    stop: () => archiveCalls.push("stop"),
    retry: id => ({ id, state: "queued" }),
    getStatus: id => knownStatus && id === "3.1" ? knownStatus : null,
    enqueue: entry => { archiveCalls.push("enqueue:" + entry.id); return { id: entry.id, state: "queued" }; },
    archiveContent: async (id, content) => ({ id, content, state: "succeeded" }),
  };
  const manualService = createCaptureService({ store: manualStore, archive: archiveApi });
  assert.strictEqual(manualService.queueArchive("3.1", "manual").state, "queued");
  assert.strictEqual((await manualService.archiveContent("3.1", "# body")).state, "succeeded");
  knownStatus = { id: "3.1", state: "succeeded" };
  assert.strictEqual(manualService.queueArchive("3.1").state, "succeeded");
  assert.strictEqual(manualService.getArchiveStatus("3.1").state, "succeeded");
  assert.strictEqual(manualService.retryArchive("3.1").state, "queued");
  manualService.start();
  manualService.stop();
  assert.ok(archiveCalls.includes("start") && archiveCalls.includes("stop"));
  assert.throws(() => manualService.queueArchive("9.9"), error => error.statusCode === 404);
  const unavailable = createCaptureService({ store: manualStore, archive: null });
  assert.throws(() => unavailable.queueArchive("3.1"), error => error.statusCode === 503);
  await assert.rejects(unavailable.archiveContent("3.1", "x"), error => error.statusCode === 503);
  assert.strictEqual(unavailable.start(), null);
  assert.strictEqual(unavailable.stop(), null);
  assert.strictEqual(unavailable.getArchiveStatus("3.1"), null);
  assert.strictEqual(unavailable.retryArchive("3.1"), null);
  console.log("capture: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
