/* - 快捷指令：把高频入口统一到可搜索、可键盘操作的本地面板。 - */
const COMMANDS = [
  { id: "capture", glyph: "+", title: "收藏内容", hint: "粘贴链接，自动解析并留存", keywords: "新增 收藏 内容 链接 capture", shortcut: "N", run: () => document.getElementById("addBtn").click() },
  { id: "search", glyph: "⌕", title: "搜索项目", hint: "定位标题、简介和归档正文", keywords: "搜索 查找 search", shortcut: "/", run: () => document.getElementById("searchInput").focus() },
  { id: "inspiration", glyph: "01", title: "进入灵感来袭", hint: "返回收集与研究工作台", keywords: "首页 灵感 列表", run: () => setProductView("inspiration") },
  { id: "relationship", glyph: "02", title: "进入关系画布", hint: "整理来源、判断与验证路径", keywords: "关系 画布 图谱 溯源", shortcut: "G", run: openRelationship },
  { id: "brainstorm", glyph: "03", title: "进入头脑风暴", hint: "关联现有项目并形成方案", keywords: "头脑风暴 关联 决策", shortcut: "B", run: openBrainstorm },
  { id: "list", glyph: "≡", title: "切换为列表", hint: "高密度浏览与批量处理", keywords: "列表 list 视图", run: () => document.querySelector('[data-view="list"]').click() },
  { id: "board", glyph: "▦", title: "切换为看板", hint: "卡片化浏览项目", keywords: "看板 卡片 board 视图", run: () => document.querySelector('[data-view="board"]').click() },
  { id: "random", glyph: "↝", title: "随机抽取研究", hint: "从待研究项目中选择下一项", keywords: "随机 推荐 下一步", shortcut: "R", run: () => document.getElementById("rollBtn").click() },
  { id: "stats", glyph: "%", title: "查看统计洞察", hint: "检查分类、难度和推进状态", keywords: "统计 数据 洞察", shortcut: "S", run: openStats },
  { id: "recovery", glyph: "R", title: "查看数据保护状态", hint: "核对写入、恢复和升级结果", keywords: "恢复 数据健康 保护 备份", run: () => document.getElementById("trustCenterBtn").click() },
  { id: "data", glyph: "D", title: "打开数据管理", hint: "备份、恢复、导入和诊断", keywords: "数据 备份 导入 诊断", run: () => document.getElementById("dataBtn").click() },
  { id: "trash", glyph: "⌫", title: "打开回收站", hint: "恢复误删的条目和档案", keywords: "回收站 删除 恢复", run: () => document.getElementById("trashBtn").click() },
  { id: "theme", glyph: "◐", title: "选择界面主题", hint: "切换暖白、暗色、极光或森林", keywords: "主题 外观 深色 theme", run: () => document.getElementById("themeBtn").click() },
  { id: "keys", glyph: "?", title: "查看键盘快捷键", hint: "了解完整的无鼠标操作", keywords: "帮助 快捷键 keyboard", shortcut: "?", run: () => document.getElementById("hotkeyModal").classList.add("open") },
];
let commandMatches = COMMANDS;
let commandActiveIndex = 0;
function commandQuery(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN");
}
function renderCommandPalette(reset = false) {
  const input = document.getElementById("commandInput");
  const list = document.getElementById("commandList");
  const query = commandQuery(input.value);
  commandMatches = COMMANDS.filter(command => commandQuery(`${command.title} ${command.hint} ${command.keywords}`).includes(query));
  if (reset) commandActiveIndex = 0;
  commandActiveIndex = Math.max(0, Math.min(commandActiveIndex, Math.max(0, commandMatches.length - 1)));
  if (!commandMatches.length) {
    list.innerHTML = '<div class="command-empty">没有匹配操作。试试“新增”“数据”或“看板”。</div>';
    input.removeAttribute("aria-activedescendant");
    return;
  }
  list.innerHTML = commandMatches.map((command, index) => `<button type="button" id="command-option-${command.id}" class="command-option${index === commandActiveIndex ? " active" : ""}" role="option" aria-selected="${index === commandActiveIndex}" data-command="${command.id}">
    <span class="command-glyph" aria-hidden="true">${escapeHtml(command.glyph)}</span><span class="command-copy"><strong>${escapeHtml(command.title)}</strong><small>${escapeHtml(command.hint)}</small></span>${command.shortcut ? `<kbd>${escapeHtml(command.shortcut)}</kbd>` : ""}
  </button>`).join("");
  input.setAttribute("aria-activedescendant", `command-option-${commandMatches[commandActiveIndex].id}`);
}
function setCommandActive(index) {
  if (!commandMatches.length) return;
  commandActiveIndex = (index + commandMatches.length) % commandMatches.length;
  renderCommandPalette();
  document.getElementById(`command-option-${commandMatches[commandActiveIndex].id}`)?.scrollIntoView({ block: "nearest" });
}
function closeCommandPalette() {
  document.getElementById("commandModal").classList.remove("open");
  document.getElementById("commandInput").setAttribute("aria-expanded", "false");
}
function openCommandPalette() {
  const modal = document.getElementById("commandModal");
  const otherDialog = document.querySelector(".modal-overlay.open, .study-overlay.open");
  if (otherDialog && otherDialog !== modal) return;
  closeHeaderMenus(true);
  document.getElementById("commandInput").value = "";
  document.getElementById("commandInput").setAttribute("aria-expanded", "true");
  renderCommandPalette(true);
  modal.classList.add("open");
  requestAnimationFrame(() => document.getElementById("commandInput").focus({ preventScroll: true }));
}
function runCommand(id) {
  const command = COMMANDS.find(item => item.id === id);
  if (!command) return;
  dialogFocusState.opener = null;
  closeCommandPalette();
  requestAnimationFrame(() => command.run());
}
document.getElementById("commandBtn").addEventListener("click", openCommandPalette);
document.getElementById("commandInput").addEventListener("input", () => renderCommandPalette(true));
document.getElementById("commandInput").addEventListener("keydown", e => {
  if (e.key === "ArrowDown") { e.preventDefault(); setCommandActive(commandActiveIndex + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setCommandActive(commandActiveIndex - 1); }
  else if (e.key === "Enter" && commandMatches.length) { e.preventDefault(); runCommand(commandMatches[commandActiveIndex].id); }
  else if (e.key === "Escape") { e.preventDefault(); closeCommandPalette(); }
});
document.getElementById("commandList").addEventListener("mousemove", e => {
  const option = e.target.closest("[data-command]");
  if (!option) return;
  const index = commandMatches.findIndex(command => command.id === option.dataset.command);
  if (index >= 0 && index !== commandActiveIndex) setCommandActive(index);
});
document.getElementById("commandList").addEventListener("click", e => {
  const option = e.target.closest("[data-command]");
  if (option) runCommand(option.dataset.command);
});
document.getElementById("commandModal").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeCommandPalette();
});

/* - 快捷键 - */
function kbdRow() {
  const rows = [...document.querySelectorAll("#listView .row")];
  return rows.find(r => r.classList.contains("kbd")) || rows[0] || null;
}
function kbdMove(dir) {
  const rows = [...document.querySelectorAll("#listView .row")];
  if (!rows.length) return;
  let idx = rows.findIndex(r => r.classList.contains("kbd"));
  idx = idx < 0 ? (dir > 0 ? -1 : 0) : idx + dir;
  idx = Math.max(0, Math.min(rows.length - 1, idx));
  rows.forEach(r => r.classList.remove("kbd"));
  rows[idx].classList.add("kbd");
  rows[idx].focus({ preventScroll: true });
  rows[idx].scrollIntoView({ block: "nearest" });
}
function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"]'));
}
document.addEventListener("keydown", e => {
  const openDialog = document.querySelector(".modal-overlay.open, .study-overlay.open");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (openDialog && openDialog.id === "commandModal") closeCommandPalette();
    else if (!openDialog) openCommandPalette();
    return;
  }
  if (isEditableTarget(e.target)) return;
  // ? 键打开快捷键面板（不区分大小写 + shift）
  if ((e.key === "?" || (e.shiftKey && e.key === "/")) && (!openDialog || openDialog.id === "hotkeyModal")) {
    e.preventDefault();
    document.getElementById("hotkeyModal").classList.toggle("open");
    return;
  }
  if (openDialog) return;
  const k = e.key.toLowerCase();
  if (k === "n") { document.getElementById("addBtn").click(); return; }
  if (!state.items.length) return;
  if (e.key === "Enter" || e.key === " ") {
    const row = e.target.closest && e.target.closest(".row");
    if (row) {
      e.preventDefault();
      toggleRow(row);
      return;
    }
  }
  if (k === "j") { e.preventDefault(); kbdMove(1); }
  else if (k === "k") { e.preventDefault(); kbdMove(-1); }
  else if (k === "r") { document.getElementById("rollBtn").click(); }
  else if (k === "e") {
    const row = kbdRow();
    if (row) {
      const item = state.items.find(i => i.id === row.dataset.id);
      if (item) openStudy(item);
    }
  } else if (k === "s") { openStats(); }
  else if (k === "g") { openRelationship(); }
  else if (k === "b") { openBrainstorm(); }
  else if (k === "/") { e.preventDefault(); document.getElementById("searchInput").focus(); }
  else if (e.key === "Enter") {
    const row = kbdRow();
    if (row) row.click();
  }
});
document.getElementById("hotkeyModal").addEventListener("click", e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
});
