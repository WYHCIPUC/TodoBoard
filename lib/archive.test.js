"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { createArchiveService, defaultFetch, MAX_RAW_HTML } = require("./archive");

function tempPaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-archive-"));
  return { root, entriesDir: path.join(root, "docs", "entries"), runtimeDir: path.join(root, ".linggan") };
}

(async () => {
  const paths = tempPaths();
  try {
    const service = createArchiveService({
      paths,
      useQueue: false,
      clock: () => Date.parse("2026-01-01T00:00:00.000Z"),
      validateUrl: async () => {},
      fetch: async () => ({
        title: "归档标题",
        author: "作者",
        summary: "摘要",
        markdown: "正文 **可读**",
        rawHtml: "<html>raw</html>",
        source: "fixture",
        cover: { data: Buffer.from("cover"), contentType: "image/png" },
        images: [{ data: Buffer.from("key"), contentType: "image/jpeg" }],
      }),
    });
    const basic = await service.archiveTask({
      id: "1.1", uid: "entry-1", url: "https://example.com/a", entry: { title: "旧标题" }, createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(basic.state, "succeeded");
    const dir = path.join(paths.entriesDir, "entry-1", "archive");
    assert.ok(fs.existsSync(path.join(dir, "content.md")));
    assert.ok(fs.existsSync(path.join(dir, "images", "cover.png")));
    assert.ok(fs.existsSync(path.join(dir, "images", "key-01.jpg")));
    assert.deepStrictEqual(zlib.gunzipSync(fs.readFileSync(path.join(dir, "raw.html.gz"))).toString(), "<html>raw</html>");
    const metadata = JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf8"));
    assert.strictEqual(metadata.url, "https://example.com/a");
    assert.strictEqual(metadata.title, "归档标题");
    assert.strictEqual(metadata.fieldSources.markdown, "fixture");
    assert.ok(metadata.artifacts.images.includes("images/cover.png"));
    assert.strictEqual(fs.readdirSync(dir).some(name => name.includes(".tmp-")), false);

    const exactPaths = tempPaths();
    const exact = createArchiveService({
      paths: exactPaths, useQueue: false, clock: () => Date.now(),
      fetch: async () => ({ title: "边界", markdown: "正文", rawHtml: Buffer.alloc(MAX_RAW_HTML, 65) }),
    });
    const exactResult = await exact.archiveTask({ id: "1.2", url: "https://example.com/exact" });
    assert.strictEqual(exactResult.state, "succeeded");
    assert.ok(fs.existsSync(path.join(exactPaths.entriesDir, "1.2", "archive", "raw.html.gz")));
    fs.rmSync(exactPaths.root, { recursive: true, force: true });

    const largePaths = tempPaths();
    const large = createArchiveService({
      paths: largePaths, useQueue: false, fetch: async () => ({
        title: "超限仍保留正文", markdown: "正文仍在", rawHtml: Buffer.alloc(MAX_RAW_HTML + 1, 66),
        cover: { data: Buffer.from("image"), contentType: "image/png" },
      }),
    });
    const largeResult = await large.archiveTask({ id: "1.3", url: "https://example.com/large" });
    assert.strictEqual(largeResult.state, "partial");
    const largeDir = path.join(largePaths.entriesDir, "1.3", "archive");
    assert.ok(fs.existsSync(path.join(largeDir, "content.md")));
    assert.ok(fs.existsSync(path.join(largeDir, "images", "cover.png")));
    assert.strictEqual(fs.existsSync(path.join(largeDir, "raw.html.gz")), false);
    assert.match(fs.readFileSync(path.join(largeDir, "metadata.json"), "utf8"), /超过20MB/);
    fs.rmSync(largePaths.root, { recursive: true, force: true });

    const failedPaths = tempPaths();
    const failed = createArchiveService({
      paths: failedPaths, useQueue: false, fetch: async () => { throw new Error("网络不可用"); },
    });
    const failedResult = await failed.archiveTask({
      id: "1.4", url: "https://example.com/fail", entry: { title: "已保存标题", author: "已保存作者" },
    });
    assert.strictEqual(failedResult.state, "partial");
    const failedMeta = JSON.parse(fs.readFileSync(path.join(failedPaths.entriesDir, "1.4", "archive", "metadata.json"), "utf8"));
    assert.strictEqual(failedMeta.title, "已保存标题");
    assert.ok(failedMeta.degradationReasons.length);
    fs.rmSync(failedPaths.root, { recursive: true, force: true });

    const manualPaths = tempPaths();
    const manual = createArchiveService({ paths: manualPaths, useQueue: false, fetch: async () => { throw new Error("should not fetch"); } });
    manual.enqueue({ id: "1.5", url: "https://example.com/manual", title: "手动条目" });
    const manualResult = await manual.archiveContent("1.5", "# 手动内容");
    assert.strictEqual(manualResult.state, "succeeded");
    assert.match(fs.readFileSync(path.join(manualPaths.entriesDir, "1.5", "archive", "content.md"), "utf8"), /手动内容/);
    fs.rmSync(manualPaths.root, { recursive: true, force: true });

    const queuedPaths = tempPaths();
    const queued = createArchiveService({ paths: queuedPaths, autoStart: false, fetch: async () => ({ markdown: "不应抓取", rawHtml: "x" }) });
    assert.deepStrictEqual(queued.enqueue({ id: "1.6", url: "https://example.com/queued" }), { id: "1.6", state: "queued" });
    assert.strictEqual(queued.getStatus("1.6").state, "queued");
    const queuedResult = await queued.archiveContent("1.6", "# 队列手动内容");
    assert.strictEqual(queuedResult.state, "succeeded");
    await queued.stop();
    fs.rmSync(queuedPaths.root, { recursive: true, force: true });

    const parsed = await defaultFetch("https://example.com/read", {
      httpGet: async () => ({ status: 200, body: "<html><head><title>页面标题</title><meta name=\"author\" content=\"网页作者\"><meta property=\"og:image\" content=\"https://img.example/a.png\"></head><body><article><p>可读正文</p></article></body></html>" }),
    });
    assert.strictEqual(parsed.title, "页面标题");
    assert.strictEqual(parsed.author, "网页作者");
    assert.match(parsed.markdown, /可读正文/);
    await assert.rejects(defaultFetch("https://example.com/bad", { httpGet: async () => ({ status: 503, body: "bad" }) }), /HTTP 503/);

    const imagePaths = tempPaths();
    const imageService = createArchiveService({
      paths: imagePaths, useQueue: false, validateUrl: async url => { if (url.includes("blocked")) throw new Error("图片 URL 被拒绝"); },
      fetchImage: async url => url.includes("object") ? { body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png" } : Buffer.from("jpeg"),
      fetch: async () => ({
        title: "图片测试", markdown: "正文", rawHtml: "raw",
        cover: { url: "https://img.example/object.png" },
        images: [{ url: "https://img.example/object.png" }, { url: "https://img.example/blocked.png" }],
      }),
    });
    const imageResult = await imageService.archiveTask({ id: "1.7", url: "https://example.com/images" });
    assert.strictEqual(imageResult.state, "partial");
    assert.ok(fs.existsSync(path.join(imagePaths.entriesDir, "1.7", "archive", "images", "cover.png")));
    fs.rmSync(imagePaths.root, { recursive: true, force: true });

    const direct = createArchiveService({ useQueue: false });
    assert.deepStrictEqual(direct.enqueue({ uid: "direct", url: "https://example.com/direct" }), { id: "direct", state: "queued" });
    assert.deepStrictEqual(direct.getStatus("direct"), { id: "direct", state: "queued", attempt: 0, nextRunAt: null });
    assert.strictEqual(direct.getStatus("missing"), null);
    assert.throws(() => direct.retry("direct"));
    assert.throws(() => direct.enqueue({ url: "https://example.com/no-id" }));
    assert.throws(() => direct.enqueue({ id: "../escape", url: "https://example.com/escape" }));
    await assert.rejects(() => direct.archiveTask({ id: "bad", uid: "../escape", url: "https://example.com/bad" }));

    const variantsPaths = tempPaths();
    const variants = createArchiveService({
      paths: variantsPaths, useQueue: false, validateUrl: async () => {},
      fetchImage: async url => url.includes("jpg") ? Buffer.from([0xff, 0xd8, 0xff]) : { body: Buffer.from("downloaded") },
      fetch: async () => ({ title: "variants", markdown: "body", rawHtml: "raw", images: [42,
        { data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: "" },
        { data: "Z2lm", contentType: "image/gif" },
        { data: Buffer.from("webp"), type: "image/webp" },
        { data: Buffer.from("svg"), contentType: "image/svg+xml" },
        { data: Buffer.from("jpeg"), contentType: "image/jpeg" },
        "https://img.example/download.jpg",
        "https://img.example/download.bin",
        { data: "" },
        { data: Buffer.alloc(10 * 1024 * 1024 + 1), contentType: "image/png" },
      ] }),
    });
    const variantsResult = await variants.archiveTask({ id: "variants", url: "https://example.com/variants" });
    assert.strictEqual(variantsResult.state, "partial");
    const variantsDir = path.join(variantsPaths.entriesDir, "variants", "archive", "images");
    assert.ok(fs.existsSync(path.join(variantsDir, "key-01.png")));
    assert.ok(fs.existsSync(path.join(variantsDir, "key-02.gif")));
    assert.ok(fs.existsSync(path.join(variantsDir, "key-03.webp")));
    assert.ok(fs.existsSync(path.join(variantsDir, "key-04.svg")));
    assert.ok(fs.existsSync(path.join(variantsDir, "key-05.jpg")));
    assert.ok(fs.existsSync(path.join(variantsDir, "key-06.jpg")));
    assert.ok(fs.existsSync(path.join(variantsDir, "key-07.bin")));
    fs.rmSync(variantsPaths.root, { recursive: true, force: true });

    const invalidFetchPaths = tempPaths();
    const invalidFetch = createArchiveService({ paths: invalidFetchPaths, useQueue: false, fetch: async () => null });
    const invalidFetchResult = await invalidFetch.archiveTask({ id: "invalid-fetch", url: "https://example.com/invalid-fetch" });
    assert.strictEqual(invalidFetchResult.state, "partial");
    fs.rmSync(invalidFetchPaths.root, { recursive: true, force: true });

    const fallbackPaths = tempPaths();
    const fallback = createArchiveService({ paths: fallbackPaths, useQueue: false, fetch: async () => ({ html: "<p>html body</p>", content: "content fallback", desc: "description fallback" }) });
    const fallbackResult = await fallback.archiveTask({ id: "fallback", url: "https://example.com/fallback", entry: { title: "entry title", summary: "entry summary", author: "entry author" } });
    assert.strictEqual(fallbackResult.state, "succeeded");
    assert.match(fs.readFileSync(path.join(fallbackPaths.entriesDir, "fallback", "archive", "content.md"), "utf8"), /content fallback/);
    fs.rmSync(fallbackPaths.root, { recursive: true, force: true });

    const contentFailPaths = tempPaths();
    const contentFail = createArchiveService({ paths: contentFailPaths, useQueue: false, fetch: async () => {
      fs.mkdirSync(path.join(contentFailPaths.entriesDir, "content-fail", "archive", "content.md"), { recursive: true });
      return { markdown: "body", rawHtml: "raw" };
    } });
    const contentFailResult = await contentFail.archiveTask({ id: "content-fail", url: "https://example.com/content-fail" });
    assert.strictEqual(contentFailResult.state, "partial");
    fs.rmSync(contentFailPaths.root, { recursive: true, force: true });

    const rawFailPaths = tempPaths();
    const rawFail = createArchiveService({ paths: rawFailPaths, useQueue: false, fetch: async () => {
      fs.mkdirSync(path.join(rawFailPaths.entriesDir, "raw-fail", "archive", "raw.html.gz"), { recursive: true });
      return { markdown: "body", rawHtml: "raw" };
    } });
    const rawFailResult = await rawFail.archiveTask({ id: "raw-fail", url: "https://example.com/raw-fail" });
    assert.strictEqual(rawFailResult.state, "partial");
    fs.rmSync(rawFailPaths.root, { recursive: true, force: true });

    const metadataFailPaths = tempPaths();
    const metadataFail = createArchiveService({ paths: metadataFailPaths, useQueue: false, fetch: async () => {
      fs.mkdirSync(path.join(metadataFailPaths.entriesDir, "metadata-fail", "archive", "metadata.json"), { recursive: true });
      return { markdown: "body", rawHtml: "raw" };
    } });
    const metadataFailResult = await metadataFail.archiveTask({ id: "metadata-fail", url: "https://example.com/metadata-fail" });
    assert.strictEqual(metadataFailResult.state, "partial");
    assert.ok(metadataFailResult.metadata.errors.some(error => error.includes("metadata")));
    fs.rmSync(metadataFailPaths.root, { recursive: true, force: true });

    const bufferParsed = await defaultFetch("https://example.com/buffer", {
      httpGet: async () => ({ status: 200, body: Buffer.from("<html><head><meta name=\"description\" content=\"buffer summary\"></head><body><p>buffer body</p></body></html>") }),
    });
    assert.match(bufferParsed.markdown, /buffer body/);
    await assert.rejects(defaultFetch("https://example.com/empty", { httpGet: async () => ({ status: 200, body: "<html><body></body></html>" }) }));

    const warningOnlyPaths = tempPaths();
    const warningOnly = createArchiveService({ paths: warningOnlyPaths, useQueue: false, fetch: async () => ({ ok: true, warning: "warning-only", markdown: "body", rawHtml: "raw" }) });
    const warningOnlyResult = await warningOnly.archiveTask({ id: "warning-only", url: "https://example.com/warning-only" });
    assert.strictEqual(warningOnlyResult.state, "partial");
    fs.rmSync(warningOnlyPaths.root, { recursive: true, force: true });

    const warningPaths = tempPaths();
    const warningService = createArchiveService({ paths: warningPaths, useQueue: false, fetch: async () => ({ ok: false, warning: "需要登录", title: "已有标题" }) });
    const warningResult = await warningService.archiveTask({ id: "1.8", url: "https://example.com/warning" });
    assert.strictEqual(warningResult.state, "partial");
    assert.match(JSON.stringify(warningResult.metadata.errors), /需要登录/);
    await assert.rejects(() => warningService.archiveContent("1.8", ""), /不能为空/);
    await assert.rejects(() => warningService.archiveContent("missing", "# 内容"), /未知/);
    assert.throws(() => warningService.retry("1.8"), /不可用/);
    fs.rmSync(warningPaths.root, { recursive: true, force: true });
  } finally {
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
})().then(() => console.log("archive: ALL PASS")).catch(error => { console.error(error); process.exitCode = 1; });
