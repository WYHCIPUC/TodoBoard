/* - 沉浸研究模式 - */
let studyItem = null;
let studySavedNote = "";
let timerLeft = 25 * 60;
let timerTotal = 25 * 60;
let timerRunning = false;
let timerInt = null;
function fmtT(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
function timerPaint() {
  document.getElementById("timerNow").textContent = fmtT(timerLeft);
  const pct = Math.round((1 - timerLeft / timerTotal) * 100);
  document.getElementById("timerPct").textContent = pct + "%";
  document.getElementById("timerRing").style.background = `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--border) ${pct * 3.6}deg)`;
}
function openStudy(item) {
  if (!state.httpMode && !state.demoMode) { toast("请先启动服务", "err"); return; }
  studyItem = item;
  document.getElementById("studyTitle").textContent = item.name;
  const color = catColor(item.category);
  const meta = document.getElementById("studyMeta");
  meta.innerHTML = `<span class="badge cat ${catCls(item.category)}">${escapeHtml(item.category)}</span><span class="badge diff">${"★".repeat(item.difficulty || 1)}</span><span class="status ${statusCls(item)}">${statusLabel(item)}</span>`;
  const cover = document.querySelector(".study .s-cover");
  cover.classList.remove(...CATS.map(c => c.cls));
  cover.classList.add(catCls(item.category));
  cover.style.setProperty("--cat", color);
  if (item.image) {
    document.getElementById("studyImg").src = item.image;
    document.getElementById("studyImg").hidden = false;
    document.getElementById("studyPh").textContent = "";
  } else {
    document.getElementById("studyImg").hidden = true;
    document.getElementById("studyPh").textContent = item.name.slice(0, 1);
  }
  // 研究要点预填
  const nf = item.fields.find(f => f.k.includes("研究要点"));
  studySavedNote = nf ? nf.v.replace(/^（待补充）$/, "") : "";
  document.getElementById("studyNote").value = studySavedNote;
  renderStudyLifecycle(item);
  document.getElementById("studyExitGuard").hidden = true;
  // 状态按钮
  const stBtn = document.getElementById("studyStatus");
  stBtn.textContent = item.status === "pending" ? "标记为进行中" : item.status === "doing" ? "标记为已完成" : "重置为待研究";
  // 计时器重置
  stopTimer();
  timerLeft = timerTotal = 25 * 60;
  document.getElementById("timerToggle").textContent = "开始";
  timerPaint();
  document.getElementById("studyOverlay").classList.add("open");
}
function stopTimer() {
  timerRunning = false;
  clearInterval(timerInt);
  timerInt = null;
  document.getElementById("timerToggle").textContent = "开始";
}
function finishCloseStudy() {
  stopTimer();
  document.getElementById("studyExitGuard").hidden = true;
  document.getElementById("studyOverlay").classList.remove("open");
  studyItem = null;
  return true;
}
function closeStudy(force = false) {
  const note = document.getElementById("studyNote").value.trim();
  if (!force && note !== studySavedNote.trim()) {
    stopTimer();
    const guard = document.getElementById("studyExitGuard");
    guard.hidden = false;
    requestAnimationFrame(() => document.getElementById("studySaveExit").focus({ preventScroll: true }));
    return false;
  }
  return finishCloseStudy();
}
document.getElementById("studyBack").addEventListener("click", () => closeStudy());
document.getElementById("studyOverlay").addEventListener("click", e => { if (e.target === e.currentTarget) closeStudy(); });
document.getElementById("studyOpen").addEventListener("click", () => { if (studyItem && studyItem.url) window.open(studyItem.url, "_blank"); });
document.getElementById("studyStatus").addEventListener("click", async () => {
  if (!studyItem) return;
  const button = document.getElementById("studyStatus");
  const next = studyItem.status === "pending" ? "doing" : studyItem.status === "doing" ? "done" : "pending";
  setButtonBusy(button, true, "更新中…");
  try {
    const updated = await updateItemStatus(studyItem, next);
    if (updated) {
      renderStudyLifecycle(studyItem);
      setButtonBusy(button, false);
      button.textContent = studyItem.status === "pending" ? "标记为进行中" : studyItem.status === "doing" ? "标记为已完成" : "重置为待研究";
      return;
    }
  } finally {
    setButtonBusy(button, false);
  }
});
async function updateStudyLifecycle(action, nextReviewAt, button) {
  if (!studyItem) return false;
  if (!requireService("更新回顾计划")) return false;
  setButtonBusy(button, true, "更新中…");
  try {
    const data = await postLifecycle(studyItem.id, action, nextReviewAt);
    const updated = applyLifecycleResult(studyItem.id, data) || studyItem;
    studyItem = updated;
    renderStudyLifecycle(updated);
    await loadAttention();
    toast("回顾计划已更新", "ok");
    return true;
  } catch (error) {
    toast("回顾计划更新失败：" + error.message, "err");
    return false;
  } finally {
    setButtonBusy(button, false);
  }
}

document.getElementById("studyReviewSet").addEventListener("click", async event => {
  const value = document.getElementById("studyReviewDate").value;
  const nextReviewAt = reviewTargetIso(value);
  if (!nextReviewAt) { toast("请选择今天之后的日期", "err"); return; }
  await updateStudyLifecycle("set_review", nextReviewAt, event.currentTarget);
});
document.getElementById("studyReviewDone").addEventListener("click", async event => {
  await updateStudyLifecycle("mark_reviewed", undefined, event.currentTarget);
});
document.getElementById("studyReviewClear").addEventListener("click", async event => {
  await updateStudyLifecycle("clear_review", undefined, event.currentTarget);
});

document.getElementById("timerToggle").addEventListener("click", () => {
  if (timerRunning) { stopTimer(); return; }
  if (timerLeft <= 0) { timerLeft = timerTotal; }
  timerRunning = true;
  document.getElementById("timerToggle").textContent = "暂停";
  timerInt = setInterval(() => {
    timerLeft--;
    timerPaint();
    if (timerLeft <= 0) {
      stopTimer();
      toast("计时完成，休息一下", "ok");
      particleBurst();
    }
  }, 1000);
});
document.getElementById("timerReset").addEventListener("click", () => {
  stopTimer();
  timerLeft = timerTotal = 25 * 60;
  timerPaint();
});
async function saveStudyNote(closeAfter = false) {
  if (!studyItem) return;
  if (!requireService("保存研究笔记")) return;
  const note = document.getElementById("studyNote").value.trim();
  const saveButton = closeAfter ? document.getElementById("studySaveExit") : document.getElementById("studySave");
  setButtonBusy(saveButton, true, closeAfter ? "保存并退出中…" : "保存中…");
  try {
    const r = await localApiFetch("/api/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: studyItem.id, note: note || "（待补充）" }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "保存失败");
    studySavedNote = note;
    await httpLoad();
    toast("笔记已写回 DATA.md", "ok");
    if (closeAfter) finishCloseStudy();
  } catch (e) {
    toast("保存失败：" + e.message, "err");
  } finally {
    setButtonBusy(saveButton, false);
  }
}
document.getElementById("studySave").addEventListener("click", () => saveStudyNote(false));
document.getElementById("studySaveExit").addEventListener("click", () => saveStudyNote(true));
document.getElementById("studyDiscardExit").addEventListener("click", () => closeStudy(true));
document.getElementById("studyContinue").addEventListener("click", () => {
  document.getElementById("studyExitGuard").hidden = true;
  document.getElementById("studyNote").focus({ preventScroll: true });
});
