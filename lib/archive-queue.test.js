"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createArchiveQueue, atomicJson, RETRY_DELAYS } = require("./archive-queue");

class FakeClock {
  constructor(value = Date.parse("2026-01-01T00:00:00.000Z")) { this.value = value; this.timers = new Map(); this.next = 1; }
  now = () => this.value;
  setTimeout = (callback, delay) => { const id = this.next++; this.timers.set(id, { at: this.value + delay, callback }); return id; };
  clearTimeout = id => this.timers.delete(id);
  advance = async ms => {
    this.value += ms;
    let due;
    while ((due = [...this.timers.entries()].filter(([, item]) => item.at <= this.value).sort((a, b) => a[1].at - b[1].at)[0])) {
      this.timers.delete(due[0]);
      due[1].callback();
      await Promise.resolve();
    }
  };
}

function makeRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "linggan-queue-")); }
function entry(id) { return { id, uid: "uid-" + id, url: "https://example.com/" + id, title: "标题" }; }

(async () => {
  const root = makeRoot();
  try {
    const file = path.join(root, ".linggan", "archive-jobs.json");
    const clock = new FakeClock();
    const calls = [];
    const queue = createArchiveQueue({
      file, clock, autoStart: false,
      processor: async task => { calls.push(task.id + ":" + task.attempt); return { state: "succeeded", retryable: false }; },
    });
    assert.deepStrictEqual(queue.enqueue(Object.assign(entry("1.1"), {
      cover: { url: "https://img.example/cover.png", data: Buffer.from("ignored") },
      images: [{ url: "https://img.example/key.png", data: Buffer.from("ignored") }, null],
    })), { id: "1.1", state: "queued" });
    assert.deepStrictEqual(queue.enqueue(entry("1.1")), { id: "1.1", state: "queued" });
    const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(persisted.version, 1);
    assert.strictEqual(persisted.jobs.length, 1);
    assert.strictEqual(fs.existsSync(file + ".tmp"), false);
    await queue.runDue();
    assert.strictEqual(queue.getStatus("1.1").state, "succeeded");
    assert.deepStrictEqual(calls, ["1.1:1"]);

    const timerClock = new FakeClock();
    const timer = createArchiveQueue({ file: path.join(root, "timer.json"), clock: timerClock,
      processor: async () => ({ state: "succeeded", retryable: false }) });
    timer.enqueue(entry("1.9"));
    await timerClock.advance(0);
    await timer.drain();
    assert.strictEqual(timer.getStatus("1.9").state, "succeeded");
    timer.stop();

    const recoveryClock = new FakeClock(clock.value);
    atomicJson(file, { version: 1, jobs: [{
      id: "2.2", uid: "uid-2.2", url: "https://example.com/2.2", entry: entry("2.2"), attempt: 1,
      nextRunAt: recoveryClock.value + 999999, lastError: "中断", state: "running",
      createdAt: new Date(recoveryClock.value).toISOString(), updatedAt: new Date(recoveryClock.value).toISOString(),
    }] });
    const recovered = createArchiveQueue({ file, clock: recoveryClock, autoStart: false, processor: async () => ({ state: "succeeded" }) });
    assert.strictEqual(recovered.getStatus("2.2").state, "queued");
    assert.strictEqual(recovered.getStatus("2.2").nextRunAt, recoveryClock.value);
    await recovered.runDue();
    assert.strictEqual(recovered.getStatus("2.2").state, "succeeded");

    const serialClock = new FakeClock();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const active = [];
    const serial = createArchiveQueue({ file: path.join(root, "serial.json"), clock: serialClock, autoStart: false,
      processor: async task => { active.push(task.id); if (task.id === "3.1") await gate; return { state: "succeeded" }; } });
    serial.enqueue(entry("3.1")); serial.enqueue(entry("3.2"));
    const first = serial.runDue();
    await Promise.resolve();
    assert.deepStrictEqual(active, ["3.1"]);
    const second = serial.runDue();
    assert.ok(serial.running);
    assert.strictEqual(await Promise.race([second.then(() => "done"), Promise.resolve("running")]), "running");
    assert.throws(() => serial.retry("3.1"));
    release();
    await first;
    await serial.runDue();
    assert.deepStrictEqual(active, ["3.1", "3.2"]);

    let releaseBlocker;
    const blockerGate = new Promise(resolve => { releaseBlocker = resolve; });
    const targetedCalls = [];
    const targeted = createArchiveQueue({ file: path.join(root, "targeted.json"), autoStart: false,
      processor: async task => {
        targetedCalls.push(task.id);
        if (task.id === "3.5") await blockerGate;
        return { state: "succeeded", retryable: false };
      } });
    targeted.enqueue(entry("3.5"));
    targeted.enqueue(entry("3.6"));
    targeted.enqueue(entry("3.7"));
    const blockerRun = targeted.runDue();
    await Promise.resolve();
    const targetRun = targeted.runAndWait("3.7");
    await Promise.resolve();
    assert.deepStrictEqual(targetedCalls, ["3.5"]);
    releaseBlocker();
    await blockerRun;
    const targetStatus = await targetRun;
    assert.strictEqual(targetStatus.id, "3.7");
    assert.strictEqual(targetStatus.state, "succeeded");
    assert.deepStrictEqual(targetedCalls, ["3.5", "3.7"]);
    assert.strictEqual(targeted.getStatus("3.6").state, "queued");
    assert.strictEqual((await targeted.runAndWait("3.7")).state, "succeeded");
    await assert.rejects(() => targeted.runAndWait("missing"), /未知/);

    let releaseTarget;
    const targetGate = new Promise(resolve => { releaseTarget = resolve; });
    const alreadyRunning = createArchiveQueue({ file: path.join(root, "already-running.json"), autoStart: false,
      processor: async () => { await targetGate; return { state: "succeeded", retryable: false }; } });
    alreadyRunning.enqueue(entry("3.8"));
    const inFlightTarget = alreadyRunning.runDue();
    await Promise.resolve();
    const sameTarget = alreadyRunning.runAndWait("3.8");
    releaseTarget();
    await inFlightTarget;
    assert.strictEqual((await sameTarget).state, "succeeded");

    const pendingManualFile = path.join(root, "pending-manual.json");
    let releaseAutomatic;
    const automaticGate = new Promise(resolve => { releaseAutomatic = resolve; });
    const pendingCalls = [];
    const pendingManual = createArchiveQueue({ file: pendingManualFile, autoStart: false,
      processor: async task => {
        pendingCalls.push({ id: task.id, manualContent: task.manualContent });
        if (pendingCalls.length === 1) {
          await automaticGate;
          throw new Error("automatic archive failed");
        }
        return { state: task.manualContent ? "succeeded" : "failed", retryable: false };
      } });
    pendingManual.enqueue(entry("3.81"));
    const automaticRun = pendingManual.runDue();
    await Promise.resolve();
    assert.deepStrictEqual(pendingManual.setManualContent("3.81", "private pending override"), { id: "3.81", state: "running" });
    assert.strictEqual(fs.readFileSync(pendingManualFile, "utf8").includes("private pending override"), false);
    assert.strictEqual(fs.readFileSync(pendingManualFile + ".previous", "utf8").includes("private pending override"), false);
    const pendingResultPromise = pendingManual.runAndWait("3.81");
    releaseAutomatic();
    await automaticRun;
    const pendingResult = await pendingResultPromise;
    assert.strictEqual(pendingResult.state, "succeeded");
    assert.deepStrictEqual(pendingCalls, [
      { id: "3.81", manualContent: undefined },
      { id: "3.81", manualContent: "private pending override" },
    ]);
    assert.strictEqual(fs.readFileSync(pendingManualFile, "utf8").includes("private pending override"), false);
    assert.strictEqual(fs.readFileSync(pendingManualFile + ".previous", "utf8").includes("private pending override"), false);

    const stoppedPendingFile = path.join(root, "stopped-pending.json");
    const stoppedPendingClock = new FakeClock();
    let releaseStoppedAutomatic;
    const stoppedAutomaticGate = new Promise(resolve => { releaseStoppedAutomatic = resolve; });
    const stoppedPendingCalls = [];
    const stoppedPending = createArchiveQueue({ file: stoppedPendingFile, clock: stoppedPendingClock, autoStart: false,
      processor: async task => {
        stoppedPendingCalls.push(task.manualContent);
        if (stoppedPendingCalls.length === 1) await stoppedAutomaticGate;
        return { state: "succeeded", retryable: false };
      } });
    stoppedPending.enqueue(entry("3.82"));
    const stoppedAutomaticRun = stoppedPending.runDue();
    await Promise.resolve();
    stoppedPending.setManualContent("3.82", "resume-only private content");
    const stoppedPendingWait = stoppedPending.runAndWait("3.82");
    stoppedPending.stop();
    releaseStoppedAutomatic();
    await stoppedAutomaticRun;
    await assert.rejects(() => stoppedPendingWait, /已停止/);
    assert.strictEqual(stoppedPending.getTask("3.82").manualContent, "resume-only private content");
    assert.strictEqual(stoppedPending.getStatus("3.82").manualContent, undefined);
    assert.strictEqual(fs.readFileSync(stoppedPendingFile + ".previous", "utf8").includes("resume-only private content"), false);
    stoppedPending.start();
    assert.strictEqual((await stoppedPending.runAndWait("3.82")).state, "succeeded");
    stoppedPending.stop();
    assert.deepStrictEqual(stoppedPendingCalls, [undefined, "resume-only private content"]);
    assert.strictEqual(fs.readFileSync(stoppedPendingFile, "utf8").includes("resume-only private content"), false);
    assert.strictEqual(fs.readFileSync(stoppedPendingFile + ".previous", "utf8").includes("resume-only private content"), false);

    const stoppedTarget = createArchiveQueue({ file: path.join(root, "stopped-target.json"), autoStart: false,
      processor: async () => ({ state: "succeeded" }) });
    stoppedTarget.enqueue(entry("3.9"));
    stoppedTarget.stop();
    await assert.rejects(() => stoppedTarget.runAndWait("3.9"), /已停止/);

    const inconsistentTarget = createArchiveQueue({ file: path.join(root, "inconsistent-target.json"), autoStart: false,
      processor: async () => ({ state: "succeeded" }) });
    inconsistentTarget.enqueue(entry("3.10"));
    inconsistentTarget.getTask("3.10").state = "running";
    await assert.rejects(() => inconsistentTarget.runAndWait("3.10"), /状态异常/);

    const directManual = createArchiveQueue({ file: path.join(root, "direct-manual.json"), autoStart: false,
      processor: async () => ({ state: "manual_required", error: "需要人工" }) });
    directManual.enqueue(entry("3.3"));
    await directManual.runDue();
    assert.strictEqual(directManual.getStatus("3.3").state, "manual_required");

    const noProcessor = createArchiveQueue({ file: path.join(root, "no-processor.json"), autoStart: false });
    noProcessor.enqueue(entry("3.4"));
    await noProcessor.runDue();
    assert.strictEqual(noProcessor.getStatus("3.4").state, "queued");
    noProcessor.stop();

    const retryClock = new FakeClock();
    const retry = createArchiveQueue({ file: path.join(root, "retry.json"), clock: retryClock, autoStart: false,
      processor: async () => ({ state: "failed", error: "暂时失败", retryable: true }) });
    retry.enqueue(entry("4.1"));
    await retry.runDue();
    assert.strictEqual(retry.getStatus("4.1").attempt, 1);
    assert.strictEqual(retry.getStatus("4.1").nextRunAt, retryClock.value + RETRY_DELAYS[1]);
    await retryClock.advance(RETRY_DELAYS[1]);
    await retry.runDue();
    assert.strictEqual(retry.getStatus("4.1").attempt, 2);
    await retryClock.advance(RETRY_DELAYS[2]);
    await retry.runDue();
    assert.strictEqual(retry.getStatus("4.1").attempt, 3);
    await retryClock.advance(RETRY_DELAYS[3]);
    await retry.runDue();
    assert.strictEqual(retry.getStatus("4.1").state, "manual_required");
    assert.strictEqual(retry.getStatus("4.1").attempt, 4);
    assert.strictEqual(retry.getStatus("4.1").nextRunAt, null);
    assert.deepStrictEqual(retry.retry("4.1"), { id: "4.1", state: "queued" });
    assert.strictEqual(retry.getStatus("4.1").attempt, 0);

    const manualClock = new FakeClock();
    const manual = createArchiveQueue({ file: path.join(root, "manual.json"), clock: manualClock, autoStart: false,
      processor: async task => task.manualContent ? { state: "succeeded" } : { state: "failed", retryable: false } });
    manual.enqueue(entry("5.1"));
    assert.throws(() => manual.setManualContent("5.1", ""), /不能为空/);
    manual.setManualContent("5.1", "# 手动");
    await manual.runDue();
    assert.strictEqual(manual.getStatus("5.1").state, "succeeded");
    assert.strictEqual(manual.getTask("5.1").manualContent, undefined);
    const manualPersisted = JSON.parse(fs.readFileSync(path.join(root, "manual.json"), "utf8"));
    const manualPrevious = JSON.parse(fs.readFileSync(path.join(root, "manual.json.previous"), "utf8"));
    assert.strictEqual(manualPersisted.jobs.length, 1);
    assert.strictEqual("manualContent" in manualPersisted.jobs[0], false);
    assert.strictEqual("manualContent" in manualPrevious.jobs[0], false);

    const manualFailureFile = path.join(root, "manual-failure.json");
    let receivedManualContent;
    const manualFailure = createArchiveQueue({ file: manualFailureFile, autoStart: false,
      processor: async task => {
        receivedManualContent = task.manualContent;
        throw new Error("temporary processor failure");
      } });
    manualFailure.enqueue(entry("5.3"));
    manualFailure.setManualContent("5.3", "private manual text");
    await manualFailure.runDue();
    assert.strictEqual(receivedManualContent, "private manual text");
    assert.strictEqual(manualFailure.getTask("5.3").manualContent, undefined);
    assert.strictEqual("manualContent" in JSON.parse(fs.readFileSync(manualFailureFile, "utf8")).jobs[0], false);
    assert.strictEqual("manualContent" in JSON.parse(fs.readFileSync(manualFailureFile + ".previous", "utf8")).jobs[0], false);

    const persistRetryFile = path.join(root, "persist-retry.json");
    const persistRetryClock = new FakeClock();
    let persistRetryCalls = 0;
    let failPrimaryReplace = false;
    const persistRetry = createArchiveQueue({ file: persistRetryFile, clock: persistRetryClock, autoStart: false,
      processor: async task => {
        persistRetryCalls += 1;
        if (persistRetryCalls === 1) failPrimaryReplace = true;
        return { state: task.manualContent ? "succeeded" : "failed", retryable: false };
      } });
    persistRetry.enqueue(entry("5.4"));
    persistRetry.setManualContent("5.4", "retry after persistence failure");
    const originalPersistRename = fs.renameSync;
    fs.renameSync = (source, target) => {
      if (failPrimaryReplace && path.resolve(target) === path.resolve(persistRetryFile)) {
        failPrimaryReplace = false;
        const error = new Error("forced queue persistence failure");
        error.code = "EIO";
        throw error;
      }
      return originalPersistRename(source, target);
    };
    try {
      await assert.rejects(() => persistRetry.runDue(), /forced queue persistence failure/);
    } finally {
      fs.renameSync = originalPersistRename;
    }
    assert.strictEqual(persistRetry.getStatus("5.4").state, "queued");
    assert.strictEqual(persistRetry.getTask("5.4").manualContent, "retry after persistence failure");
    assert.ok(persistRetry.getStatus("5.4").nextRunAt > persistRetryClock.value);
    await persistRetryClock.advance(5000);
    assert.strictEqual((await persistRetry.runDue()).state, "succeeded");
    assert.strictEqual(persistRetryCalls, 2, "持久化失败不应伪装成处理器失败并重复收尾");
    assert.strictEqual(persistRetry.getTask("5.4").manualContent, undefined);
    assert.strictEqual(fs.readFileSync(persistRetryFile, "utf8").includes("retry after persistence failure"), false);
    assert.strictEqual(fs.readFileSync(persistRetryFile + ".previous", "utf8").includes("retry after persistence failure"), false);

    assert.throws(() => manual.enqueue(null));
    assert.throws(() => manual.enqueue({ id: "missing-url" }));
    assert.throws(() => manual.enqueue({ url: "https://example.com/no-id" }));
    assert.deepStrictEqual(manual.enqueue({ id: "5.2", url: "https://example.com/5.2", images: ["one", { src: "two" }, null, 3], cover: { src: "cover" } }), { id: "5.2", state: "queued" });
    assert.deepStrictEqual(manual.getTask("5.2").entry.images, ["one", { url: "two", contentType: undefined }]);
    assert.deepStrictEqual(manual.getTask("5.2").entry.cover, { url: "cover", contentType: undefined });

    const defaultResult = createArchiveQueue({ file: path.join(root, "default-result.json"), autoStart: false, processor: async () => undefined });
    defaultResult.enqueue(entry("7.0"));
    await defaultResult.runDue();
    assert.strictEqual(defaultResult.getStatus("7.0").state, "queued");

    const resultBranches = createArchiveQueue({ file: path.join(root, "result-branches.json"), autoStart: false,
      processor: async task => {
        if (task.id === "7.2") return { state: "partial", warning: "warning branch", retryable: false };
        if (task.id === "7.3") return { state: "running", metadata: { errors: ["metadata branch"] }, retryable: false };
        return { state: "succeeded" };
      } });
    resultBranches.enqueue(entry("7.2"));
    resultBranches.enqueue(entry("7.3"));
    await resultBranches.drain();
    assert.strictEqual(resultBranches.getStatus("7.2").lastError, "warning branch");
    assert.strictEqual(resultBranches.getStatus("7.3").state, "failed");

    const systemClock = createArchiveQueue({ file: path.join(root, "system-clock.json"),
      processor: async () => ({ state: "succeeded" }) });
    systemClock.enqueue({ id: "8.1", url: "https://example.com/8.1" });
    await systemClock.drain();
    systemClock.stop();

    const arrayFile = path.join(root, "array.json");
    const stamp = new Date().toISOString();
    fs.writeFileSync(arrayFile, JSON.stringify([{ id: "9.1", url: "https://example.com/9.1", state: "succeeded", attempt: 0, nextRunAt: null, createdAt: stamp, updatedAt: stamp }]), "utf8");
    const arrayQueue = createArchiveQueue({ file: arrayFile, autoStart: false });
    assert.strictEqual(arrayQueue.getStatus("9.1").state, "succeeded");

    const mixedFile = path.join(root, "mixed.json");
    atomicJson(mixedFile, { version: 1, jobs: [
      { id: "9.2", url: "https://example.com/9.2", state: "succeeded", attempt: 1, nextRunAt: null, createdAt: stamp, updatedAt: stamp },
      { id: "bad-mixed", url: "https://example.com/bad", state: "queued", attempt: 9, nextRunAt: 0, createdAt: stamp, updatedAt: stamp },
      { id: "9.3", url: "https://example.com/9.3", state: "failed", attempt: 1, nextRunAt: null, createdAt: stamp, updatedAt: stamp },
    ] });
    const mixed = createArchiveQueue({ file: mixedFile, autoStart: false });
    assert.deepStrictEqual([...mixed.jobs.keys()], ["9.2", "9.3"]);
    assert.strictEqual(mixed.getStatus("9.2").state, "succeeded");
    assert.strictEqual(mixed.getStatus("9.3").state, "failed");
    assert.match(mixed.diagnostics[0], /任务 1 无效/);

    const fallbackFile = path.join(root, "fallback.json");
    atomicJson(fallbackFile, { version: 1, jobs: [
      { id: "old", url: "https://example.com/old", state: "succeeded", attempt: 1, nextRunAt: null, createdAt: stamp, updatedAt: stamp },
    ] });
    atomicJson(fallbackFile, { version: 1, jobs: [
      { id: "new", url: "https://example.com/new", state: "succeeded", attempt: 1, nextRunAt: null, createdAt: stamp, updatedAt: stamp },
    ] });
    fs.writeFileSync(fallbackFile, "{not json", "utf8");
    const fallback = createArchiveQueue({ file: fallbackFile, autoStart: false });
    assert.strictEqual(fallback.getStatus("old").state, "succeeded");
    assert.strictEqual(fallback.getStatus("new"), null);
    assert.ok(fallback.diagnostics.some(item => /主文件读取失败/.test(item)));
    assert.ok(fallback.diagnostics.some(item => /上次快照恢复/.test(item)));

    const replacementFile = path.join(root, "replacement.json");
    atomicJson(replacementFile, { version: 1, jobs: [{
      id: "replacement-old", url: "https://example.com/replacement-old", state: "succeeded", attempt: 1,
      nextRunAt: null, createdAt: stamp, updatedAt: stamp,
    }] });
    atomicJson(replacementFile, { version: 1, jobs: [{
      id: "replacement-current", url: "https://example.com/replacement-current", state: "succeeded", attempt: 1,
      nextRunAt: null, createdAt: stamp, updatedAt: stamp,
    }] });
    const originalRenameSync = fs.renameSync;
    let replacementAttempts = 0;
    fs.renameSync = (source, target) => {
      if (path.resolve(target) === path.resolve(replacementFile)) {
        replacementAttempts += 1;
        const error = new Error("forced replacement failure");
        error.code = replacementAttempts === 1 ? "EEXIST" : "EIO";
        throw error;
      }
      return originalRenameSync(source, target);
    };
    try {
      assert.throws(() => atomicJson(replacementFile, { version: 1, jobs: [] }), /人工恢复/);
    } finally {
      fs.renameSync = originalRenameSync;
    }
    assert.strictEqual(replacementAttempts, 2);
    const retainedOld = fs.readdirSync(root).find(name => name.startsWith("replacement.json.linggan-t3-") && name.endsWith(".old"));
    assert.ok(retainedOld, "无法自动回滚时必须保留可验证 old generation");
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, retainedOld), "utf8")).jobs[0].id, "replacement-current");

    for (const [name, job] of [
      ["not-object", null],
      ["missing-state", { id: "a", url: "https://example.com/a", attempt: 0, nextRunAt: null, createdAt: stamp, updatedAt: stamp }],
      ["bad-next", { id: "b", url: "https://example.com/b", state: "queued", attempt: 0, nextRunAt: "bad", createdAt: stamp, updatedAt: stamp }],
      ["missing-time", { id: "c", url: "https://example.com/c", state: "queued", attempt: 0, nextRunAt: null }],
    ]) {
      const validationFile = path.join(root, name + ".json");
      atomicJson(validationFile, { version: 1, jobs: [job] });
      const validationQueue = createArchiveQueue({ file: validationFile, autoStart: false });
      assert.strictEqual(validationQueue.jobs.size, 0);
      assert.ok(validationQueue.diagnostics.length > 0);
    }

    const corruptFile = path.join(root, "corrupt.json");
    fs.mkdirSync(path.dirname(corruptFile), { recursive: true });
    fs.writeFileSync(corruptFile, "{not json", "utf8");
    const corrupt = createArchiveQueue({ file: corruptFile, autoStart: false });
    assert.strictEqual(corrupt.getStatus("anything"), null);
    assert.match(corrupt.diagnostics[0], /主文件读取失败/);
    assert.throws(() => corrupt.retry("anything"), /未知/);

    const invalidFile = path.join(root, "invalid.json");
    atomicJson(invalidFile, { version: 1, jobs: [{ id: "bad", url: "https://example.com", state: "queued", attempt: 9, nextRunAt: 0 }] });
    const invalid = createArchiveQueue({ file: invalidFile, autoStart: false });
    assert.strictEqual(invalid.jobs.size, 0);
    assert.match(invalid.diagnostics[0], /attempt/);

    const cookieValue = ["secret", "cookie", "value"].join("-");
    process.env.X_COOKIE = cookieValue;
    const noCookie = createArchiveQueue({ file: path.join(root, "cookie.json"), autoStart: false,
      processor: async () => ({ state: "failed", error: "X_COOKIE=" + cookieValue, retryable: false }) });
    noCookie.enqueue(Object.assign(entry("6.1"), { X_COOKIE: cookieValue, headers: { cookie: cookieValue } }));
    await noCookie.runDue();
    const cookieText = fs.readFileSync(path.join(root, "cookie.json"), "utf8");
    assert.strictEqual(cookieText.includes(process.env.X_COOKIE), false);
    delete process.env.X_COOKIE;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.X_COOKIE;
  }
})().then(() => console.log("archive-queue: ALL PASS")).catch(error => { console.error(error); process.exitCode = 1; });
