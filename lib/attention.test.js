"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { aggregateAttention, archiveBlocked, compareId, parseNotes, todayRecommendations } = require("./attention");

const now = "2026-08-14T00:00:00.000Z";
const entries = [
  ["1.1", "11111111-1111-4111-8111-111111111111", "⏳", "2026-08-07T00:00:00.000Z", null, null],
  ["1.2", "22222222-2222-4222-8222-222222222222", "🔄", "2026-07-01T00:00:00.000Z", "2026-07-31T00:00:00.000Z", null],
  ["1.3", "33333333-3333-4333-8333-333333333333", "✅", null, null, now],
  ["1.10", "44444444-4444-4444-8444-444444444444", "⏳", "2026-08-07T00:00:00.001Z", null, null],
];
function record([id, uid, status, created, studied, review]) {
  return `### ${status} ${id} Item ${id}\n<!-- linggan:uid=${uid} -->\n${created ? `<!-- linggan:created-at=${created} -->\n` : ""}${studied ? `<!-- linggan:last-studied-at=${studied} -->\n` : ""}${review ? `<!-- linggan:next-review-at=${review} -->\n` : ""}- **研究要点**：（待补充）\n`;
}
const data = `# Data\n<!-- linggan:data-version=2 -->\n## 1. AI 工具\n${entries.map(record).join("\n")}`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "attention-"));
fs.mkdirSync(path.join(root, entries[1][1]), { recursive: true });
fs.writeFileSync(path.join(root, entries[1][1], "notes.md"), "## 研究结论\n- **行动项**: 做实验\n", "utf8");
const result = aggregateAttention(data, {
  now,
  entriesDir: root,
  archiveByUid: {
    [entries[0][1]]: { state: "partial", retryable: false, contentUsable: true, integrity: { state: "healthy" } },
    [entries[1][1]]: { state: "failed" },
    [entries[2][1]]: { state: "not_archived", taskState: "queued" },
    [entries[3][1]]: { state: "not_archived", taskState: "queued" },
  },
});
assert.deepStrictEqual(result.items.find(item => item.id === "1.1").reasons.map(item => item.code), ["unresearched"]);
assert.deepStrictEqual(result.items.find(item => item.id === "1.2").reasons.map(item => item.code), ["archive_blocked", "open_action", "stalled"]);
assert.deepStrictEqual(result.items.find(item => item.id === "1.3").reasons.map(item => item.code), ["review_due", "lifecycle_missing"]);
assert.strictEqual(result.items.some(item => item.id === "1.10"), false, "未满整 7 天不能命中");
assert.strictEqual(result.counts.byReason.archive_blocked, 1);
assert.strictEqual(todayRecommendations(result).some(item => item.id === "1.3"), true);
assert.strictEqual(archiveBlocked({ state: "not_archived", taskState: "queued" }), false);
assert.strictEqual(archiveBlocked({ state: "not_archived" }), true);
assert.strictEqual(archiveBlocked({ state: "partial", retryable: false, contentUsable: true, integrity: { state: "unchecked" } }), false);
assert.strictEqual(archiveBlocked({ state: "partial", retryable: true }), true);
assert.strictEqual(archiveBlocked({ state: "partial", contentUsable: false }), true);
assert.strictEqual(archiveBlocked({ state: "partial", integrity: { state: "damaged" } }), true);
assert.strictEqual(archiveBlocked({ state: "succeeded" }), false);
assert.strictEqual(archiveBlocked(), true);
assert.strictEqual(compareId("1.2", "1.10") < 0, true);
assert.strictEqual(compareId("bad", "also-bad") !== 0, true);
assert.strictEqual(compareId("1.02", "1.2") !== 0, true);
assert.deepStrictEqual(parseNotes("**关键发现**: 结论\n**使用感受**:\n多行\n## next"), { keyFindings: "结论", actionItems: "", conclusion: "", experience: "多行" });
assert.throws(() => aggregateAttention(data, { now: "invalid" }), error => error.code === "invalid_timestamp");
assert.strictEqual(aggregateAttention(data, { now, archiveStatuses: {} }).items.length > 0, true);

const tooLarge = path.join(root, entries[0][1]);
fs.mkdirSync(tooLarge, { recursive: true });
const largeFile = path.join(tooLarge, "notes.md");
fs.writeFileSync(largeFile, "x");
const originalLstat = fs.lstatSync;
fs.lstatSync = file => file === largeFile ? { isFile: () => true, size: 20 * 1024 * 1024 + 1 } : originalLstat(file);
try {
  const warned = aggregateAttention(data, { now, entriesDir: root });
  assert.ok(warned.warnings.some(item => item.code === "notes_too_large"));
} finally { fs.lstatSync = originalLstat; }
fs.rmSync(largeFile);
fs.mkdirSync(largeFile);
assert.ok(aggregateAttention(data, { now, entriesDir: root }).warnings.some(item => item.code === "notes_unreadable"));
fs.rmSync(largeFile, { recursive: true });
fs.writeFileSync(largeFile, "x");
const originalRead = fs.readFileSync;
fs.readFileSync = file => file === largeFile ? (() => { throw new Error("unreadable"); })() : originalRead(file);
try {
  assert.ok(aggregateAttention(data, { now, entriesDir: root }).warnings.some(item => item.code === "notes_unreadable"));
} finally { fs.readFileSync = originalRead; }
assert.throws(() => aggregateAttention(data.replace("1.1", "1.2"), { now }), error => error.code === "attention_unavailable");

console.log("attention: ALL PASS");
