/* ============================================================
 * 研究档案详情视图（entry detail view）
 * 后端 API：
 *   GET  /api/entry?id=1.1
 *   POST /api/entry/notes              {id, ...fields}
 *   POST /api/entry/screenshot?id=1.1  multipart(file+caption)
 *   POST /api/entry/screenshot/delete  {id, file}
 *   GET  /api/entry/screenshot/file?id=1.1&file=xxx.png
 * ============================================================ */
let currentEntryId = null;
let entryLoadSequence = 0;
let entryLoadController = null;
let entryReturnState = null;
const ENTRY_TEMPLATE_LABELS = {
  general: ["为什么收藏", "关键发现", "行动项", "结论"],
  article: ["阅读目的", "重要观点", "后续验证", "我的结论"],
  video: ["学习目标", "时间点 / 知识点", "实践任务", "学习结论"],
  project: ["调研目的", "用途与技术栈", "风险与下一步", "采用结论"],
  software: ["评测目的", "关键体验", "改进 / 使用计划", "是否采用"],
};

function applyEntryTemplate(value) {
  const template = ENTRY_TEMPLATE_LABELS[value] ? value : "general";
  const labels = ENTRY_TEMPLATE_LABELS[template];
  document.getElementById("whySavedLabel").textContent = labels[0];
  document.getElementById("keyFindingsLabel").textContent = labels[1];
  document.getElementById("actionItemsLabel").textContent = labels[2];
  document.getElementById("conclusionLabel").textContent = labels[3];
  document.querySelectorAll(".template-software").forEach(el => {
    el.hidden = template !== "software";
  });
}

/* 属性安全的 HTML 转义；与文本转义保持一致，单独命名便于审查属性插值。 */
function escapeAttr(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function isCurrentEntryLoad(sequence, id) {
  return sequence === entryLoadSequence && currentEntryId === String(id);
}

function resetEntryView(id) {
  const form = document.getElementById("entryForm");
  form.reset();
  applyEntryTemplate("general");
  document.getElementById("entryTitle").textContent = "正在加载研究档案…";
  document.getElementById("entryId").textContent = "#" + id;
  document.getElementById("entryArchive").innerHTML = '<div class="archive-panel archive-queued">正在读取本地归档状态…</div>';
  document.getElementById("ssGrid").innerHTML = '<div class="ss-empty">正在加载截图…</div>';
  document.getElementById("contentPreview").hidden = true;
  document.getElementById("contentPreview").textContent = "";
  document.getElementById("scrapeHint").textContent = "从条目链接抓取并刷新本地正文备份";
}

function openEntry(id, options = {}) {
  if (state.demoMode) {
    const item = state.items.find(entry => entry.id === String(id));
    if (item) openStudy(item);
    return;
  }
  if (!requireService("打开研究档案")) return;
  const requestedId = String(id);
  const returnProductView = ["relationship", "brainstorm"].includes(options.returnView) ? options.returnView : "inspiration";
  entryReturnState = {
    productView: returnProductView,
    scrollY: window.scrollY,
    opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
  };
  if (returnProductView !== "inspiration") setProductView("inspiration", { load: false, instant: true });
  currentEntryId = requestedId;
  document.body.classList.add("entry-active");
  entryLoadSequence += 1;
  const sequence = entryLoadSequence;
  if (entryLoadController) entryLoadController.abort();
  entryLoadController = new AbortController();
  // 隐藏看板视图与列表视图，显示详情视图
  document.getElementById("listView").hidden = true;
  document.getElementById("boardView").hidden = true;
  document.getElementById("entryView").hidden = false;
  // 隐藏看板周边工具栏 / 横幅 / 统计条，制造全屏覆盖感
  const tr = document.getElementById("toolrow"); if (tr) tr.hidden = true;
  const sb = document.getElementById("statsbar"); if (sb) sb.hidden = true;
  const bn = document.getElementById("banner"); if (bn) bn.hidden = true;
  resetEntryView(requestedId);
  document.getElementById("entryBack").textContent = entryReturnState.productView === "brainstorm"
    ? "← 返回头脑风暴" : entryReturnState.productView === "relationship" ? "← 返回关系画布" : "← 返回看板";
  document.getElementById("entryView").setAttribute("aria-busy", "true");
  window.scrollTo({ top: 0, behavior: "auto" });
  requestAnimationFrame(() => document.getElementById("entryBack").focus({ preventScroll: true }));

  localApiFetch("/api/entry?id=" + encodeURIComponent(requestedId), { signal: entryLoadController.signal })
    .then(r => r.json())
    .then(({ ok, entry, error }) => {
      if (!isCurrentEntryLoad(sequence, requestedId)) return;
      if (!ok) {
        closeEntry();
        toast(error || "研究档案加载失败，请稍后重试", "err");
        return;
      }
      document.getElementById("entryTitle").textContent = entry.title || "";
      document.getElementById("entryId").textContent = "#" + requestedId;
      const f = entry.fields || {};
      const form = document.getElementById("entryForm");
      form.template.value = f.template || "general";
      form.whySaved.value = f.whySaved || "";
      form.keyFindings.value = f.keyFindings || "";
      form.actionItems.value = f.actionItems || "";
      form.conclusion.value = f.conclusion || "";
      applyEntryTemplate(form.template.value);
      form.downloadStatus.value = f.downloadStatus || "未下载";
      form.installerName.value = f.installerName || "";
      form.installStatus.value = f.installStatus || "未安装";
      form.installPath.value = f.installPath || "";
      form.rating.value = String(f.rating || 1);
      form.metExpectation.value = f.metExpectation || "";
      form.experience.value = f.experience || "";
      form.keep.value = f.keep || "否";
      form.recommendLevel.value = String(f.recommendLevel || 1);
      form.keepNote.value = f.keepNote || "";
      const listItem = state.items.find(item => item.id === requestedId);
      if (listItem && entry.archive) listItem.archive = normalizeArchiveStatus(entry.archive);
      renderEntryArchive(entry.archive);
      renderSsGrid(requestedId, entry.screenshots || []);
      loadContentPreview(requestedId, sequence, entryLoadController.signal);
      document.getElementById("entryView").removeAttribute("aria-busy");
    })
    .catch(e => {
      if (e.name === "AbortError" || !isCurrentEntryLoad(sequence, requestedId)) return;
      closeEntry();
      toast("研究档案加载失败：" + e.message, "err");
    });
}

/** 加载已抓取的正文预览 */
function loadContentPreview(id, sequence = entryLoadSequence, signal) {
  localApiFetch("/api/entry/content?id=" + encodeURIComponent(id), signal ? { signal } : {})
    .then(r => r.json())
    .then(({ ok, content, hasContent }) => {
      if (!isCurrentEntryLoad(sequence, id)) return;
      const box = document.getElementById("contentPreview");
      const hint = document.getElementById("scrapeHint");
      if (ok && hasContent && content) {
        box.hidden = false;
        box.textContent = content.slice(0, 2000) + (content.length > 2000 ? "\n\n…（仅预览前2000字符，完整内容见 content.md）" : "");
        if (hint) hint.textContent = "已抓取，点「抓取正文」可刷新";
      } else {
        box.hidden = true;
        if (hint) hint.textContent = "从条目链接抓取正文内容（当前支持 GitHub）";
      }
    })
    .catch(error => {
      if (error.name === "AbortError" || !isCurrentEntryLoad(sequence, id)) return;
      const box = document.getElementById("contentPreview");
      const hint = document.getElementById("scrapeHint");
      if (box) box.hidden = true;
      if (hint) hint.textContent = "本地正文读取失败，可点击“抓取正文”重试";
    });
}

function closeEntry() {
  entryLoadSequence += 1;
  if (entryLoadController) entryLoadController.abort();
  entryLoadController = null;
  document.body.classList.remove("entry-active");
  const returnState = entryReturnState;
  document.getElementById("entryView").hidden = true;
  document.getElementById("entryView").removeAttribute("aria-busy");
  // 按当前视图恢复看板周边状态
  if (state.view === "board") {
    document.getElementById("boardView").hidden = false;
  } else {
    document.getElementById("listView").hidden = false;
  }
  const tr = document.getElementById("toolrow");
  const sb = document.getElementById("statsbar");
  const bn = document.getElementById("banner");
  if (tr) tr.hidden = false;
  if (sb) sb.hidden = true;
  if (bn) bn.hidden = false;
  currentEntryId = null;
  entryReturnState = null;
  if (returnState?.productView === "brainstorm") setProductView("brainstorm", { load: false, instant: true });
  else if (returnState?.productView === "relationship") setProductView("relationship", { load: false, fit: false, instant: true });
  requestAnimationFrame(() => {
    if (returnState) window.scrollTo({ top: returnState.scrollY, behavior: "auto" });
    if (returnState?.opener && returnState.opener.isConnected) returnState.opener.focus({ preventScroll: true });
  });
}

async function refreshEntryScreenshots(id) {
  const requestedId = String(id);
  const sequence = entryLoadSequence;
  const response = await localApiFetch("/api/entry?id=" + encodeURIComponent(requestedId), { cache: "no-store" });
  const data = await readJsonResponse(response);
  if (!data.ok) throw new Error(data.error || "截图列表刷新失败");
  if (!isCurrentEntryLoad(sequence, requestedId)) return false;
  renderSsGrid(requestedId, data.entry?.screenshots || []);
  return true;
}

function renderSsGrid(id, shots) {
  const grid = document.getElementById("ssGrid");
  if (!shots || !shots.length) {
    grid.innerHTML = '<div class="ss-empty">暂无截图，上传后这里展示</div>';
    return;
  }
  grid.innerHTML = shots.map(s => {
    const file = escapeAttr(s.file);
    const cap = escapeAttr(s.caption || "");
    const src = "/api/entry/screenshot/file?id=" + encodeURIComponent(id) +
      "&file=" + encodeURIComponent(s.file);
    return (
      '<div class="ss-item">' +
      '<img src="' + src + '" alt="' + cap + '">' +
      '<div class="ss-cap">' + cap + '</div>' +
      '<button type="button" class="btn ss-del" data-file="' + file + '">删除</button>' +
      '</div>'
    );
  }).join("");
}

// 事件绑定
document.addEventListener("DOMContentLoaded", () => {
  const entryBack = document.getElementById("entryBack");
  const entryCancel = document.getElementById("entryCancel");
  if (entryBack) entryBack.addEventListener("click", closeEntry);
  if (entryCancel) entryCancel.addEventListener("click", closeEntry);
  const entryTemplate = document.getElementById("entryTemplate");
  if (entryTemplate) entryTemplate.addEventListener("change", e => applyEntryTemplate(e.target.value));
  const entryArchive = document.getElementById("entryArchive");
  if (entryArchive) {
    entryArchive.addEventListener("click", handleArchiveControlClick);
    entryArchive.addEventListener("submit", e => {
      const form = e.target.closest("#manualArchiveForm");
      if (!form) return;
      e.preventDefault();
      submitManualContent(form.dataset.id, form.querySelector("textarea"), form.querySelector("button[type=submit]"));
    });
  }

  // 抓取正文
  const scrapeBtn = document.getElementById("scrapeBtn");
  if (scrapeBtn) scrapeBtn.addEventListener("click", () => {
    if (!currentEntryId) return;
    const requestedId = currentEntryId;
    const sequence = entryLoadSequence;
    const hint = document.getElementById("scrapeHint");
    if (hint) hint.textContent = "抓取中…";
    setButtonBusy(scrapeBtn, true, "抓取中…");
    localApiFetch("/api/entry/scrape", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: requestedId })
    }).then(r => r.json()).then(r => {
      setButtonBusy(scrapeBtn, false);
      if (!isCurrentEntryLoad(sequence, requestedId)) return;
      if (r.ok) { toast("正文抓取成功"); loadContentPreview(requestedId, sequence); }
      else { toast("抓取未成功: " + (r.warning || r.error || "未知"), "err"); if (hint) hint.textContent = r.warning || "抓取失败，可稍后重试"; }
    }).catch(e => { setButtonBusy(scrapeBtn, false); toast("网络错误: " + e.message, "err"); });
  });

  // 保存档案
  const form = document.getElementById("entryForm");
  if (form) form.addEventListener("submit", e => {
    e.preventDefault();
    if (!currentEntryId) return;
    const saveButton = e.currentTarget.querySelector('button[type="submit"]');
    const requestedId = currentEntryId;
    const fd = new FormData(e.target);
    const fields = Object.fromEntries(fd);
    fields.rating = Number(fields.rating);
    fields.recommendLevel = Number(fields.recommendLevel);
    setButtonBusy(saveButton, true, "保存中…");
    localApiFetch("/api/entry/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ id: requestedId }, fields))
    }).then(r => r.json()).then(r => {
      if (r.ok) toast("档案已保存");
      else toast("保存失败: " + (r.error || ""), "err");
    }).catch(e => toast("网络错误: " + e.message, "err"))
      .finally(() => setButtonBusy(saveButton, false));
  });

  // 上传截图
  const ssUploadBtn = document.getElementById("ssUploadBtn");
  if (ssUploadBtn) ssUploadBtn.addEventListener("click", () => {
    if (!currentEntryId) return;
    const requestedId = currentEntryId;
    const fileInput = document.getElementById("ssInput");
    if (!fileInput.files.length) { toast("请先选择图片", "err"); return; }
    const fd = new FormData();
    fd.append("file", fileInput.files[0]);
    fd.append("caption", document.getElementById("ssCaption").value);
    toast("上传中...");
    setButtonBusy(ssUploadBtn, true, "上传中…");
    localApiFetch("/api/entry/screenshot?id=" + encodeURIComponent(requestedId), {
      method: "POST", body: fd
    }).then(r => r.json()).then(async r => {
      if (r.ok) {
        toast("截图已上传");
        fileInput.value = "";
        document.getElementById("ssCaption").value = "";
        await refreshEntryScreenshots(requestedId);
      } else {
        toast("上传失败: " + (r.error || ""), "err");
      }
    }).catch(e => toast("网络错误: " + e.message, "err"))
      .finally(() => setButtonBusy(ssUploadBtn, false));
  });

  // 删除截图（事件委托）
  const ssGrid = document.getElementById("ssGrid");
  if (ssGrid) ssGrid.addEventListener("click", e => {
    const btn = e.target.closest(".ss-del");
    if (!btn || !currentEntryId) return;
    if (!confirm("删除这张截图?")) return;
    const requestedId = currentEntryId;
    setButtonBusy(btn, true, "删除中…");
    localApiFetch("/api/entry/screenshot/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: requestedId, file: btn.dataset.file })
    }).then(r => r.json()).then(async r => {
      if (r.ok) { toast("已删除"); await refreshEntryScreenshots(requestedId); }
      else { setButtonBusy(btn, false); toast("删除失败: " + (r.error || ""), "err"); }
    }).catch(e => { setButtonBusy(btn, false); toast("网络错误: " + e.message, "err"); });
  });
});
