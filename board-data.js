async function openTrash() {
  if (!requireService("查看回收站")) return;
  const modal = document.getElementById("trashModal");
  const list = document.getElementById("trashList");
  modal.classList.add("open");
  list.innerHTML = '<div class="trash-empty">加载中…</div>';
  try {
    const response = await localApiFetch("/api/trash", { cache: "no-store" });
    const data = await readJsonResponse(response);
    if (!data.ok) throw new Error(data.error || "加载失败");
    if (!data.entries.length) {
      list.innerHTML = '<div class="trash-empty">回收站是空的</div>';
      return;
    }
    list.innerHTML = data.entries.map(item => `
      <div class="trash-item">
        <div><strong>${escapeHtml(item.title || "未命名条目")}</strong><small>${escapeHtml(item.id || "")} · ${escapeHtml(item.category || "其他")} · ${escapeHtml(archiveTimeLabel(item.archivedAt))}</small></div>
        <button class="btn trash-restore" data-record="${escapeAttr(item.record)}">恢复</button>
      </div>`).join("");
  } catch (error) {
    list.innerHTML = '<div class="trash-empty">加载失败：' + escapeHtml(error.message) + "</div>";
  }
}
document.getElementById("trashBtn").addEventListener("click", openTrash);
document.getElementById("trashModal").addEventListener("click", async e => {
  if (e.target === e.currentTarget) { e.currentTarget.classList.remove("open"); return; }
  const button = e.target.closest(".trash-restore");
  if (!button) return;
  const row = button.closest(".trash-item");
  setButtonBusy(button, true, "恢复中…");
  try {
    const response = await localApiFetch("/api/trash/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record: button.dataset.record }),
    });
    const data = await readJsonResponse(response);
    if (!data.ok) throw new Error(data.error || "恢复失败");
    row?.remove();
    if (!document.querySelector("#trashList .trash-item")) {
      document.getElementById("trashList").innerHTML = '<div class="trash-empty">回收站是空的</div>';
    }
    await httpLoad();
    toast(`已恢复条目 ${data.restored.id}`, "ok");
  } catch (error) {
    toast("恢复失败：" + error.message, "err");
    setButtonBusy(button, false);
  }
});

async function openDataManager() {
  if (!requireService("查看数据管理")) return;
  const modal = document.getElementById("dataModal");
  const diagnostics = document.getElementById("diagnostics");
  modal.classList.add("open");
  diagnostics.textContent = "正在读取诊断信息…";
  try {
    const response = await localApiFetch("/api/diagnostics", { cache: "no-store" });
    const data = await readJsonResponse(response);
    if (!data.ok) throw new Error(data.error || "读取失败");
    const health = data.health || { status: "unknown", issues: [] };
    const healthLabel = { ok: "正常", warning: "需关注", error: "异常", unknown: "未知" }[health.status] || health.status;
    const healthIssues = (health.issues || []).map(issue => `  - ${issue.message}：${issue.count}`).join("\n");
    diagnostics.textContent = [
      `应用版本：${data.appVersion}`,
      `数据格式：v${data.dataVersion}`,
      `数据健康：${healthLabel}`,
      healthIssues,
      `条目数量：${data.entries}`,
      `文件备份：${data.backups}`,
      `最近备份：${data.latestBackupAt ? new Date(data.latestBackupAt).toLocaleString() : "暂无"}`,
      `数据文件：${data.writable ? "可读写" : "不可写"}`,
      `回收站：${data.trash}`,
      `已保存头脑风暴：${data.brainstormReports || 0}`,
      `运行环境：${data.node} / ${data.platform}`,
      `企业微信：${data.integrations.wecom ? "已启用" : "未启用"}`,
      `钉钉：${data.integrations.dingtalk ? "已启用" : "未启用"}`,
    ].filter(Boolean).join("\n");
  } catch (error) { diagnostics.textContent = "诊断信息读取失败：" + error.message; }
}
document.getElementById("dataBtn").addEventListener("click", openDataManager);
document.getElementById("dataModal").addEventListener("click", e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
});
document.getElementById("exportBackupBtn").addEventListener("click", async () => {
  const button = document.getElementById("exportBackupBtn");
  setButtonBusy(button, true, "导出中…");
  try {
    const response = await localApiFetch("/api/backup", { cache: "no-store" });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "导出失败");
    }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "linggan-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast("完整备份已导出", "ok");
  } catch (error) { toast("导出失败：" + error.message, "err"); }
  finally { setButtonBusy(button, false); }
});
document.getElementById("exportDiagnosticsBtn").addEventListener("click", async () => {
  const button = document.getElementById("exportDiagnosticsBtn");
  setButtonBusy(button, true, "导出中…");
  try {
    const response = await localApiFetch("/api/diagnostics", { cache: "no-store" });
    const data = await readJsonResponse(response);
    if (!data.ok) throw new Error(data.error || "读取失败");
    data.generatedAt = new Date().toISOString();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "linggan-diagnostics-" + new Date().toISOString().slice(0, 10) + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast("匿名诊断信息已导出", "ok");
  } catch (error) { toast("诊断导出失败：" + error.message, "err"); }
  finally { setButtonBusy(button, false); }
});
document.getElementById("importBackupBtn").addEventListener("click", () => {
  document.getElementById("backupFileInput").click();
});
document.getElementById("importBookmarksBtn").addEventListener("click", () => {
  document.getElementById("bookmarkFileInput").click();
});
document.getElementById("bookmarkFileInput").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast("书签 HTML 超过 5MB", "err"); e.target.value = ""; return; }
  const button = document.getElementById("importBookmarksBtn");
  setButtonBusy(button, true, "预检中…");
  try {
    const content = await file.text();
    const previewResponse = await localApiFetch("/api/bookmarks/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const previewData = await previewResponse.json();
    if (!previewData.ok) throw new Error(previewData.error || "预检失败");
    const preview = previewData.preview;
    if (!preview.importable) {
      toast(`没有可导入的新书签（已存在 ${preview.duplicates} 个）`, "ok");
      return;
    }
    const sampleLines = (preview.samples || []).slice(0, 3).map(item =>
      "• " + item.name + (item.folder ? `（${item.folder}）` : ""));
    const summary = [
      `发现有效书签：${preview.found} 个`,
      `可导入：${preview.importable} 个`,
      `看板中已存在：${preview.duplicates} 个`,
      `文件内重复/无效：${preview.repeated + preview.invalid} 个`,
      preview.truncated ? "注意：文件超过 1000 个唯一书签，本次只处理前 1000 个。" : "",
      sampleLines.length ? "\n示例：\n" + sampleLines.join("\n") : "",
      "\n确认一次性导入到“收件箱”？",
    ].filter(Boolean).join("\n");
    if (!confirm(summary)) return;
    const importResponse = await localApiFetch("/api/bookmarks/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const imported = await importResponse.json();
    if (!imported.ok) throw new Error(imported.error || "导入失败");
    await httpLoad();
    toast(`已导入 ${imported.imported} 个书签到收件箱`, "ok");
    await openDataManager();
  } catch (error) {
    toast("书签导入失败：" + error.message, "err");
  } finally {
    setButtonBusy(button, false);
    e.target.value = "";
  }
});
function previewBackup(bundle) {
  if (!bundle || bundle.format !== "linggan-backup" || ![1, 2].includes(bundle.version)) {
    throw new Error("不是受支持的灵感来袭备份包");
  }
  return {
    createdAt: bundle.createdAt && !Number.isNaN(new Date(bundle.createdAt).getTime()) ? new Date(bundle.createdAt).toLocaleString() : "未知",
    entryCount: bundle.version === 1 ? (String(bundle.data || "").match(/^###\s+[⏳🔄✅]\s*\d+\.\d+\s+/gmu) || []).length : null,
    archiveCount: bundle.version === 1 && Array.isArray(bundle.entries) ? bundle.entries.length : null,
    formatVersion: bundle.version,
  };
}
document.getElementById("backupFileInput").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (file.size > 80 * 1024 * 1024) { toast("备份文件超过 80MB", "err"); e.target.value = ""; return; }
  let bundle;
  let clientPreview;
  try {
    bundle = JSON.parse(await file.text());
    clientPreview = previewBackup(bundle);
  } catch (error) {
    toast("备份预检失败：" + error.message, "err");
    e.target.value = "";
    return;
  }
  const button = document.getElementById("importBackupBtn");
  setButtonBusy(button, true, "预检中…");
  try {
    const previewResponse = await localApiFetch("/api/backup/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle }),
    });
    const previewData = await readJsonResponse(previewResponse);
    const preview = previewData.summary;
    const summary = [
      "即将恢复完整备份：",
      `备份时间：${clientPreview.createdAt}`,
      `备份格式：v${preview.formatVersion}`,
      `看板条目：${preview.entryCount} 个`,
      `文件数量：${preview.fileCount} 个`,
      `总字节数：${preview.totalBytes}`,
      "",
      "当前仅完成只读预检，尚未修改磁盘。继续后会暂存完整候选，再要求一次状态绑定确认。",
    ].join("\n");
    if (!confirm(summary)) return;
    const prepareResponse = await localApiFetch("/api/recovery/import/prepare", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: trustedMutationBody({ bundle }),
    });
    const prepared = await readJsonResponse(prepareResponse);
    const statusResponse = await localApiFetch("/api/recovery/status", { cache: "no-store" });
    const recoveryState = normalizeTrustedState(await readJsonResponse(statusResponse));
    const confirmation = recoveryConfirmation(recoveryState, "recovery/import", prepared.recoveryPrepareId);
    if (!confirmation) throw new Error("未取得当前暂存状态的确认令牌，请重新检查恢复状态");
    if (!confirm("暂存候选已校验完成。确认替换当前数据并保留可恢复旧态？")) {
      await loadTrustedState();
      toast("已取消确认；暂存事务不会自动覆盖当前数据", "ok");
      return;
    }
    const commitResponse = await localApiFetch("/api/recovery/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: trustedMutationBody({ recoveryPrepareId: prepared.recoveryPrepareId, confirmationToken: confirmation.token }),
    });
    const data = await readJsonResponse(commitResponse);
    if (!data.verified || data.receipt !== "committed") throw new Error("恢复未返回写后验证收据");
    await httpLoad();
    toast(`已从完整备份恢复 ${preview.entryCount} 个条目并完成验证`, "ok");
    await openDataManager();
  } catch (error) { toast("恢复失败：" + error.message, "err"); }
  finally { setButtonBusy(button, false); e.target.value = ""; }
});
