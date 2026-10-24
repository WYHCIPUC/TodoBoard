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
assert.ok(fs.existsSync(path.join(root, saved.id + ".md")));

const report = history.readReport(saved.id);
assert.ok(report.includes("# 头脑风暴方案"));
assert.ok(report.includes(analysis.fusion.goal));
assert.ok(report.includes("网站动效神器"));
assert.ok(report.includes("整理十个偏好样例"));

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
assert.throws(() => history.readReport("../escape"), /非法方案编号/);

fs.rmSync(root, { recursive: true, force: true });
console.log("brainstorm-history: ALL PASS");
