"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { IdempotencyStore } = require("./idempotency");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "store-test-"));
const tmpReadme = path.join(tmpDir, "README.md");
// 注意:正文标点须与 server.js 一致——冒号用全角「：」,括号用全角「（）」,
// 否则 updateNote 的正则无法命中,断言也会失败。
const seed = `# Test

## 1. AI 工具

### ⏳ 1.1 已有条目
- **简介**：seed
- **作者 / 来源**：[测试](https://example.com)
- **难度**：⭐
- **研究要点**：（待补充）
`;
fs.writeFileSync(tmpReadme, seed, "utf-8");
process.env.README_FILE = tmpReadme;

const store = require("./store");

// 纯函数测试(不碰文件)
assert.strictEqual(store.nextIdIn(seed, "AI 工具"), "1.2");
const snip = store.buildSnippet({ id: "1.2", name: "新", url: "https://example.com/new", desc: "测试", difficulty: 2, site: "测试", tags: "本地优先, 测试", whySaved: "验证方案" });
assert.ok(snip.startsWith("### ⏳ 1.2 新"));
assert.ok(/<!-- linggan:uid=[^ ]+ -->/.test(snip));
assert.ok(snip.includes("- **难度**：⭐⭐"));
assert.ok(snip.includes("- **标签**：本地优先, 测试"));
assert.ok(snip.includes("- **为什么收藏**：验证方案"));

const inserted = store.insertSnippet(seed, "AI 工具", snip);
assert.ok(inserted.includes("### ⏳ 1.2 新"));
assert.ok(
  inserted.indexOf("- **研究要点**：（待补充）") < inserted.indexOf("### ⏳ 1.2 新"),
  "新条目必须插入在上一条目的完整字段块之后"
);

const deleted = store.deleteEntry(inserted, "1.2");
assert.ok(deleted !== null);
assert.ok(!deleted.includes("### ⏳ 1.2 新"));
assert.ok(deleted.includes("- **简介**：seed"), "删除新条目不能连带删除上一条字段");

const customId = store.nextIdIn(seed, "自定义实验");
assert.strictEqual(customId, "2.1");
const customText = store.insertSnippet(seed, "自定义实验", snip.replace("1.2", customId));
assert.ok(customText.includes("## 2. 自定义实验"));

const stUpdated = store.updateStatus(seed, "1.1", "✅");
assert.ok(stUpdated.includes("### ✅ 1.1 已有条目"));
assert.strictEqual(store.updateStatus(seed, "9.9", "✅"), null);

const noteUpdated = store.updateNote(seed, "1.1", "我的笔记");
assert.ok(noteUpdated.includes("- **研究要点**：我的笔记"));

const merged = store.mergeEntryFields(seed, "1.1", { tags: "本地优先, 测试", whySaved: "用于验证合并" });
assert.ok(merged.includes("- **标签**：本地优先, 测试"));
assert.ok(merged.includes("- **为什么收藏**：用于验证合并"));
assert.ok(merged.indexOf("- **标签**：") < merged.indexOf("- **难度**："));
const mergedAgain = store.mergeEntryFields(merged, "1.1", { tags: "测试, 新标签", whySaved: "用于验证合并" });
assert.ok(mergedAgain.includes("- **标签**：本地优先, 测试, 新标签"));
assert.strictEqual((mergedAgain.match(/用于验证合并/g) || []).length, 1);
assert.strictEqual(store.mergeEntryFields(seed, "9.9", { tags: "x" }), null);
assert.strictEqual(store.updateNote(seed, "9.9", "x"), null);
assert.strictEqual(store.updateNote(seed.replace("- **研究要点**：（待补充）", ""), "1.1", "x").includes("我的笔记"), false);
assert.strictEqual(store.deleteEntry(seed, "9.9"), null);
const richSnippet = store.buildSnippet({ id: "1.3", name: "Rich", url: "https://example.org", author: "A", image: "cover.png", createdAt: "2026-08-14T00:00:00.000Z" });
assert.match(richSnippet, /作者.*A/);
assert.match(richSnippet, /封面/);
assert.match(richSnippet, /created-at=2026-08-14/);
assert.strictEqual(store.nextIdIn("# Empty", "AI 工具"), "1.1");
assert.ok(store.insertSnippet("# Empty", "AI 工具", richSnippet).includes("## 1. AI 工具"));
const appendedWhy = store.mergeEntryFields(merged, "1.1", { tags: "", whySaved: "第二原因" });
assert.match(appendedWhy, /用于验证合并；第二原因/);
assert.strictEqual(store.mergeEntryFields(seed, "1.1", null), seed);

// 文件工具测试
assert.strictEqual(store.readAll(), seed);
store.writeWithBackup(inserted);
assert.ok(store.readAll().includes("### ⏳ 1.2 新"));
const backups = fs.readdirSync(tmpDir).filter(f => /^README\.backup-\d{17}(?:-\d+)?\.md$/.test(f));
assert.ok(backups.length >= 1, "应有备份文件");

// 备份失败时不得继续覆盖当前数据。
const beforeFailedBackup = store.readAll();
const originalOpenSync = fs.openSync;
fs.openSync = (target, flags, ...args) => {
  if (/\.backup-/.test(String(target)) && /\.stage$/.test(String(target))) throw new Error("模拟备份失败");
  return originalOpenSync(target, flags, ...args);
};
try {
  assert.throws(() => store.writeWithBackup(seed), /模拟备份失败/);
  assert.strictEqual(store.readAll(), beforeFailedBackup, "备份失败后原数据必须保持不变");
} finally {
  fs.openSync = originalOpenSync;
}

(async () => {
  const controlDir = store.CONTROL_DIR;
  const trusted = path.join(tmpDir, "trusted.txt");
  const operationId = crypto.randomUUID();
  const firstWrite = store.trustedWriteFile(trusted, "one", { operationId, action: "test.write", controlDir });
  assert.strictEqual(firstWrite.replayed, false);
  assert.strictEqual(store.trustedWriteFile(trusted, "one", { operationId, action: "test.write", controlDir }).replayed, true);
  assert.throws(() => store.trustedWriteFile(trusted, "different", { operationId, action: "test.write", controlDir }), error => error.code === "idempotency_conflict");
  assert.throws(() => store.trustedWriteSet([], { controlDir }), /缺少目标/);
  assert.throws(() => store.trustedWriteFile(trusted, "x", { operationId: "bad", controlDir }), /UUID/);
  assert.throws(() => store.trustedWriteSet([{ file: trusted, bytes: "a" }, { file: trusted, bytes: "b" }], { controlDir }), /重复/);

  const receiptFile = path.join(controlDir, "t3-operations", operationId + ".json");
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  receipt.state = "verified";
  fs.writeFileSync(receiptFile, JSON.stringify(receipt));
  assert.throws(() => store.trustedWriteFile(trusted, "one", { operationId, action: "test.write", controlDir }), error => error.code === "idempotency_recovery_required");
  assert.strictEqual(store.recoverTrustedWrites({ controlDir }).recovered, 1);
  assert.deepStrictEqual(store.recoverTrustedWrites({ controlDir: path.join(tmpDir, "empty-control") }), { recovered: 0, blocked: [] });

  const beforeId = crypto.randomUUID();
  const beforeTarget = path.join(tmpDir, "before-target.txt");
  store.trustedWriteFile(beforeTarget, "after", { operationId: beforeId, controlDir });
  fs.unlinkSync(beforeTarget);
  const beforeReceiptFile = path.join(controlDir, "t3-operations", beforeId + ".json");
  const beforeReceipt = JSON.parse(fs.readFileSync(beforeReceiptFile, "utf8"));
  beforeReceipt.state = "staged";
  fs.writeFileSync(beforeReceiptFile, JSON.stringify(beforeReceipt));
  assert.strictEqual(store.recoverTrustedWrites({ controlDir }).recovered, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(beforeReceiptFile, "utf8")).state, "rolled_back");

  const mixedId = crypto.randomUUID();
  const mixedA = path.join(tmpDir, "mixed-a.txt");
  const mixedB = path.join(tmpDir, "mixed-b.txt");
  store.trustedWriteSet([{ file: mixedA, bytes: "a" }, { file: mixedB, bytes: "b" }], { operationId: mixedId, controlDir });
  fs.unlinkSync(mixedB);
  const mixedReceiptFile = path.join(controlDir, "t3-operations", mixedId + ".json");
  const mixedReceipt = JSON.parse(fs.readFileSync(mixedReceiptFile, "utf8"));
  mixedReceipt.state = "staged";
  fs.writeFileSync(mixedReceiptFile, JSON.stringify(mixedReceipt));
  assert.throws(() => store.recoverTrustedWrites({ controlDir }), error => error.code === "idempotency_recovery_required");
  fs.unlinkSync(mixedA);
  assert.strictEqual(store.recoverTrustedWrites({ controlDir }).recovered, 1);

  const deleted = path.join(tmpDir, "delete-me.txt");
  fs.writeFileSync(deleted, "delete");
  store.trustedWriteFile(deleted, null, { controlDir });
  assert.strictEqual(fs.existsSync(deleted), false);
  store.writeAtomic(seed);
  assert.strictEqual(store.readAll(), seed);
  assert.strictEqual(await store.mutate(() => ({ write: false, result: "unchanged" })), "unchanged");
  const auxiliary = path.join(tmpDir, "auxiliary.txt");
  store.writeWithBackup(seed, { additionalChanges: [{ file: auxiliary, bytes: "aux" }] });
  assert.strictEqual(fs.readFileSync(auxiliary, "utf8"), "aux");
  assert.strictEqual(await store.mutate(() => seed + "\n"), undefined);
  await assert.rejects(store.mutate(() => null), /有效结果/);
  await assert.rejects(store.mutate(() => ({ result: true })), /缺少 text/);

  const idemStore = new IdempotencyStore(path.join(controlDir, "test-idempotency"));
  const idemId = crypto.randomUUID();
  const idemTarget = path.join(tmpDir, "idem.txt");
  const idemResult = store.trustedWriteFile(idemTarget, "idem", {
    operationId: idemId, controlDir, idempotency: { store: idemStore, action: "lifecycle.update", values: { entryRef: "1.1", lifecycleAction: "start", nextReviewAt: null } }, response: { ok: true },
  });
  assert.strictEqual(idemResult.response.saved, true);
  assert.deepStrictEqual(idemStore.get(idemId).response, { ok: true });
  const pendingRecoveryId = crypto.randomUUID();
  const pendingRecoveryValues = { entryRef: "1.1", lifecycleAction: "mark_reviewed", nextReviewAt: null };
  const pendingRecoveryTarget = path.join(tmpDir, "pending-recovery.txt");
  store.trustedWriteFile(pendingRecoveryTarget, "verified", {
    operationId: pendingRecoveryId,
    controlDir,
    idempotency: { store: idemStore, action: "lifecycle.update", values: pendingRecoveryValues },
    response: { recovered: true },
  });
  const pendingRecoveryReceiptFile = path.join(controlDir, "t3-operations", pendingRecoveryId + ".json");
  const pendingRecoveryReceipt = JSON.parse(fs.readFileSync(pendingRecoveryReceiptFile, "utf8"));
  const pendingWalFile = idemStore.fileFor(pendingRecoveryId);
  const pendingWal = JSON.parse(fs.readFileSync(pendingWalFile, "utf8"));
  pendingWal.state = "pending";
  pendingWal.httpStatus = null;
  pendingWal.response = null;
  pendingWal.completedAt = null;
  fs.writeFileSync(pendingWalFile, JSON.stringify(pendingWal));
  fs.writeFileSync(pendingRecoveryReceiptFile, JSON.stringify(pendingRecoveryReceipt));
  store.recoverTrustedWrites({ controlDir, now: () => new Date("2026-08-20T00:00:00.000Z") });
  assert.deepStrictEqual(idemStore.get(pendingRecoveryId).response, { recovered: true }, "startup recovery must finish the pending idempotency WAL");
  store.recoverTrustedWrites({ controlDir, now: () => new Date("2026-08-20T00:00:00.000Z") });

  const cleanupId = crypto.randomUUID();
  const cleanupTarget = path.join(tmpDir, "cleanup-target.txt");
  fs.writeFileSync(cleanupTarget, "before");
  store.trustedWriteFile(cleanupTarget, "after", { operationId: cleanupId, controlDir });
  const cleanupReceipt = JSON.parse(fs.readFileSync(path.join(controlDir, "t3-operations", cleanupId + ".json"), "utf8"));
  fs.writeFileSync(cleanupReceipt.targets[0].old, "not-the-recorded-old-generation");
  store.recoverTrustedWrites({ controlDir });
  assert.strictEqual(fs.existsSync(cleanupReceipt.targets[0].old), true, "recovery must not delete an unverified residual generation");
  fs.unlinkSync(cleanupReceipt.targets[0].old);
  fs.writeFileSync(cleanupReceipt.targets[0].stage, "after");
  store.recoverTrustedWrites({ controlDir });
  assert.strictEqual(fs.existsSync(cleanupReceipt.targets[0].stage), false, "verified residual stage may be cleaned after commit");

  const missingWalBytes = fs.readFileSync(pendingWalFile);
  fs.unlinkSync(pendingWalFile);
  assert.throws(() => store.recoverTrustedWrites({ controlDir }), error => error.code === "idempotency_recovery_required");
  fs.writeFileSync(pendingWalFile, missingWalBytes);

  const blockedReceiptId = crypto.randomUUID();
  const blockedReceiptValues = { entryRef: "1.1", lifecycleAction: "clear_review", nextReviewAt: null };
  assert.throws(() => store.trustedWriteFile(path.join(tmpDir, "blocked-receipt.txt"), "after", {
    operationId: blockedReceiptId,
    controlDir,
    idempotency: { store: idemStore, action: "lifecycle.update", values: blockedReceiptValues },
    response: { confirmationToken: "must-never-be-persisted" },
  }), error => error.code === "idempotency_recovery_required");
  assert.strictEqual(fs.readFileSync(path.join(tmpDir, "blocked-receipt.txt"), "utf8"), "after", "verified domain bytes must not roll back after receipt failure");
  fs.unlinkSync(path.join(controlDir, "t3-operations", blockedReceiptId + ".json"));
  fs.unlinkSync(idemStore.fileFor(blockedReceiptId));
  const replayId = crypto.randomUUID();
  const replayValues = { entryRef: "1.1", lifecycleAction: "complete", nextReviewAt: null };
  idemStore.begin({ requestId: replayId, action: "lifecycle.update", values: replayValues, beforeFingerprint: "a", afterFingerprint: "b", domainRef: "test" });
  idemStore.commit(replayId, 200, { replayed: true });
  const replayedIdem = store.trustedWriteFile(path.join(tmpDir, "never-written.txt"), "x", {
    operationId: replayId, controlDir, idempotency: { store: idemStore, action: "lifecycle.update", values: replayValues },
  });
  assert.deepStrictEqual(replayedIdem.response, { replayed: true });
  const automaticIdemId = crypto.randomUUID();
  const automaticIdem = store.trustedWriteFile(path.join(tmpDir, "automatic-idempotency.txt"), "x", {
    operationId: automaticIdemId,
    controlDir,
    idempotency: {
      action: "lifecycle.update",
      values: { entryRef: "1.1", lifecycleAction: "reset", nextReviewAt: null },
    },
  });
  assert.strictEqual(automaticIdem.replayed, false);

  const collisionId = crypto.randomUUID();
  const collisionTarget = path.join(tmpDir, "stage-collision.txt");
  fs.writeFileSync(collisionTarget + ".linggan-t3-" + collisionId + "-0.stage", "collision");
  assert.throws(() => store.trustedWriteFile(collisionTarget, "x", { operationId: collisionId, controlDir }), /generation 路径碰撞/);

  const unknownTarget = path.join(tmpDir, "unknown-new.txt");
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = (file, ...args) => path.resolve(String(file)) === path.resolve(unknownTarget) ? Buffer.from("unknown") : originalReadFileSync(file, ...args);
  try {
    assert.throws(() => store.trustedWriteFile(unknownTarget, "expected", { controlDir }), error => error.code === "manual_recovery_required");
  } finally { fs.readFileSync = originalReadFileSync; }

  fs.mkdirSync(path.join(tmpDir, "directory-target"));
  assert.throws(() => store.trustedWriteFile(path.join(tmpDir, "directory-target"), "x", { controlDir }), /普通文件/);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("store: ALL PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
