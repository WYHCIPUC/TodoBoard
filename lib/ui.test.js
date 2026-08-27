"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "board.html"), "utf8");
const css = fs.readFileSync(path.join(root, "board.css"), "utf8");
const js = fs.readFileSync(path.join(root, "board.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");

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

for (const id of ["rollBtn", "statsBtn", "brainstormBtn", "trashBtn", "dataBtn", "helpBtn", "themeBtn", "commandBtn"]) {
  const button = html.match(new RegExp(`<button[^>]+id="${id}"[^>]*>`));
  assert.ok(button, "缺少按钮 " + id);
  assert.ok(/aria-label=/.test(button[0]), id + " 缺少可访问名称");
}

for (const id of ["hotkeyModal", "commandModal", "rollModal", "statsModal", "trashModal", "dataModal", "onboardingModal", "modal"]) {
  const dialog = html.match(new RegExp(`<div[^>]+id="${id}"[^>]*>`));
  assert.ok(dialog, "缺少对话框 " + id);
  assert.ok(/role="dialog"/.test(dialog[0]), id + " 缺少 dialog 角色");
  assert.ok(/aria-modal="true"/.test(dialog[0]), id + " 缺少 aria-modal");
}

assert.ok(html.includes('id="toast" role="status" aria-live="polite"'));
assert.ok(html.includes('id="commandInput" role="combobox"'), "快捷指令需要可访问的组合框语义");
assert.ok(html.includes('id="commandList" role="listbox"'), "快捷指令结果需要列表框语义");
assert.ok(js.includes("const COMMANDS = [") && js.includes("function runCommand(id)"), "快捷指令必须使用集中式可测试动作清单");
assert.ok(js.includes("dialogFocusState.opener = null"), "执行快捷指令后不得把焦点抢回已关闭面板的触发按钮");
assert.ok(js.includes('(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k"'), "快捷指令必须支持 Ctrl/Cmd+K");
assert.ok(js.includes('e.key === "ArrowDown"') && js.includes('e.key === "ArrowUp"'), "快捷指令必须支持方向键选择");
assert.ok(js.includes('aria-activedescendant'), "快捷指令必须同步当前键盘选项");
assert.ok(js.includes('open.querySelector("#fetchUrl, #commandInput")') && js.includes('open.querySelector(".modal-x")'), "快捷指令打开后必须优先聚焦搜索框");
assert.ok(html.includes('id="svcState"'), "服务状态必须提供可读文本与重试入口");
assert.ok(js.includes("function setServiceState(status)"));
assert.ok(js.includes("httpLoadController.abort()"), "重复数据加载必须取消旧请求");
assert.ok(js.includes('"data-error" : "offline-cache"'), "缓存回退必须显式进入只读状态");
assert.ok(js.includes("state.httpMode = false"), "服务断开后不得继续保留可写模式");
assert.ok(html.includes('id="duplicateOpenBtn"'));
assert.ok(html.includes('id="duplicateSaveBtn"'));
assert.ok(html.includes('id="duplicateMergeBtn"'));
assert.ok(js.includes("allowDuplicate: true"));
assert.ok(js.includes('localApiFetch("/api/merge"'));
assert.ok(js.includes("function previewBackup(bundle)"));
assert.ok(js.includes("备份时间：${clientPreview.createdAt}"));
assert.ok(html.includes('id="importBookmarksBtn"'));
assert.ok(js.includes('localApiFetch("/api/bookmarks/preview"'));
assert.ok(js.includes('localApiFetch("/api/bookmarks/import"'));
assert.ok(html.includes('id="onboardingStartBtn"'));
assert.ok(js.includes("maybeShowOnboarding"));
assert.ok(js.includes("data.health"));
assert.ok(html.includes('id="searchClearBtn"'));
assert.ok(html.includes('id="progressTrack" role="progressbar"'));
assert.ok(js.includes("function completionProgress(total, done, doing)"));
assert.ok(js.includes("done + doing * 0.5"), "完成进度必须按已完成和进行中计算");
assert.ok(!js.includes("nPending + nDoing * 0.5"), "完成进度不能把待研究计入已完成");
assert.ok(html.includes('id="listView" class="list" role="list"'), "列表容器必须提供 list 语义");
assert.ok(js.includes('role="listitem" tabindex="0"'), "列表行不得伪装成包含其他控件的 button");
assert.ok(js.includes('class="row-disclosure chev" aria-expanded="false"'), "列表行必须提供独立详情开关");
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
assert.ok(js.includes('localApiFetch("/api/brainstorm/save"'));
assert.ok(js.includes('localApiFetch("/api/brainstorm/history"'));
assert.ok(!/\bfetch\(\s*["'`]\/api\//.test(js), "所有本地 API 字面量请求都应经过 localApiFetch");
assert.ok(!js.includes("fetch(request.url, request.options)"), "归档控制请求也应经过 localApiFetch");
assert.ok(js.includes("function syncDialogFocus()"), "弹窗必须统一锁定焦点与恢复触发点");
assert.ok(js.includes('e.key !== "Tab"'), "弹窗必须提供键盘焦点闭环");
assert.ok(js.includes('aria-hidden="true" inert'), "看板折叠详情必须从键盘和读屏顺序中移除");
assert.ok(js.includes('detail.inert = !open'), "看板展开状态必须同步 inert");
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
assert.ok(!/\s(?:onclick|onerror)=["']/i.test(js), "严格 CSP 下不得生成内联事件属性");
assert.ok(serverSource.includes("script-src 'self'"), "静态页面必须保持严格的脚本 CSP");
assert.ok(!serverSource.includes("script-src 'self' 'unsafe-inline'"), "不得为修复交互而放宽脚本 CSP");
assert.ok(js.includes('const studyButton = e.target.closest(".study-btn")'), "看板必须通过外部脚本事件委托打开研究档案");
assert.ok(js.includes("function refreshEntryScreenshots(id)"), "截图变更后必须局部刷新，避免覆盖未保存表单");
assert.ok(!js.includes("openEntry(currentEntryId)"), "截图变更不得重新打开并重置整个档案");
assert.ok(js.includes("entryLoadSequence") && js.includes("entryLoadController.abort()"), "档案切换必须使旧请求失效");
assert.ok(js.includes("function closeStudy(force = false)") && js.includes("stopTimer();"), "研究模式关闭必须统一处理计时器与未保存笔记");
assert.ok(js.includes("new IntersectionObserver") && js.includes("is-motion-offscreen"), "持续动效必须按区块可见性暂停");
assert.ok(js.includes("function syncDocumentMotion()") && css.includes(".motion-paused *"), "页面进入后台时必须暂停持续动效");
assert.ok(js.includes('".topbar, #banner, #daily, #toolrow, #emptyState'), "顶栏和空态动效也必须进入可见性门控");
assert.ok(css.includes(".modal-overlay:not(.open) *") && css.includes(".study-overlay:not(.open) *"), "关闭的弹窗和研究面板不得继续播放动效");
assert.ok(js.includes('boardEl.addEventListener("pointermove"') && js.includes('boardEl.addEventListener("pointerout"'), "看板视差需要逐卡跟踪和离开复位");
assert.ok(js.includes("cancelAnimationFrame(parallaxFrame)") && js.includes("function resetCardParallax"), "看板视差必须释放待执行帧和内联变换");
assert.ok(!js.includes('boardEl.addEventListener("mousemove"'), "看板视差不得继续使用无法逐卡清理的旧监听");
assert.ok(html.includes('id="themePanel" role="menu" aria-hidden="true" hidden inert'));
assert.ok(html.includes('id="morePanel" role="menu" aria-hidden="true" hidden inert'));
assert.ok(js.includes('panel.inert = !open') && js.includes('panel.hidden = !open'), "弹出菜单必须从隐藏焦点顺序移除");
assert.ok(js.includes("function isEditableTarget(target)"), "全局快捷键必须识别可编辑控件");
assert.ok(js.includes("function activateBrainstormMode(button"));
assert.ok(js.includes('e.key === "ArrowRight"') && js.includes('e.key === "Home"'), "头脑风暴标签页必须支持方向键与首尾键");
assert.ok(js.includes('suggestionPanel.setAttribute("aria-labelledby"'), "共享建议面板必须随当前标签更新可访问名称");
assert.ok(css.includes("align-items: start"), "看板卡片不得被同排展开卡片拉伸");
assert.ok(css.includes("--status-ok-text: #166534"), "浅色状态文字必须使用满足对比度的语义色");

const trustStart = js.indexOf("const TRUST_STATE_META");
const trustEnd = js.indexOf("const CATS", trustStart);
assert.ok(trustStart >= 0 && trustEnd > trustStart, "缺少可信恢复 UI 纯逻辑块");
const trustBox = { crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" }, Uint8Array, Math };
vm.runInNewContext(js.slice(trustStart, trustEnd) + `
  this.api = { TRUST_STATE_META, normalizeTrustedState, newRequestId, trustedMutationBody,
    selectedRecoveryCandidate, recoveryConfirmation, trustedStateAnnouncement };
`, trustBox, { filename: path.join(root, "board.js") });
const trustUi = trustBox.api;
const trustedStates = ["healthy", "action_required", "locked", "ambiguous", "upgrade_required", "in_progress", "verified", "failed"];
assert.deepStrictEqual(Object.keys(trustUi.TRUST_STATE_META), trustedStates);
for (const value of trustedStates) {
  const normalized = trustUi.normalizeTrustedState({ state: value });
  assert.strictEqual(normalized.state, value);
  assert.ok(normalized.condition.label);
}
assert.strictEqual(trustUi.normalizeTrustedState(null).state, "failed");
assert.strictEqual(trustUi.normalizeTrustedState({ state: "forged", transactions: {}, confirmations: {} }).state, "failed");
assert.strictEqual(trustUi.newRequestId(), "11111111-1111-4111-8111-111111111111");
assert.deepStrictEqual(JSON.parse(trustUi.trustedMutationBody({ id: "1.1" })), { requestId: "11111111-1111-4111-8111-111111111111", id: "1.1" });
assert.deepStrictEqual(JSON.parse(trustUi.trustedMutationBody(null, "22222222-2222-4222-8222-222222222222")), { requestId: "22222222-2222-4222-8222-222222222222" });
trustBox.crypto.randomUUID = null;
trustBox.crypto.getRandomValues = bytes => bytes.fill(1);
assert.match(trustUi.newRequestId(), /^01010101-0101-4101-8101-010101010101$/);
const fallbackBox = { crypto: null, Uint8Array, Math: Object.assign(Object.create(Math), { random: () => 0.5 }) };
vm.runInNewContext(js.slice(trustStart, trustEnd) + "\nthis.makeId = newRequestId;", fallbackBox, { filename: path.join(root, "board.js") });
assert.match(fallbackBox.makeId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const recoveryFixture = {
  state: "ambiguous",
  selection: "ambiguous",
  transactions: [{ transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", candidates: [{ name: "verified-old", fingerprint: "f" }] }],
  confirmations: [{ action: "restore-old", targetKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:verified-old", token: "token" }],
};
const selectedCandidate = trustUi.selectedRecoveryCandidate(recoveryFixture, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:verified-old");
assert.strictEqual(selectedCandidate.candidateName, "verified-old");
assert.strictEqual(trustUi.selectedRecoveryCandidate(recoveryFixture, "missing"), null);
assert.strictEqual(trustUi.selectedRecoveryCandidate(recoveryFixture, null), null);
assert.strictEqual(trustUi.selectedRecoveryCandidate({ state: "healthy", transactions: [{ transactionId: "x" }] }, "x:missing"), null);
assert.strictEqual(trustUi.recoveryConfirmation(recoveryFixture, "restore-old", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:verified-old").token, "token");
assert.strictEqual(trustUi.recoveryConfirmation(recoveryFixture, "restore-old", "missing"), null);
const populated = trustUi.normalizeTrustedState({ state: "healthy", selection: "selected", activeRecoveryImport: { state: "prepared" }, allowedActions: ["retry"], confirmations: [], maintenance: { mode: "waiting" }, verifiedAt: "2030-01-01T00:00:00.000Z" });
assert.strictEqual(populated.selection, "selected");
assert.strictEqual(populated.activeRecoveryImport.state, "prepared");
assert.strictEqual(populated.allowedActions[0], "retry");
assert.strictEqual(populated.maintenance.mode, "waiting");
assert.ok(trustUi.trustedStateAnnouncement({ state: "ambiguous" }).includes("必须先选择"));
assert.ok(trustUi.trustedStateAnnouncement({ state: "in_progress" }).includes("写后验证"));
assert.strictEqual(trustUi.trustedStateAnnouncement({ state: "healthy" }), "数据健康");
assert.ok(html.includes('id="trustRail"') && html.includes('id="recoveryModal"'));
assert.ok(html.includes('id="recoveryError" role="alert" aria-live="assertive" tabindex="-1"'));
assert.ok(html.includes('id="recoveryConfirmBtn" disabled'));
assert.ok(js.includes('localApiFetch("/api/recovery/preview"'));
assert.ok(js.includes('localApiFetch("/api/recovery/restore-old"'));
assert.ok(js.includes('localApiFetch("/api/backup/preview"'));
assert.ok(js.includes('localApiFetch("/api/recovery/import/prepare"'));
assert.ok(!js.includes('localApiFetch("/api/backup/import"'), "界面不得绕过可信恢复事务直接导入");
assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
assert.ok(css.includes('.trust-rail') && css.includes('.recovery-modal'));
console.log("ui: ALL PASS");
