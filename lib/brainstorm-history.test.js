"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "brainstorm-history-test-"));
process.env.BRAINSTORM_DIR = root;
const history = require("./brainstorm-history");

const analysis = {
  mode: "fusion",
  summary: { items: 3, relations: 4, archiveCoverage: 67 },
  fusion: {
    goal: "制作符合自己偏好的网站设计 Skill",
    plans: [{
      type: "能力融合",
      score: 92,
      confidence: "高",
      summary: "把动效工作流与高分网页审美标准组合起来。",
      rationale: "来源互补且可以用同一个页面验证。",
      contributions: [
        { id: "1.1", title: "网站动效神器", strength: "动效实现", reason: "提供可复用的动效方法" },
        { id: "2.1", title: "高分网页大赏", strength: "审美标尺", reason: "提供优秀案例与评价依据" },
      ],
      mvp: ["整理十个偏好样例", "制作一个页面并按标尺复盘"],
    }],
  },
  suggestions: [{ title: "先建立评价量表", summary: "把偏好变成可检验规则。", confidence: "中", score: 80 }],
};

const saved = history.saveReport(analysis, { now: new Date("2026-08-07T08:09:10.000Z"), suffix: "abc123" });
assert.match(saved.id, /^20260807T080910-abc123$/);
assert.strictEqual(saved.goal, analysis.fusion.goal);
assert.strictEqual(saved.sourceCount, 2);
assert.strictEqual(saved.verification.status, "pending");
assert.strictEqual(saved.verification.evidenceCoverage, 67);
assert.ok(fs.existsSync(path.join(root, saved.id + ".md")));

const report = history.readReport(saved.id);
assert.ok(report.includes("# 头脑风暴方案"));
assert.ok(report.includes(analysis.fusion.goal));
assert.ok(report.includes("网站动效神器"));
assert.ok(report.includes("整理十个偏好样例"));
assert.ok(report.includes("## 验证记录"), "保存方案必须包含验证记录区");

const verified = history.updateVerification(saved.id, {
  status: "verified",
  result: "页面走查通过，生成耗时和人工修改量达到预期",
  reviewedAt: "2026-08-08T00:00:00.000Z",
});
assert.strictEqual(verified.verification.status, "verified");
assert.strictEqual(verified.verification.evidenceCoverage, 67);
assert.strictEqual(verified.verification.reviewedAt, "2026-08-08T00:00:00.000Z");
const verifiedReport = history.readReport(saved.id);
assert.ok(verifiedReport.includes("**状态**：已验证"));
assert.ok(verifiedReport.includes("页面走查通过"));
assert.ok(verifiedReport.includes("来源证据覆盖率**：67%"));
assert.throws(() => history.updateVerification(saved.id, { status: "unknown" }), /验证状态/);
assert.throws(() => history.updateVerification(saved.id, { status: "verified", reviewedAt: "bad-date" }), /复盘日期/);
assert.throws(() => history.updateVerification("../escape", { status: "verified" }), /非法方案编号/);
assert.strictEqual(history.updateVerification(saved.id, { status: "pending", result: "idle" }).verification.reviewedAt, null);

const truncated = history.saveReport(
  Object.assign({}, analysis, { summary: { items: 300, totalItems: 301, truncated: true, relations: 4, archiveCoverage: 67 } }),
  { now: new Date("2026-08-07T08:10:11.000Z"), suffix: "def456" }
);
const truncatedReport = history.readReport(truncated.id);
assert.ok(truncatedReport.includes("项目库共 301 条，本次仅分析前 300 条"), "截断分析必须在保存的方案中说明覆盖范围");

const items = history.listReports();
assert.strictEqual(items.length, 2);
assert.ok(items.some(item => item.id === saved.id));
assert.ok(items.some(item => item.id === truncated.id));
assert.strictEqual(items[0].topPlan, "能力融合");
assert.strictEqual(items.find(item => item.id === saved.id).verification.status, "pending");
assert.ok(items.find(item => item.id === truncated.id).verification);
assert.throws(() => history.readReport("../escape"), /非法方案编号/);

/* 旧方案 metadata 没有 verification 时按待验证兼容读取，并可补写验证。 */
const legacyId = "20260801T000000-legacy1";
const legacyMetadata = {
  id: legacyId, createdAt: "2026-08-01T00:00:00.000Z", goal: "旧方案兼容", mode: "fusion",
  topPlan: "旧方案", score: 0, sourceCount: 0,
};
fs.writeFileSync(path.join(root, legacyId + ".md"),
  `<!-- linggan:brainstorm-meta=${Buffer.from(JSON.stringify(legacyMetadata), "utf8").toString("base64url")} -->\n# 旧方案\n\n## 实际需求\n\n旧方案兼容\n`,
  "utf8");
const legacy = history.metadataFromFile(path.join(root, legacyId + ".md"));
assert.strictEqual(legacy.verification.status, "pending");
assert.strictEqual(legacy.verification.evidenceCoverage, 0);
const legacyVerified = history.updateVerification(legacyId, { status: "rejected", result: "实验未通过", reviewedAt: "2026-08-02T00:00:00.000Z" });
assert.strictEqual(legacyVerified.verification.status, "rejected");
assert.ok(history.readReport(legacyId).includes("**状态**：被否定"));

fs.rmSync(root, { recursive: true, force: true });
console.log("brainstorm-history: ALL PASS");
