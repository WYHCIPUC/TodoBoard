"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

process.env.ALLOW_PRIVATE_NETWORK = "1";
const { createArchiveService, defaultFetch, atomicWrite, MAX_RAW_HTML, recoverArchiveTransactions } = require("./archive");
const LONG = "这是用于可信归档固定夹具的足够长正文内容，可以稳定跨过自动正文四十个 Unicode 字符的可用性边界。";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const GIF = Buffer.from("GIF89a", "ascii");
const WEBP = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii")]);

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
        markdown: LONG + " **可读**",
        rawHtml: "<html>raw</html>",
        source: "fixture",
        cover: { data: PNG, contentType: "image/png" },
        images: [{ data: JPEG, contentType: "image/jpeg" }],
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
    assert.strictEqual(metadata.entry.url, "https://example.com/a");
    assert.strictEqual(metadata.entry.title, "归档标题");
    assert.strictEqual(metadata.capture.authority, "site_scraper");
    assert.ok(fs.existsSync(path.join(dir, "manifest.json")));
    assert.ok(fs.existsSync(path.join(paths.entriesDir, "entry-1", "protected-generations", basic.snapshotId, "archive", "content.md")));
    assert.strictEqual(fs.readdirSync(dir).some(name => name.includes(".tmp-")), false);
    const basicMarker = path.join(paths.entriesDir, "entry-1", ".archive-transaction-" + basic.snapshotId + ".json");
    const interruptedBasic = JSON.parse(fs.readFileSync(basicMarker, "utf8"));
    interruptedBasic.state = "verified";
    fs.writeFileSync(basicMarker, JSON.stringify(interruptedBasic));
    fs.rmSync(path.join(paths.entriesDir, "entry-1", "protected-generations", "current.json"));
    assert.deepStrictEqual(recoverArchiveTransactions(paths), { recovered: 1, rolledBack: 0 });
    assert.strictEqual(JSON.parse(fs.readFileSync(basicMarker, "utf8")).state, "completed");
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(paths.entriesDir, "entry-1", "protected-generations", "current.json"), "utf8")).snapshotId, basic.snapshotId);
    fs.rmSync(path.join(paths.entriesDir, "entry-1", "protected-generations", "current.json"));
    const pointerRepair = await service.protectExisting("entry-1");
    assert.strictEqual(pointerRepair.protected, true);
    assert.strictEqual(pointerRepair.snapshotId, basic.snapshotId);
    assert.strictEqual((await service.protectExisting("entry-1")).protected, false);
    const warned = await service.addMigrationWarning("entry-1", "legacy_content_conflict");
    assert.ok(warned.operationId);
    assert.strictEqual((await service.addMigrationWarning("entry-1", "legacy_content_conflict")).changed, false);
    await assert.rejects(service.restoreProtected("entry-1", { snapshotId: crypto.randomUUID(), manifestSha256: "0".repeat(64) }), /不可恢复/);
    assert.throws(() => service.consumeManualDraft("entry-1", "bad"), /hash 非法/);
    await assert.rejects(service.protectExisting(), /非法/);
    const atomicFile = path.join(paths.root, "atomic.txt");
    atomicWrite(atomicFile, "atomic");
    assert.strictEqual(fs.readFileSync(atomicFile, "utf8"), "atomic");

    const previousCwd = process.cwd();
    const defaultRecoveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-archive-default-recovery-"));
    try {
      process.chdir(defaultRecoveryRoot);
      assert.deepStrictEqual(recoverArchiveTransactions(), { recovered: 0, rolledBack: 0 });
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(defaultRecoveryRoot, { recursive: true, force: true });
    }

    const earlyPaths = tempPaths();
    const earlyUid = "early";
    const earlyId = crypto.randomUUID();
    const earlyEntry = path.join(earlyPaths.entriesDir, earlyUid);
    fs.mkdirSync(path.join(earlyEntry, ".archive-stage-" + earlyId), { recursive: true });
    fs.writeFileSync(path.join(earlyEntry, ".archive-transaction-" + earlyId + ".json"), JSON.stringify({
      version: 1, uid: earlyUid, snapshotId: earlyId, state: "stage_ready", stageManifestHash: "0".repeat(64), previousCurrent: null,
    }));
    assert.deepStrictEqual(recoverArchiveTransactions(earlyPaths), { recovered: 0, rolledBack: 1 });
    assert.strictEqual(fs.existsSync(path.join(earlyEntry, ".archive-stage-" + earlyId)), false);
    const badId = crypto.randomUUID();
    fs.writeFileSync(path.join(earlyEntry, ".archive-transaction-" + badId + ".json"), "not-json");
    assert.throws(() => recoverArchiveTransactions(earlyPaths), error => error.code === "manual_recovery_required");
    fs.unlinkSync(path.join(earlyEntry, ".archive-transaction-" + badId + ".json"));
    fs.writeFileSync(path.join(earlyPaths.entriesDir, "not-an-entry.txt"), "x");
    const invalidMarkerId = crypto.randomUUID();
    const invalidMarkerFile = path.join(earlyEntry, ".archive-transaction-" + invalidMarkerId + ".json");
    const validMarker = {
      version: 1,
      uid: earlyUid,
      snapshotId: invalidMarkerId,
      state: "completed",
      stageManifestHash: "0".repeat(64),
    };
    for (const marker of [
      null,
      { ...validMarker, version: 2 },
      { ...validMarker, uid: "other" },
      { ...validMarker, snapshotId: crypto.randomUUID() },
      { ...validMarker, state: "unknown" },
      { ...validMarker, stageManifestHash: "bad" },
    ]) {
      fs.writeFileSync(invalidMarkerFile, JSON.stringify(marker));
      assert.throws(() => recoverArchiveTransactions(earlyPaths), error => error.code === "manual_recovery_required");
    }
    fs.unlinkSync(invalidMarkerFile);
    const nonUuidId = "-".repeat(36);
    const nonUuidFile = path.join(earlyEntry, ".archive-transaction-" + nonUuidId + ".json");
    fs.writeFileSync(nonUuidFile, JSON.stringify({ ...validMarker, snapshotId: nonUuidId }));
    assert.throws(() => recoverArchiveTransactions(earlyPaths), error => error.code === "manual_recovery_required");
    fs.unlinkSync(nonUuidFile);
    const oldRestoredId = crypto.randomUUID();
    fs.mkdirSync(path.join(earlyEntry, ".archive-old-" + oldRestoredId));
    fs.writeFileSync(path.join(earlyEntry, ".archive-transaction-" + oldRestoredId + ".json"), JSON.stringify({
      ...validMarker, snapshotId: oldRestoredId, state: "old_restored", oldManifestHash: null, previousCurrent: null,
    }));
    assert.deepStrictEqual(recoverArchiveTransactions(earlyPaths), { recovered: 0, rolledBack: 1 });
    fs.mkdirSync(path.join(earlyEntry, ".archive-stage-" + earlyId));
    fs.mkdirSync(path.join(earlyEntry, ".archive-old-" + earlyId));
    fs.mkdirSync(path.join(earlyEntry, "protected-generations", ".stage-" + earlyId), { recursive: true });
    assert.deepStrictEqual(recoverArchiveTransactions(earlyPaths), { recovered: 0, rolledBack: 0 });
    const protectedReadyId = crypto.randomUUID();
    fs.mkdirSync(path.join(earlyEntry, ".archive-stage-" + protectedReadyId));
    fs.mkdirSync(path.join(earlyEntry, "protected-generations", ".stage-" + protectedReadyId), { recursive: true });
    fs.writeFileSync(path.join(earlyEntry, ".archive-transaction-" + protectedReadyId + ".json"), JSON.stringify({
      ...validMarker, snapshotId: protectedReadyId, state: "protected_ready",
    }));
    assert.deepStrictEqual(recoverArchiveTransactions(earlyPaths), { recovered: 0, rolledBack: 1 });
    const emptyCompletedId = crypto.randomUUID();
    fs.writeFileSync(path.join(earlyEntry, ".archive-transaction-" + emptyCompletedId + ".json"), JSON.stringify({
      ...validMarker, snapshotId: emptyCompletedId,
    }));
    assert.deepStrictEqual(recoverArchiveTransactions(earlyPaths), { recovered: 0, rolledBack: 0 });
    const oldReadyId = crypto.randomUUID();
    fs.mkdirSync(path.join(earlyEntry, ".archive-old-" + oldReadyId));
    fs.writeFileSync(path.join(earlyEntry, ".archive-transaction-" + oldReadyId + ".json"), JSON.stringify({
      version: 1, uid: earlyUid, snapshotId: oldReadyId, state: "old_ready", stageManifestHash: "1".repeat(64), oldManifestHash: null, previousCurrent: null,
    }));
    assert.deepStrictEqual(recoverArchiveTransactions(earlyPaths), { recovered: 0, rolledBack: 1 });
    const impossibleId = crypto.randomUUID();
    fs.writeFileSync(path.join(earlyEntry, ".archive-transaction-" + impossibleId + ".json"), JSON.stringify({
      version: 1, uid: earlyUid, snapshotId: impossibleId, state: "live_ready", stageManifestHash: "2".repeat(64), oldManifestHash: null, previousCurrent: null,
    }));
    assert.throws(() => recoverArchiveTransactions(earlyPaths), error => error.code === "manual_recovery_required");
    fs.rmSync(earlyPaths.root, { recursive: true, force: true });

    const faultPaths = tempPaths();
    let faultVersion = 0;
    const faultService = createArchiveService({ paths: faultPaths, useQueue: false, fetch: async () => ({ markdown: LONG + " " + (++faultVersion), rawHtml: "raw" }) });
    const faultTask = { id: "fault", url: "https://example.com/fault" };
    await faultService.archiveTask(faultTask);
    const faultContent = fs.readFileSync(path.join(faultPaths.entriesDir, "fault", "archive", "content.md"));
    const storeModule = require("./store");
    const originalTrustedWriteSet = storeModule.trustedWriteSet;
    storeModule.trustedWriteSet = (changes, options) => {
      if (options?.action === "archive.index") throw new Error("index fault");
      return originalTrustedWriteSet(changes, options);
    };
    try { await assert.rejects(faultService.archiveTask(faultTask), /index fault/); }
    finally { storeModule.trustedWriteSet = originalTrustedWriteSet; }
    assert.ok(fs.readFileSync(path.join(faultPaths.entriesDir, "fault", "archive", "content.md")).equals(faultContent));
    fs.rmSync(faultPaths.root, { recursive: true, force: true });

    const firstFaultPaths = tempPaths();
    const firstFault = createArchiveService({ paths: firstFaultPaths, useQueue: false, fetch: async () => ({ markdown: LONG, rawHtml: "raw" }) });
    const storeForFirstFault = require("./store");
    const firstFaultWrite = storeForFirstFault.trustedWriteSet;
    storeForFirstFault.trustedWriteSet = (changes, options) => {
      if (options?.action === "archive.index") throw new Error("first index fault");
      return firstFaultWrite(changes, options);
    };
    try { await assert.rejects(firstFault.archiveTask({ id: "first-fault", url: "https://example.com/first-fault" }), /first index fault/); }
    finally { storeForFirstFault.trustedWriteSet = firstFaultWrite; }
    assert.strictEqual(fs.existsSync(path.join(firstFaultPaths.entriesDir, "first-fault", "archive")), false);
    fs.rmSync(firstFaultPaths.root, { recursive: true, force: true });

    const draftPaths = tempPaths();
    const draftService = createArchiveService({ paths: draftPaths, useQueue: false });
    fs.mkdirSync(path.join(draftPaths.entriesDir, "drafted", "drafts"), { recursive: true });
    fs.writeFileSync(path.join(draftPaths.entriesDir, "drafted", "drafts", "manual-" + "0".repeat(64) + ".md"), "wrong");
    await assert.rejects(draftService.archiveTask({ id: "drafted", url: "https://example.com/drafted", manualDraftHash: "0".repeat(64) }), /hash 不匹配/);
    await assert.rejects(draftService.protectExisting("drafted"), /不能建立保护代/);
    fs.rmSync(draftPaths.root, { recursive: true, force: true });

    const reprotectPaths = tempPaths();
    const reprotectService = createArchiveService({
      paths: reprotectPaths,
      useQueue: false,
      fetch: async () => ({ markdown: LONG, rawHtml: "raw" }),
    });
    const reprotectFirst = await reprotectService.archiveTask({ id: "reprotect", url: "https://example.com/reprotect" });
    fs.rmSync(path.join(reprotectPaths.entriesDir, "reprotect", "protected-generations"), { recursive: true, force: true });
    const reprotected = await reprotectService.protectExisting("reprotect");
    assert.strictEqual(reprotected.operationId, reprotectFirst.snapshotId);
    fs.rmSync(reprotectPaths.root, { recursive: true, force: true });

    const recoveryPaths = tempPaths();
    let recoveryAttempt = 0;
    const recoveryService = createArchiveService({
      paths: recoveryPaths, useQueue: false,
      fetch: async () => ({ markdown: LONG + "\n\n版本 " + (++recoveryAttempt), rawHtml: "raw " + recoveryAttempt }),
    });
    const recoveryTask = { id: "recover", uid: "recover", url: "https://example.com/recover" };
    const recoveryFirst = await recoveryService.archiveTask(recoveryTask);
    const recoverySecond = await recoveryService.archiveTask(recoveryTask);
    const recoveryEntry = path.join(recoveryPaths.entriesDir, "recover");
    const recoveryMarkerFile = path.join(recoveryEntry, ".archive-transaction-" + recoverySecond.snapshotId + ".json");
    const recoveryMarker = JSON.parse(fs.readFileSync(recoveryMarkerFile, "utf8"));
    recoveryMarker.state = "live_ready";
    fs.writeFileSync(recoveryMarkerFile, JSON.stringify(recoveryMarker));
    fs.cpSync(path.join(recoveryEntry, "protected-generations", recoveryFirst.snapshotId, "archive"), path.join(recoveryEntry, ".archive-old-" + recoverySecond.snapshotId), { recursive: true });
    fs.appendFileSync(path.join(recoveryEntry, "archive", "content.md"), "tampered");
    assert.deepStrictEqual(recoverArchiveTransactions(recoveryPaths), { recovered: 0, rolledBack: 1 });
    assert.match(fs.readFileSync(path.join(recoveryEntry, "archive", "content.md"), "utf8"), /版本 1/);
    assert.ok(fs.existsSync(path.join(recoveryEntry, ".archive-recovery-failed-" + recoverySecond.snapshotId)));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(recoveryEntry, "protected-generations", "current.json"), "utf8")).snapshotId, recoveryFirst.snapshotId);
    fs.rmSync(recoveryPaths.root, { recursive: true, force: true });

    const exactPaths = tempPaths();
    const exact = createArchiveService({
      paths: exactPaths, useQueue: false, clock: () => Date.now(),
      fetch: async () => ({ title: "边界", markdown: LONG, rawHtml: Buffer.alloc(MAX_RAW_HTML, 65) }),
    });
    const exactResult = await exact.archiveTask({ id: "1.2", url: "https://example.com/exact" });
    assert.strictEqual(exactResult.state, "succeeded");
    assert.ok(fs.existsSync(path.join(exactPaths.entriesDir, "1.2", "archive", "raw.html.gz")));
    fs.rmSync(exactPaths.root, { recursive: true, force: true });

    const compressedLimitPaths = tempPaths();
    const compressedLimit = createArchiveService({
      paths: compressedLimitPaths,
      useQueue: false,
      fetch: async () => ({ markdown: LONG, rawHtml: crypto.randomBytes(MAX_RAW_HTML) }),
    });
    const compressedLimitResult = await compressedLimit.archiveTask({ id: "compressed-limit", url: "https://example.com/compressed-limit" });
    assert.strictEqual(compressedLimitResult.state, "partial");
    assert.strictEqual(fs.existsSync(path.join(compressedLimitPaths.entriesDir, "compressed-limit", "archive", "raw.html.gz")), false);
    fs.rmSync(compressedLimitPaths.root, { recursive: true, force: true });

    const inheritedPaths = tempPaths();
    const inheritedService = createArchiveService({
      paths: inheritedPaths,
      useQueue: false,
      fetch: async () => ({ markdown: LONG, rawHtml: "original raw", cover: { data: PNG, contentType: "image/png" } }),
    });
    await inheritedService.archiveTask({ id: "inherited", url: "https://example.com/inherited" });
    const inheritedResult = await inheritedService.archiveTask({
      id: "inherited",
      url: "https://example.com/inherited",
      manualContent: LONG + " 手动替代正文",
      manualDraftHash: "ignored-when-body-present",
    });
    assert.strictEqual(inheritedResult.state, "succeeded");
    assert.ok(fs.existsSync(path.join(inheritedPaths.entriesDir, "inherited", "archive", "raw.html.gz")));
    assert.ok(fs.existsSync(path.join(inheritedPaths.entriesDir, "inherited", "archive", "images", "cover.png")));
    const migratedResult = await inheritedService.archiveTask({ id: "migrated", migrationContent: LONG, entry: {} });
    assert.strictEqual(migratedResult.state, "partial");
    fs.rmSync(inheritedPaths.root, { recursive: true, force: true });

    const largePaths = tempPaths();
    const large = createArchiveService({
      paths: largePaths, useQueue: false, fetch: async () => ({
        title: "超限仍保留正文", markdown: LONG, rawHtml: Buffer.alloc(MAX_RAW_HTML + 1, 66),
        cover: { data: PNG, contentType: "image/png" },
      }),
    });
    const largeResult = await large.archiveTask({ id: "1.3", url: "https://example.com/large" });
    assert.strictEqual(largeResult.state, "partial");
    assert.strictEqual(largeResult.retryable, false, "已有正文时原始 HTML 超限不应触发自动重试");
    const largeDir = path.join(largePaths.entriesDir, "1.3", "archive");
    assert.ok(fs.existsSync(path.join(largeDir, "content.md")));
    assert.ok(fs.existsSync(path.join(largeDir, "images", "cover.png")));
    assert.strictEqual(fs.existsSync(path.join(largeDir, "raw.html.gz")), false);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(largeDir, "metadata.json"), "utf8")).capture.state, "partial");
    fs.rmSync(largePaths.root, { recursive: true, force: true });

    const failedPaths = tempPaths();
    const failed = createArchiveService({
      paths: failedPaths, useQueue: false, fetch: async () => { throw new Error("网络不可用"); },
    });
    const failedResult = await failed.archiveTask({
      id: "1.4", url: "https://example.com/fail", entry: { title: "已保存标题", author: "已保存作者" },
    });
    assert.strictEqual(failedResult.state, "partial");
    assert.strictEqual(failedResult.retryable, true);
    assert.strictEqual(fs.existsSync(path.join(failedPaths.entriesDir, "1.4", "archive")), false, "不可用候选不得建立活动归档");
    const failedAttempt = JSON.parse(fs.readFileSync(path.join(failedPaths.runtimeDir, "archive-attempts.json"), "utf8"));
    assert.strictEqual(failedAttempt.items["1.4"].reasonCode, "candidate_unusable");
    fs.rmSync(failedPaths.root, { recursive: true, force: true });

    const preservePaths = tempPaths();
    let preserveAttempt = 0;
    const preserving = createArchiveService({
      paths: preservePaths, useQueue: false,
      fetch: async () => {
        preserveAttempt++;
        if (preserveAttempt === 1) {
          return { title: "稳定标题", markdown: LONG, rawHtml: "<p>完整正文</p>", source: "fixture-full" };
        }
        return { ok: false, status: "manual_required", warning: "登录已失效", title: "降级标题" };
      },
    });
    const preserveTask = { id: "preserve", url: "https://example.com/preserve", entry: { title: "条目标题" } };
    const firstPreserve = await preserving.archiveTask(preserveTask);
    assert.strictEqual(firstPreserve.state, "succeeded");
    const preservedDir = path.join(preservePaths.entriesDir, "preserve", "archive");
    const valuableContent = fs.readFileSync(path.join(preservedDir, "content.md"));
    const secondPreserve = await preserving.archiveTask({ ...preserveTask, attempt: 2 });
    assert.strictEqual(secondPreserve.state, "partial");
    assert.strictEqual(secondPreserve.retryable, false, "保留已有正文时不应最终降级为人工处理");
    assert.strictEqual(
      crypto.createHash("sha256").update(fs.readFileSync(path.join(preservedDir, "content.md"))).digest("hex"),
      crypto.createHash("sha256").update(valuableContent).digest("hex"),
    );
    assert.strictEqual(secondPreserve.contentPreserved, true);
    const preserveAttemptRecord = JSON.parse(fs.readFileSync(path.join(preservePaths.runtimeDir, "archive-attempts.json"), "utf8"));
    assert.strictEqual(preserveAttemptRecord.items.preserve.reasonCode, "candidate_unusable");
    fs.rmSync(preservePaths.root, { recursive: true, force: true });

    const manualPaths = tempPaths();
    const manual = createArchiveService({ paths: manualPaths, useQueue: false, fetch: async () => { throw new Error("should not fetch"); } });
    manual.enqueue({ id: "1.5", url: "https://example.com/manual", title: "手动条目" });
    const manualResult = await manual.archiveContent("1.5", "# 手动内容");
    assert.strictEqual(manualResult.state, "succeeded");
    assert.match(fs.readFileSync(path.join(manualPaths.entriesDir, "1.5", "archive", "content.md"), "utf8"), /手动内容/);
    fs.rmSync(manualPaths.root, { recursive: true, force: true });

    const targetedCalls = [];
    const targetedManual = createArchiveService({
      queue: {
        attachArchive: () => {},
        getTask: id => ({ id, uid: id, url: "https://example.com/targeted-manual" }),
        setManualContent: (id, content) => targetedCalls.push(["set", id, content]),
        runAndWait: async id => {
          targetedCalls.push(["wait", id]);
          return { id, state: "succeeded" };
        },
        retry: id => ({ id, state: "queued" }),
      },
    });
    const targetedManualResult = await targetedManual.archiveContent("targeted", "# 指定任务");
    assert.deepStrictEqual(targetedManualResult, { id: "targeted", state: "succeeded" });
    assert.deepStrictEqual(targetedCalls, [
      ["set", "targeted", "# 指定任务"],
      ["wait", "targeted"],
    ]);
    assert.strictEqual(targetedManual.retry("targeted").state, "queued");

    const queuedPaths = tempPaths();
    const queued = createArchiveService({ paths: queuedPaths, autoStart: false, fetch: async () => ({ markdown: LONG, rawHtml: "x" }) });
    assert.deepStrictEqual(queued.enqueue({ id: "1.6", url: "https://example.com/queued" }), { id: "1.6", state: "queued" });
    assert.strictEqual(queued.getStatus("1.6").state, "queued");
    const queuedResult = await queued.archiveContent("1.6", "# 队列手动内容");
    assert.strictEqual(queuedResult.state, "succeeded");
    await queued.stop();
    fs.rmSync(queuedPaths.root, { recursive: true, force: true });

    const noRawPaths = tempPaths();
    const noRaw = createArchiveService({
      paths: noRawPaths,
      autoStart: false,
      fetch: async () => ({ ok: true, status: "succeeded", markdown: LONG, source: "GitHub raw" }),
    });
    noRaw.enqueue({ id: "1.7", url: "https://github.com/acme/project" });
    await noRaw.drain();
    assert.strictEqual(noRaw.getStatus("1.7").state, "partial");
    assert.strictEqual(noRaw.getStatus("1.7").attempt, 1, "缺少可选 raw HTML 不应重复运行四次");
    assert.strictEqual(noRaw.getStatus("1.7").nextRunAt, null);
    await noRaw.stop();
    fs.rmSync(noRawPaths.root, { recursive: true, force: true });

    const parsed = await defaultFetch("https://example.com/read", {
      httpGet: async () => ({ status: 200, body: "<html><head><title>页面标题</title><meta name=\"author\" content=\"网页作者\"><meta property=\"og:image\" content=\"https://img.example/a.png\"></head><body><article><p>可读正文</p></article></body></html>" }),
    });
    assert.strictEqual(parsed.title, "页面标题");
    assert.strictEqual(parsed.author, "网页作者");
    assert.match(parsed.markdown, /可读正文/);
    await assert.rejects(defaultFetch("https://example.com/bad", { httpGet: async () => ({ status: 503, body: "bad" }) }), /HTTP 503/);

    let routedUrl = "";
    const routed = await defaultFetch("https://github.com/acme/project", {
      scrapeContent: async url => {
        routedUrl = url;
        return {
          ok: true,
          status: "succeeded",
          metadata: { title: "acme/project", author: "acme", description: "项目摘要" },
          markdown: "# README",
          imageCandidates: ["https://img.example/avatar.png"],
          source: "GitHub raw (main/README.md)",
        };
      },
      httpGet: async () => { throw new Error("不应绕过统一 scraper"); },
    });
    assert.strictEqual(routedUrl, "https://github.com/acme/project");
    assert.strictEqual(routed.title, "acme/project");
    assert.strictEqual(routed.summary, "项目摘要");
    assert.deepStrictEqual(routed.images, ["https://img.example/avatar.png"]);
    assert.strictEqual(routed.source, "GitHub raw (main/README.md)");

    const directFields = await defaultFetch("https://example.com/direct-fields", {
      scrapeContent: async () => ({
        metadata: null,
        reasons: ["降级原因", ""],
        title: "直接标题",
        author: "直接作者",
        summary: "直接摘要",
        images: [],
        warning: "直接警告",
      }),
    });
    assert.strictEqual(directFields.title, "直接标题");
    assert.strictEqual(directFields.author, "直接作者");
    assert.strictEqual(directFields.summary, "直接摘要");
    assert.deepStrictEqual(directFields.images, []);
    assert.strictEqual(directFields.warning, "直接警告");
    await assert.rejects(
      defaultFetch("https://example.com/invalid-result", { scrapeContent: async () => null }),
      /抓取器返回无效结果/,
    );
    const emptyFields = await defaultFetch("https://example.com/empty-fields", { scrapeContent: async () => ({}) });
    assert.strictEqual(emptyFields.title, "");
    assert.strictEqual(emptyFields.author, "");
    assert.strictEqual(emptyFields.summary, "");
    assert.deepStrictEqual(emptyFields.images, []);
    assert.strictEqual(emptyFields.warning, "");
    await assert.rejects(defaultFetch("not-a-url"), /Invalid URL|无效 URL/);

    const imagePaths = tempPaths();
    const imageService = createArchiveService({
      paths: imagePaths, useQueue: false, validateUrl: async url => { if (url.includes("blocked")) throw new Error("图片 URL 被拒绝"); },
      fetchImage: async url => url.includes("object") ? { body: PNG, contentType: "image/png" } : JPEG,
      fetch: async () => ({
        title: "图片测试", markdown: LONG, rawHtml: "raw",
        cover: { url: "https://img.example/object.png" },
        images: [{ url: "https://img.example/object.png" }, { url: "https://img.example/blocked.png" }],
      }),
    });
    const imageResult = await imageService.archiveTask({ id: "1.7", url: "https://example.com/images" });
    assert.strictEqual(imageResult.state, "partial");
    assert.ok(fs.existsSync(path.join(imagePaths.entriesDir, "1.7", "archive", "images", "cover.png")));
    fs.rmSync(imagePaths.root, { recursive: true, force: true });

    const rawImage = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0xff, 0xfe, 0x80, 0x01, 0x02, 0x03, 0x04,
    ]);
    const rawImageServer = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(rawImage);
    });
    await new Promise(resolve => rawImageServer.listen(0, "127.0.0.1", resolve));
    const rawImagePaths = tempPaths();
    try {
      const rawImageService = createArchiveService({
        paths: rawImagePaths,
        useQueue: false,
        validateUrl: async () => {},
        fetch: async () => ({
          title: "二进制图片",
          markdown: LONG,
          rawHtml: "raw",
          cover: `http://127.0.0.1:${rawImageServer.address().port}/cover.png`,
        }),
      });
      const rawImageResult = await rawImageService.archiveTask({ id: "raw-image", url: "https://example.com/raw-image" });
      assert.strictEqual(rawImageResult.state, "succeeded");
      const savedImage = fs.readFileSync(path.join(rawImagePaths.entriesDir, "raw-image", "archive", "images", "cover.png"));
      assert.ok(savedImage.subarray(0, 8).equals(rawImage.subarray(0, 8)));
      assert.strictEqual(
        crypto.createHash("sha256").update(savedImage).digest("hex"),
        crypto.createHash("sha256").update(rawImage).digest("hex"),
      );
    } finally {
      await new Promise(resolve => rawImageServer.close(resolve));
      fs.rmSync(rawImagePaths.root, { recursive: true, force: true });
    }

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
      fetchImage: async url => url.includes("jpg") ? JPEG : { body: Buffer.from("downloaded") },
      fetch: async () => ({ title: "variants", markdown: LONG, rawHtml: "raw", images: [42,
        { data: PNG, contentType: "" },
        { data: GIF.toString("base64"), contentType: "image/gif" },
        { data: WEBP, type: "image/webp" },
        { data: Buffer.from("svg"), contentType: "image/svg+xml" },
        { data: JPEG, contentType: "image/jpeg" },
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
    assert.ok(fs.existsSync(path.join(variantsDir, "key-04.jpg")));
    assert.ok(fs.existsSync(path.join(variantsDir, "key-05.jpg")));
    assert.strictEqual(fs.readdirSync(variantsDir).some(name => /\.(svg|bin)$/.test(name)), false, "不可信 SVG/BIN 不进入活动归档");
    fs.rmSync(variantsPaths.root, { recursive: true, force: true });

    const invalidFetchPaths = tempPaths();
    const invalidFetch = createArchiveService({ paths: invalidFetchPaths, useQueue: false, fetch: async () => null });
    const invalidFetchResult = await invalidFetch.archiveTask({ id: "invalid-fetch", url: "https://example.com/invalid-fetch" });
    assert.strictEqual(invalidFetchResult.state, "partial");
    fs.rmSync(invalidFetchPaths.root, { recursive: true, force: true });

    const invalidIndexPaths = tempPaths();
    fs.mkdirSync(invalidIndexPaths.runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(invalidIndexPaths.runtimeDir, "archive-snapshots.json"), JSON.stringify({ version: 1, items: null }));
    fs.writeFileSync(path.join(invalidIndexPaths.runtimeDir, "archive-integrity.json"), JSON.stringify({ version: 1, items: null }));
    const invalidIndexService = createArchiveService({
      paths: invalidIndexPaths,
      useQueue: false,
      fetch: async () => ({ markdown: LONG, rawHtml: "raw" }),
    });
    assert.strictEqual((await invalidIndexService.archiveTask({ id: "invalid-index", url: "https://example.com/invalid-index" })).state, "succeeded");
    fs.rmSync(invalidIndexPaths.root, { recursive: true, force: true });

    const redactionPaths = tempPaths();
    const previousCookie = process.env.X_COOKIE;
    process.env.X_COOKIE = "archive-secret";
    try {
      const redactionService = createArchiveService({ paths: redactionPaths, useQueue: false, fetch: async () => { throw new Error("cookie=archive-secret"); } });
      const redacted = await redactionService.archiveTask({ id: "redacted", url: "https://example.com/redacted" });
      assert.strictEqual(JSON.stringify(redacted).includes("archive-secret"), false);
      const missingMessageService = createArchiveService({ paths: redactionPaths, useQueue: false, fetch: async () => { throw {}; } });
      assert.strictEqual((await missingMessageService.archiveTask({ id: "missing-message", url: "https://example.com/missing-message" })).state, "partial");
    } finally {
      if (previousCookie === undefined) delete process.env.X_COOKIE;
      else process.env.X_COOKIE = previousCookie;
      fs.rmSync(redactionPaths.root, { recursive: true, force: true });
    }

    const authorityPaths = tempPaths();
    const invalidAuthority = createArchiveService({ paths: authorityPaths, useQueue: false, fetch: async () => ({ markdown: LONG, authority: "unknown-authority" }) });
    const authorityResult = await invalidAuthority.archiveTask({ id: "invalid-authority", url: "https://example.com/authority" });
    assert.strictEqual(authorityResult.reasonCode, "invalid_authority");
    fs.rmSync(authorityPaths.root, { recursive: true, force: true });

    const fallbackPaths = tempPaths();
    const fallback = createArchiveService({ paths: fallbackPaths, useQueue: false, fetch: async () => ({ html: "<p>html body</p>", content: LONG + " content fallback", desc: "description fallback" }) });
    const fallbackResult = await fallback.archiveTask({ id: "fallback", url: "https://example.com/fallback", entry: { title: "entry title", summary: "entry summary", author: "entry author" } });
    assert.strictEqual(fallbackResult.state, "succeeded");
    assert.match(fs.readFileSync(path.join(fallbackPaths.entriesDir, "fallback", "archive", "content.md"), "utf8"), /content fallback/);
    fs.rmSync(fallbackPaths.root, { recursive: true, force: true });

    const contentFailPaths = tempPaths();
    const contentFail = createArchiveService({ paths: contentFailPaths, useQueue: false, fetch: async () => {
      fs.mkdirSync(path.join(contentFailPaths.entriesDir, "content-fail", "archive", "content.md"), { recursive: true });
      return { markdown: LONG, rawHtml: "raw" };
    } });
    const contentFailResult = await contentFail.archiveTask({ id: "content-fail", url: "https://example.com/content-fail" });
    assert.strictEqual(contentFailResult.state, "partial");
    fs.rmSync(contentFailPaths.root, { recursive: true, force: true });

    const rawFailPaths = tempPaths();
    const rawFail = createArchiveService({ paths: rawFailPaths, useQueue: false, fetch: async () => {
      fs.mkdirSync(path.join(rawFailPaths.entriesDir, "raw-fail", "archive", "raw.html.gz"), { recursive: true });
      return { markdown: LONG, rawHtml: "raw" };
    } });
    const rawFailResult = await rawFail.archiveTask({ id: "raw-fail", url: "https://example.com/raw-fail" });
    assert.strictEqual(rawFailResult.state, "partial");
    fs.rmSync(rawFailPaths.root, { recursive: true, force: true });

    const metadataFailPaths = tempPaths();
    const metadataFail = createArchiveService({ paths: metadataFailPaths, useQueue: false, fetch: async () => {
      fs.mkdirSync(path.join(metadataFailPaths.entriesDir, "metadata-fail", "archive", "metadata.json"), { recursive: true });
      return { markdown: LONG, rawHtml: "raw" };
    } });
    const metadataFailResult = await metadataFail.archiveTask({ id: "metadata-fail", url: "https://example.com/metadata-fail" });
    assert.strictEqual(metadataFailResult.state, "partial");
    assert.strictEqual(metadataFailResult.reasonCode, "unverified");
    fs.rmSync(metadataFailPaths.root, { recursive: true, force: true });

    const bufferParsed = await defaultFetch("https://example.com/buffer", {
      httpGet: async () => ({ status: 200, body: Buffer.from("<html><head><meta name=\"description\" content=\"buffer summary\"></head><body><p>buffer body</p></body></html>") }),
    });
    assert.match(bufferParsed.markdown, /buffer body/);
    await assert.rejects(defaultFetch("https://example.com/empty", { httpGet: async () => ({ status: 200, body: "<html><body></body></html>" }) }));

    const warningOnlyPaths = tempPaths();
    const warningOnly = createArchiveService({ paths: warningOnlyPaths, useQueue: false, fetch: async () => ({ ok: true, warning: "warning-only", markdown: LONG, rawHtml: "raw" }) });
    const warningOnlyResult = await warningOnly.archiveTask({ id: "warning-only", url: "https://example.com/warning-only" });
    assert.strictEqual(warningOnlyResult.state, "partial");
    fs.rmSync(warningOnlyPaths.root, { recursive: true, force: true });

    const warningPaths = tempPaths();
    const warningService = createArchiveService({ paths: warningPaths, useQueue: false, fetch: async () => ({ ok: false, warning: "需要登录", title: "已有标题" }) });
    const warningResult = await warningService.archiveTask({ id: "1.8", url: "https://example.com/warning" });
    assert.strictEqual(warningResult.state, "partial");
    assert.match(JSON.stringify(warningResult.errors), /需要登录/);
    await assert.rejects(() => warningService.archiveContent("1.8", ""), /不能为空/);
    await assert.rejects(() => warningService.archiveContent("missing", "# 内容"), /未知/);
    assert.throws(() => warningService.retry("1.8"), /不可用/);
    fs.rmSync(warningPaths.root, { recursive: true, force: true });
  } finally {
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
})().then(() => console.log("archive: ALL PASS")).catch(error => { console.error(error); process.exitCode = 1; });
