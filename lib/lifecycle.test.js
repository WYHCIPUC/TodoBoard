"use strict";
const assert = require("assert");
const crypto = require("crypto");
const lifecycle = require("./lifecycle");
const { canonicalRequestHash } = require("./idempotency");
const schema = require("./schema");

const UID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-08-14T00:00:00.000Z";
const base = `# Data
<!-- linggan:data-version=2 -->
## 1. AI 工具
### ⏳ 1.1 示例
<!-- linggan:uid=${UID} -->
- **研究要点**：（待补充）
`;

let result = lifecycle.applyLifecycle(base, "1.1", "start_research", { now: NOW });
assert.strictEqual(result.status, "🔄");
assert.strictEqual(result.lifecycle.createdAt, null, "历史条目不补造 createdAt");
assert.strictEqual(result.lifecycle.lastStudiedAt, NOW);
assert.strictEqual(result.lifecycle.nextReviewAt, null);

result = lifecycle.applyLifecycle(result.text, UID, "complete", { now: NOW });
assert.strictEqual(result.status, "✅");
assert.strictEqual(result.lifecycle.nextReviewAt, "2026-09-13T00:00:00.000Z");
const repeated = lifecycle.applyLifecycle(result.text, "1.1", "complete", { now: "2026-08-15T00:00:00.000Z" });
assert.strictEqual(repeated.changed, false);
assert.strictEqual(repeated.lifecycle.lastStudiedAt, NOW, "重复状态不得移动时间");

const reviewed = lifecycle.applyLifecycle(result.text, "1.1", "mark_reviewed", { now: "2026-08-15T00:00:00.000Z" });
assert.strictEqual(reviewed.lifecycle.nextReviewAt, "2026-09-14T00:00:00.000Z");
assert.strictEqual(lifecycle.applyLifecycle(reviewed.text, "1.1", "clear_review", { now: NOW }).lifecycle.nextReviewAt, null);
assert.strictEqual(lifecycle.applyLifecycle(base, "1.1", "set_review", { now: NOW, nextReviewAt: NOW }).lifecycle.nextReviewAt, NOW);
assert.strictEqual(lifecycle.applyLifecycle(base, "1.1", "set_review", { now: NOW, nextReviewAt: "2036-08-11T00:00:00.000Z" }).lifecycle.nextReviewAt, "2036-08-11T00:00:00.000Z");
assert.throws(() => lifecycle.applyLifecycle(base, "1.1", "set_review", { now: NOW, nextReviewAt: "2026-08-13T23:59:59.999Z" }), error => error.code === "invalid_timestamp");
assert.throws(() => lifecycle.applyLifecycle(base, "1.1", "set_review", { now: NOW, nextReviewAt: "2036-08-11T00:00:00.001Z" }), error => error.code === "invalid_timestamp");

const damaged = base.replace("<!-- linggan:uid=", "<!-- linggan:created-at=bad -->\n<!-- linggan:created-at=2026-01-01T00:00:00.000Z -->\n<!-- linggan:created-at=2026-02-01T00:00:00.000Z -->\n<!-- linggan:uid=");
assert.throws(() => lifecycle.applyLifecycle(damaged, "1.1", "mark_reviewed", { now: NOW }), error => error.code === "invalid_lifecycle");
const repaired = lifecycle.applyLifecycle(damaged, "1.1", "repair_lifecycle", { now: NOW });
assert.strictEqual(schema.findEntry(repaired.text, "1.1").lifecycle.createdAt, "2026-01-01T00:00:00.000Z");
assert.strictEqual((repaired.text.match(/linggan:created-at=/g) || []).length, 1);
const damagedStudied = base.replace("<!-- linggan:uid=", "<!-- linggan:last-studied-at=2026-01-01T00:00:00.000Z -->\n<!-- linggan:last-studied-at=2026-02-01T00:00:00.000Z -->\n<!-- linggan:uid=");
assert.strictEqual(lifecycle.applyLifecycle(damagedStudied, "1.1", "repair_lifecycle", { now: NOW }).lifecycle.lastStudiedAt, "2026-02-01T00:00:00.000Z");

assert.strictEqual(lifecycle.substantive("待补充"), false);
assert.strictEqual(lifecycle.substantive(" 有结论 "), true);
assert.strictEqual(lifecycle.hasSubstantiveResearch({ actionItems: "执行" }), true);
assert.strictEqual(lifecycle.hasSubstantiveResearch({ actionItems: "暂无" }), false);
assert.strictEqual(lifecycle.hasSubstantiveResearch(), false);
assert.throws(() => lifecycle.applyLifecycle(base, "9.9", "complete", { now: NOW }), error => error.code === "entry_not_found");
assert.throws(() => lifecycle.applyLifecycle(base, "1.1", "unknown", { now: NOW }), error => error.code === "invalid_request");
assert.throws(() => lifecycle.applyLifecycle(base, "1.1", "set_review", { now: NOW, nextReviewAt: "bad" }), error => error.code === "invalid_timestamp");
assert.throws(() => lifecycle.applyLifecycle(base, "1.1", "start", { now: "bad" }), error => error.code === "invalid_timestamp");
assert.strictEqual(lifecycle.applyLifecycle(base, "1.1", "study_saved", { now: NOW, substantive: false }).changed, false);
const completedStudy = lifecycle.applyLifecycle(result.text, "1.1", "study_saved", { now: "2026-08-16T00:00:00.000Z", substantive: true });
assert.strictEqual(completedStudy.lifecycle.nextReviewAt, "2026-09-15T00:00:00.000Z");
assert.strictEqual(lifecycle.applyLifecycle(result.text, "1.1", "reset", { now: NOW }).status, "⏳");
assert.strictEqual(lifecycle.applyLifecycle(base, "1.1", "repair_lifecycle", { now: NOW }).changed, false);
const twoEntries = base + `\n### ⏳ 1.2 Second\n<!-- linggan:uid=22222222-2222-4222-8222-222222222222 -->\n- **研究要点**：（待补充）\n`;
assert.match(lifecycle.applyLifecycle(twoEntries, "1.1", "start", { now: NOW }).text, /### ⏳ 1\.2 Second/);

(async () => {
  let stored = base;
  let mutateCalls = 0;
  const receipts = new Map();
  const idempotency = { get: requestId => receipts.get(requestId) || null };
  const fakeStore = {
    CONTROL_DIR: "unused",
    mutate: async mutator => {
      mutateCalls++;
      const change = mutator(stored);
      if (change.write !== false) stored = change.text;
      if (change.operation) {
        const values = change.operation.idempotency.values;
        receipts.set(change.operation.operationId, {
          action: "lifecycle.update",
          requestHash: canonicalRequestHash("lifecycle.update", values),
          state: "committed",
          response: change.result,
        });
      }
      return change.result;
    },
  };
  const requestId = crypto.randomUUID();
  const saved = await lifecycle.updateLifecycle("1.1", "start", { store: fakeStore, idempotency, requestId, now: NOW });
  assert.strictEqual(saved.saved, true);
  assert.strictEqual(saved.status, "🔄");
  assert.strictEqual((await lifecycle.updateLifecycle("1.1", "start", { store: fakeStore, idempotency, requestId, now: NOW })).operationId, requestId);
  assert.strictEqual(mutateCalls, 1, "committed request must replay without another mutation");
  await assert.rejects(
    lifecycle.updateLifecycle("1.1", "complete", { store: fakeStore, idempotency, requestId, now: NOW }),
    error => error.code === "idempotency_conflict",
  );
  const pendingId = crypto.randomUUID();
  const pendingValues = { entryRef: "1.1", lifecycleAction: "complete", nextReviewAt: null };
  receipts.set(pendingId, { action: "lifecycle.update", requestHash: canonicalRequestHash("lifecycle.update", pendingValues), state: "pending", fixedNow: NOW });
  const pendingResult = await lifecycle.updateLifecycle("1.1", "complete", { store: fakeStore, idempotency, requestId: pendingId, now: "2026-08-20T00:00:00.000Z" });
  assert.strictEqual(pendingResult.status, "✅");
  assert.strictEqual(pendingResult.lifecycle.lastStudiedAt, NOW, "pending WAL retries must reuse the original fixedNow");
  const noChange = await lifecycle.updateLifecycle("1.1", "complete", { store: fakeStore, idempotency, requestId: crypto.randomUUID(), now: NOW });
  assert.strictEqual(noChange.saved, false);
  console.log("lifecycle: ALL PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
