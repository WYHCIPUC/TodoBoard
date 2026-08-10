"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "board.html"), "utf8");
const css = fs.readFileSync(path.join(root, "board.css"), "utf8");
const js = fs.readFileSync(path.join(root, "board.js"), "utf8");

/* 仅执行无 DOM 依赖的归档 UI 逻辑，确保状态映射和请求体测试是确定性的。 */
const logicStart = js.indexOf("const ARCHIVE_STATUS_META");
const logicEnd = js.indexOf("/* 8", logicStart);
assert.ok(logicStart >= 0 && logicEnd > logicStart, "缺少可测试的归档 UI 逻辑块");
const logicBox = {};
vm.runInNewContext(js.slice(logicStart, logicEnd) + `
  this.api = { ARCHIVE_STATUS_META, normalizeArchiveStatus, archiveCanRetry,
    archiveTimeLabel, archiveErrorLabel, archiveRetryRequest, manualContentRequest, archiveResponseState };
`, logicBox);
const archiveUi = logicBox.api;
const archiveStates = ["queued", "running", "partial", "succeeded", "failed", "manual_required"];
assert.deepStrictEqual(Object.keys(archiveUi.ARCHIVE_STATUS_META), archiveStates, "六种归档状态必须完整映射");
for (const state of archiveStates) {
  const normalized = archiveUi.normalizeArchiveStatus({ id: "1.1", state, attempt: "2" });
  assert.strictEqual(normalized.state, state);
  assert.strictEqual(archiveUi.ARCHIVE_STATUS_META[state].label.length > 0, true);
}
assert.strictEqual(archiveUi.normalizeArchiveStatus({ state: "unexpected" }).state, "queued", "未知状态应安全降级");
assert.strictEqual(archiveUi.normalizeArchiveStatus(null).nextRunAt, null);
assert.strictEqual(archiveUi.archiveCanRetry("partial"), true);
assert.strictEqual(archiveUi.archiveCanRetry("failed"), true);
assert.strictEqual(archiveUi.archiveCanRetry("manual_required"), true);
assert.strictEqual(archiveUi.archiveCanRetry("queued"), false);
assert.strictEqual(archiveUi.archiveCanRetry("running"), false);
assert.strictEqual(archiveUi.archiveCanRetry("succeeded"), false);
assert.strictEqual(archiveUi.archiveResponseState({ id: "1.2", state: "failed" }, { ok: false }).archive.state, "failed");
assert.strictEqual(archiveUi.archiveResponseState({ id: "1.2", state: "failed" }, { ok: true, archive: { id: "1.2", state: "queued" } }).archive.state, "queued");
assert.strictEqual(archiveUi.archiveResponseState({ id: "1.2", state: "failed" }, null).recovered, true);
assert.strictEqual(archiveUi.archiveTimeLabel(null), "未安排");
assert.strictEqual(archiveUi.archiveTimeLabel("not-a-date"), "未安排");
assert.ok(archiveUi.archiveTimeLabel("2030-01-02T03:04:00.000Z").includes("2030"));
assert.strictEqual(archiveUi.archiveErrorLabel("  a\n\tb  "), "a b");
assert.strictEqual(archiveUi.archiveErrorLabel("x".repeat(300)).length, 240);
assert.strictEqual(JSON.stringify(archiveUi.archiveRetryRequest("1.2")), JSON.stringify({
  url: "/api/archive/retry",
  options: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "1.2" }) },
}));
assert.strictEqual(JSON.stringify(archiveUi.manualContentRequest("1.2", "# note")), JSON.stringify({
  url: "/api/entry/content",
  options: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "1.2", content: "# note" }) },
}));

assert.ok(html.includes('id="entryArchive"'), "详情页必须提供归档状态区");
assert.ok(html.includes("manualArchiveContent") === false, "手动输入应按 manual_required 状态动态显示");
assert.ok(js.includes("/api/archive/status?id="), "刷新后必须从服务端读取归档状态");
assert.ok(js.includes('data-archive-action="retry"'), "必须提供归档重试操作");
assert.ok(js.includes("button.disabled = true") && js.includes("removeAttribute(\"aria-busy\")"), "重试和手动提交必须防止重复提交并恢复失败状态");
assert.ok(js.includes("20 MB") && js.includes("raw.html.gz"), "必须说明 20 MB raw HTML 限制及降级行为");
for (const label of ["排队中", "归档中", "部分完成", "已归档", "归档失败", "需要手动补录"]) {
  assert.ok(js.includes(label), "缺少归档状态文案 " + label);
}
assert.ok(js.includes("textContent = content.slice(0, 2000)"), "外部正文只能作为文本注入 DOM");
assert.ok(!js.includes("innerHTML = content"), "不得将原始响应正文作为 HTML 注入 DOM");

console.log("ui: archive logic matrix coverage 100% (all states, retry branches, fallback/time/error and API builders)");

assert.ok(html.includes('id="moreBtn"'), "窄屏必须提供更多操作入口");
assert.ok(html.includes('id="morePanel" role="menu"'));
assert.ok(css.includes(".load .more-wrap { display: block; }"));
assert.ok(!css.includes(".load .icon-btn { display: none; }"), "不能在窄屏隐藏所有操作入口");
assert.ok(js.includes('document.getElementById(item.dataset.target).click()'));

for (const id of ["rollBtn", "statsBtn", "brainstormBtn", "trashBtn", "dataBtn", "helpBtn", "themeBtn"]) {
  const button = html.match(new RegExp(`<button[^>]+id="${id}"[^>]*>`));
  assert.ok(button, "缺少按钮 " + id);
  assert.ok(/aria-label=/.test(button[0]), id + " 缺少可访问名称");
}

for (const id of ["hotkeyModal", "rollModal", "statsModal", "trashModal", "dataModal", "onboardingModal", "modal"]) {
  const dialog = html.match(new RegExp(`<div[^>]+id="${id}"[^>]*>`));
  assert.ok(dialog, "缺少对话框 " + id);
  assert.ok(/role="dialog"/.test(dialog[0]), id + " 缺少 dialog 角色");
  assert.ok(/aria-modal="true"/.test(dialog[0]), id + " 缺少 aria-modal");
}

assert.ok(html.includes('id="toast" role="status" aria-live="polite"'));
assert.ok(html.includes('id="svcState"'), "服务状态必须提供可读文本与重试入口");
assert.ok(js.includes("function setServiceState(status)"));
assert.ok(js.includes("httpLoadController.abort()"), "重复数据加载必须取消旧请求");
assert.ok(js.includes('"data-error" : "offline-cache"'), "缓存回退必须显式进入只读状态");
assert.ok(js.includes("state.httpMode = false"), "服务断开后不得继续保留可写模式");
assert.ok(html.includes('id="duplicateOpenBtn"'));
assert.ok(html.includes('id="duplicateSaveBtn"'));
assert.ok(html.includes('id="duplicateMergeBtn"'));
assert.ok(js.includes("allowDuplicate: true"));
assert.ok(js.includes('fetch("/api/merge"'));
assert.ok(js.includes("function previewBackup(bundle)"));
assert.ok(js.includes("备份时间：${preview.createdAt}"));
assert.ok(html.includes('id="importBookmarksBtn"'));
assert.ok(js.includes('fetch("/api/bookmarks/preview"'));
assert.ok(js.includes('fetch("/api/bookmarks/import"'));
assert.ok(html.includes('id="onboardingStartBtn"'));
assert.ok(js.includes("maybeShowOnboarding"));
assert.ok(js.includes("data.health"));
assert.ok(html.includes('id="searchClearBtn"'));
assert.ok(html.includes('id="progressTrack" role="progressbar"'));
assert.ok(js.includes("function completionProgress(total, done, doing)"));
assert.ok(js.includes("done + doing * 0.5"), "完成进度必须按已完成和进行中计算");
assert.ok(!js.includes("nPending + nDoing * 0.5"), "完成进度不能把待研究计入已完成");
assert.ok(js.includes('role="button" tabindex="0" aria-expanded="false"'));
assert.ok(js.includes("function toggleRow(row)"));
assert.ok(js.includes('aria-hidden="true" inert'));
assert.ok(js.includes('panel.toggleAttribute("inert", !open)'));
assert.ok(js.includes("function updateItemStatus(item, next)"));
assert.ok(css.includes(".statsbar::-webkit-scrollbar, .cats::-webkit-scrollbar"));
assert.ok(css.includes(".daily .d-actions { grid-column: 1 / -1; }"));
assert.ok(css.includes("#statsModal .modal { max-width: 760px; }"), "统计弹窗需要为图表图例保留足够宽度");
assert.ok(css.includes("@media (max-width: 680px) { .rings { grid-template-columns: 1fr; } }"), "统计卡片在窄屏应切换单列");
assert.ok(js.includes(").toFixed(1), \"平均难度\""), "平均难度必须限制为一位小数");
assert.ok(js.includes('gradientStops.join(", ")'), "环形图色段之间必须使用逗号分隔");
assert.ok(js.includes("${escapeHtml(t)}") && js.includes("${escapeHtml(d)}"), "搜索空态不得直接插入用户输入");
assert.ok(js.includes("${escapeHtml(f.k)}"), "Markdown 字段名不得直接插入 HTML");
assert.ok(js.includes("if (!response.ok || !data || !data.ok)"), "批量操作必须检查服务端响应");
assert.ok(js.includes('CAT_TEXTURES[cat] || CAT_TEXTURES["其他"]'), "自定义分类必须使用安全的横幅纹理兜底");
assert.ok(js.includes("async function readJsonResponse(response)"), "接口异常必须转换成可读错误");
assert.ok(css.includes("#statsModal .ring { width: 86px; height: 86px; }"), "超窄屏统计图需要为图例让出空间");
assert.ok(html.includes('class="product-nav" id="productNav"'), "核心工作台必须提供一级产品导航");
assert.ok(html.includes('id="inspirationNav" data-product-view="inspiration"'));
assert.ok(html.includes('id="brainstormBtn" data-product-view="brainstorm"'));
assert.ok(html.includes('class="product-nav-step" aria-hidden="true">01</span>'));
assert.ok(html.includes('class="product-nav-step" aria-hidden="true">02</span>'), "双核心导航需要清晰表达两阶段工作流");
assert.ok(html.includes('id="brainstormBridgeBtn"'), "灵感项目库需要提供进入头脑风暴的上下文入口");
assert.ok(html.includes('id="brainstormBridgeLabel"'));
assert.ok(html.includes('id="brainstormView" class="brainstorm-workspace"'), "头脑风暴必须使用独立工作台而不是工具弹窗");
assert.ok(!html.includes('id="brainstormModal"'), "头脑风暴不应继续作为模态弹窗");
assert.ok(html.includes('data-brainstorm-mode="fusion"'));
assert.ok(html.includes('data-brainstorm-mode="panorama"'));
assert.ok(html.includes('data-brainstorm-mode="opportunities"'));
assert.ok(html.includes('data-brainstorm-mode="challenges"'));
assert.ok(html.includes('data-brainstorm-mode="roadmap"'));
assert.ok(js.includes('"/api/brainstorm?mode=" + encodeURIComponent(brainstormMode)'));
assert.ok(js.includes("function renderBrainstormGraph(graph)"));
assert.ok(js.includes("function renderBrainstormFusion(fusion)"));
assert.ok(js.includes("function updateBrainstormPanels(mode = brainstormMode)"), "不同分析视角必须只显示对应内容");
assert.ok(js.includes("function renderBrainstormDimensions(dimensions)"));
assert.ok(js.includes("function renderBrainstormMatrix(matrix)"));
assert.ok(js.includes('setProductView("brainstorm")'));
assert.ok(js.includes('document.getElementById("statsbar").hidden = true'), "首页不应重复展示统计卡和分类汇总");
assert.ok(js.includes('document.getElementById("brainstormBridgeBtn").addEventListener("click", openBrainstorm)'));
assert.ok(js.includes("data-brainstorm-entry"));
assert.ok(css.includes(".brainstorm-layout { display: grid;"));
assert.ok(css.includes(".product-nav-item.active"));
assert.ok(html.includes('id="brainstormGoalForm"'));
assert.ok(html.includes('id="brainstormFusionPanel"'));
assert.ok(html.includes('id="brainstormSaveBtn"'), "头脑风暴必须可以保存为本地方案");
assert.ok(html.includes('id="brainstormHistory"'), "头脑风暴必须展示最近保存记录");
assert.ok(js.includes('fetch("/api/brainstorm/save"'));
assert.ok(js.includes('fetch("/api/brainstorm/history"'));
assert.ok(html.includes('id="brainstormDimensionsPanel"') && html.includes('id="brainstormNetworkPanel"'));
assert.ok(html.includes('id="brainstormSuggestionsPanel"'));
assert.ok(html.includes('id="brainstormGoal" maxlength="400"'));
assert.ok(html.includes('data-brainstorm-goal="制作一个属于自己的、符合自己偏好的网站设计 Skill"'));
assert.ok(js.includes('"&goal=" + encodeURIComponent(goal)'));
assert.ok(css.includes(".brainstorm-fusion-card.featured"));
assert.ok(css.includes(".fusion-featured-grid"), "推荐方案需要使用清晰的来源与验证路径双栏布局");
assert.ok(css.includes(".fusion-alternatives"), "备选组合需要降低视觉层级");
assert.ok(css.includes(".load > .icon-btn { display: none; }"), "辅助工具应收进更多菜单，避免与双核心导航争夺注意力");
assert.ok(css.includes(".brainstorm-bridge"));
assert.ok(css.includes(".product-nav-step"), "主导航需要统一的阶段标识");
assert.ok(css.includes("max-width: 1280px"), "应用外壳需要统一内容宽度");
assert.ok(html.includes('id="demoBanner" hidden'), "在线演示必须明确标识只读示例数据");
assert.ok(js.includes('state.demoMode ? await demoLoad() : await httpLoad()'));
assert.ok(js.includes('fetch("DATA.example.md"'), "在线演示只能加载可公开的示例数据");
assert.ok(js.includes('? "demo-brainstorm.json"'), "在线演示必须提供可用的预置头脑风暴结果");
console.log("ui: ALL PASS");
