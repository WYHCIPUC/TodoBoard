"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const brainstorm = require("./brainstorm");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "brainstorm-test-"));
const uid1 = "11111111-1111-4111-8111-111111111111";
const uid2 = "22222222-2222-4222-8222-222222222222";
const uid3 = "33333333-3333-4333-8333-333333333333";
const uid4 = "44444444-4444-4444-8444-444444444444";
const data = `# Test
<!-- linggan:data-version=2 -->

## 1. AI 工具

### ⏳ 1.1 AI 语音助手
<!-- linggan:uid=${uid1} -->
- **作者 / 来源**：[仓库](https://github.com/example/voice-agent)
- **标签**：语音, Web, Agent
- **难度**：⭐⭐
- **研究要点**：验证实时语音交互

### 🔄 1.2 本地 AI 知识库
<!-- linggan:uid=${uid2} -->
- **作者 / 来源**：[仓库](https://github.com/example/local-search)
- **标签**：AI, 搜索, Agent
- **难度**：⭐⭐

## 2. 前端 & 设计

### ⏳ 2.1 语音交互网页
<!-- linggan:uid=${uid3} -->
- **作者 / 来源**：[演示](https://example.com/voice-web)
- **标签**：语音, Web, 交互
- **难度**：⭐

## 3. 搜索 & OSINT

### ✅ 3.1 本地搜索索引引擎
<!-- linggan:uid=${uid4} -->
- **作者 / 来源**：[仓库](https://github.com/example/search-index)
- **标签**：搜索, AI, 索引
- **难度**：⭐⭐⭐
`;

try {
  fs.mkdirSync(path.join(root, uid1), { recursive: true });
  fs.writeFileSync(path.join(root, uid1, "notes.md"), "关键发现：语音流可以连接网页交互组件，并通过 Agent 完成实时响应。\n行动项：制作实时语音原型，记录延迟、识别率、操作成功率和失败场景，形成可以复用的评测结论。", "utf8");

  const tokens = brainstorm.tokenize("实时语音 Agent 与 Web 交互原型");
  assert.ok(tokens.has("语音"));
  assert.ok(tokens.has("agent"));
  assert.ok(!tokens.has("与"));

  const categories = brainstorm.categoryMap(data);
  assert.strictEqual(categories.get("1.1"), "AI 工具");
  assert.strictEqual(categories.get("2.1"), "前端 & 设计");

  const result = brainstorm.analyze(data, { entriesDir: root, mode: "explore" });
  assert.strictEqual(result.summary.items, 4);
  assert.ok(result.summary.relations >= 2, "应该识别跨条目关联");
  assert.ok(result.summary.archiveCoverage > 0);
  assert.ok(result.summary.dimensions >= 3, "应该同时形成多个分析维度");
  assert.ok(result.summary.crossRelations > 0, "应该统计跨域连接");
  assert.ok(result.graph.edges.some(edge => edge.crossCategory), "应该存在跨分类关联边");
  assert.ok(result.graph.edges.every(edge => Array.isArray(edge.types) && edge.types.length), "关系边必须标注碰撞类型");
  assert.ok(result.dimensions.some(item => item.id === "cross" && item.count > 0), "应该输出跨域碰撞维度");
  assert.ok(result.dimensions.some(item => item.id === "portfolio" && item.count > 0), "应该输出同类对照维度");
  assert.ok(result.collisionMatrix.length > 0, "应该生成跨域碰撞矩阵");
  assert.ok(result.suggestions.some(item => item.type === "组合项目"), "应该生成组合项目建议");
  assert.ok(new Set(result.suggestions.map(item => item.dimension)).size >= 3, "全景模式不应只给出单一类型建议");
  assert.ok(result.suggestions.every(item => item.evidence.length >= 2));
  assert.ok(result.suggestions.every(item => item.mvp.length >= 2));

  const feasible = brainstorm.analyze(data, { entriesDir: root, mode: "feasible" });
  assert.strictEqual(feasible.mode, "feasible");
  for (let i = 1; i < feasible.suggestions.length; i++) {
    assert.ok(feasible.suggestions[i - 1].difficulty <= feasible.suggestions[i].difficulty ||
      feasible.suggestions[i - 1].score >= feasible.suggestions[i].score);
  }

  const opportunities = brainstorm.analyze(data, { entriesDir: root, mode: "opportunities" });
  assert.strictEqual(opportunities.mode, "opportunities");
  assert.ok(opportunities.suggestions.every(item => ["cross", "transfer", "opportunity", "theme"].includes(item.dimension)));

  const challenges = brainstorm.analyze(data, { entriesDir: root, mode: "challenges" });
  assert.strictEqual(challenges.mode, "challenges");
  assert.ok(challenges.suggestions.some(item => item.dimension === "challenge"));

  const designData = `# Design fusion
<!-- linggan:data-version=2 -->

## 1. AI 工具

### ⏳ 1.1 网站动效神器
<!-- linggan:uid=55555555-5555-4555-8555-555555555555 -->
- **标签**：设计, 网站, 动效, Agent, 自动生成

## 2. 前端 & 设计

### ⏳ 2.1 高分网页大赏
<!-- linggan:uid=66666666-6666-4666-8666-666666666666 -->
- **标签**：网页, 交互, 灵感, 审美, 案例

## 3. 开源项目 & 开发

### ⏳ 3.1 Skill 脚手架
<!-- linggan:uid=77777777-7777-4777-8777-777777777777 -->
- **标签**：Skill, 模板, 脚本, 自动化
`;
  const fusion = brainstorm.analyze(designData, {
    entriesDir: root,
    mode: "fusion",
    goal: "制作一个属于自己的、符合自己偏好的网站设计 Skill",
  });
  assert.strictEqual(fusion.mode, "fusion");
  assert.strictEqual(fusion.fusion.goal, "制作一个属于自己的、符合自己偏好的网站设计 Skill");
  assert.ok(fusion.fusion.plans.length >= 1, "实际需求应该生成多项目融合方案");
  const primaryTitles = fusion.fusion.plans[0].contributions.map(item => item.title);
  assert.ok(primaryTitles.includes("网站动效神器"), "融合方案应该借用网站动效生成能力");
  assert.ok(primaryTitles.includes("高分网页大赏"), "融合方案应该借用审美案例与交互灵感");
  assert.ok(fusion.fusion.plans[0].contributions.every(item => item.strength && item.reason));
  assert.ok(fusion.fusion.plans[0].mvp.length >= 4);

  const empty = brainstorm.analyze("# Empty\n", { entriesDir: root });
  assert.strictEqual(empty.summary.items, 0);
  assert.deepStrictEqual(empty.suggestions, []);
  console.log("brainstorm: ALL PASS");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
