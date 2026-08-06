"use strict";

/* ============================================================
 * 分类体系（8 类）+ 状态
 * ============================================================ */
const CATS = [
  { name: "AI 工具", cls: "c-ai" },
  { name: "硬件 & 嵌入式", cls: "c-hw" },
  { name: "前端 & 设计", cls: "c-fe" },
  { name: "桌面 & 系统", cls: "c-ds" },
  { name: "开源项目 & 开发", cls: "c-os" },
  { name: "搜索 & OSINT", cls: "c-oc" },
  { name: "教程 & 资源", cls: "c-tu" },
  { name: "其他", cls: "c-ot" },
];

/* 8 分类专属 SVG 图标（极简线条，统一 14×14 描边色 currentColor） */
const CAT_ICONS = {
  "AI 工具": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="7" width="14" height="11" rx="2.5"/><circle cx="9" cy="12.5" r="1.2"/><circle cx="15" cy="12.5" r="1.2"/><path d="M9 7V4.5 M15 7V4.5 M12 18v3 M9 21h6"/></svg>',
  "硬件 & 嵌入式": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="0.5"/><path d="M3 10h3 M3 14h3 M18 10h3 M18 14h3 M10 3v3 M14 3v3 M10 18v3 M14 18v3"/></svg>',
  "前端 & 设计": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17 M12 3.5c2.5 2.5 4 5.5 4 8.5s-1.5 6-4 8.5 M12 3.5c-2.5 2.5-4 5.5-4 8.5s1.5 6 4 8.5"/></svg>',
  "桌面 & 系统": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="13" rx="1.5"/><path d="M9 21h6 M12 17.5v3.5"/></svg>',
  "开源项目 & 开发": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8 M8 7l8 4 M8 17l8-4"/></svg>',
  "搜索 & OSINT": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/><path d="M8 11h6 M11 8v6"/></svg>',
  "教程 & 资源": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5h10a3 3 0 013 3v12a3 3 0 00-3-3H4z"/><path d="M4 4.5v12 M17 7.5h2.5a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5H17 M6 8.5h6 M6 11.5h4"/></svg>',
  "其他": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9h16 M9 4v16"/></svg>',
};
const catCls = name => (CATS.find(c => c.name === name) || CATS[7]).cls;
const catNo = name => Math.max(1, CATS.findIndex(c => c.name === name) + 1);

const STATUS = {
  "⏳": { key: "pending", label: "待研究" },
  "🔄": { key: "doing",  label: "进行中" },
  "✅": { key: "done",   label: "已完成" },
};

const CAT_TEXTURES = {
  "AI 工具": (c) => `<circle cx="20" cy="20" r="3" fill="${c}"/><circle cx="80" cy="20" r="3" fill="${c}"/><circle cx="50" cy="60" r="3" fill="${c}"/><circle cx="20" cy="100" r="3" fill="${c}"/><circle cx="80" cy="100" r="3" fill="${c}"/><path d="M20 20 L80 20 L50 60 L20 100 L80 100" fill="none" stroke="${c}" stroke-width="1" opacity="0.5"/>`,
  "硬件 & 嵌入式": (c) => `<path d="M10 30 h40 v40 h40" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M90 30 h20 v60 h-40" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.6"/><circle cx="10" cy="30" r="3" fill="${c}"/><circle cx="90" cy="70" r="3" fill="${c}"/>`,
  "前端 & 设计": (c) => `<rect x="10" y="10" width="70" height="70" fill="none" stroke="${c}" stroke-width="1.5"/><rect x="30" y="30" width="50" height="50" fill="${c}" opacity="0.15"/><circle cx="90" cy="20" r="8" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  "桌面 & 系统": (c) => `<rect x="10" y="20" width="80" height="60" fill="none" stroke="${c}" stroke-width="1.5"/><rect x="10" y="20" width="80" height="12" fill="${c}" opacity="0.15"/><circle cx="18" cy="26" r="1.5" fill="${c}"/>`,
  "开源项目 & 开发": (c) => `<path d="M10 30 h50 M10 45 h70 M10 60 h40 M10 75 h60" stroke="${c}" stroke-width="1.5" fill="none"/><circle cx="85" cy="30" r="3" fill="${c}"/>`,
  "搜索 & OSINT": (c) => `<circle cx="50" cy="60" r="12" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="50" cy="60" r="26" fill="none" stroke="${c}" stroke-width="1" opacity="0.6"/><circle cx="50" cy="60" r="40" fill="none" stroke="${c}" stroke-width="0.8" opacity="0.35"/><path d="M50 60 L70 40" stroke="${c}" stroke-width="1.5"/>`,
  "教程 & 资源": (c) => `<rect x="30" y="10" width="50" height="80" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M38 24 h34 M38 38 h34 M38 52 h22" stroke="${c}" stroke-width="1.2"/>`,
  "其他": (c) => `<circle cx="25" cy="25" r="2.5" fill="${c}"/><circle cx="75" cy="25" r="2.5" fill="${c}"/><circle cx="25" cy="75" r="2.5" fill="${c}"/><circle cx="75" cy="75" r="2.5" fill="${c}"/><circle cx="50" cy="50" r="2.5" fill="${c}"/>`,
};
function catTextureSvg(name, catColor, size) {
  const w = size || 220, h = size || 220;
  return `<svg width="${w}" height="${h}" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">${CAT_TEXTURES[name] ? CAT_TEXTURES[name](catColor) : ""}</svg>`;
}

const CAT_COLORS = {
  "AI 工具": { d: "#c4b5fd", l: "#7c3aed", a: "#a78bfa", f: "#c4b5fd" },
  "硬件 & 嵌入式": { d: "#6ee7b7", l: "#059669", a: "#6ee7b7", f: "#6ee7b7" },
  "前端 & 设计": { d: "#fda4af", l: "#e11d48", a: "#f9a8d4", f: "#fda4af" },
  "桌面 & 系统": { d: "#7dd3fc", l: "#0284c7", a: "#7dd3fc", f: "#7dd3fc" },
  "开源项目 & 开发": { d: "#fcd34d", l: "#d97706", a: "#fcd34d", f: "#fcd34d" },
  "搜索 & OSINT": { d: "#5eead4", l: "#0d9488", a: "#5eead4", f: "#5eead4" },
  "教程 & 资源": { d: "#fdba74", l: "#ea580c", a: "#fdba74", f: "#fdba74" },
  "其他": { d: "#d4d4d8", l: "#52525b", a: "#b0aecb", f: "#8fa896" },
};
function getTheme() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t) return t;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
const catColor = name => {
  const c = CAT_COLORS[name];
  if (!c) return "#a3a3b0";
  const t = getTheme();
  return t === "light" ? c.l : t === "aurora" ? c.a : t === "forest" ? c.f : c.d;
};

let state = {
  items: [],
  category: null,
  query: "",
  view: "list",
  sortField: "id",
  sortDir: "asc",
  httpMode: false,
  dataName: "数据文件",  // 数据文件名（服务模式来自 /api/data 的 name，如 DATA.md）
  listAnim: false,
  lastNewId: null,
  dailyShown: new Set(),
  fold: {},  // 分组折叠：{分类名: true=折叠}
};

/* ============================================================
 * Markdown 解析
 * ============================================================ */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s) {
  s = escapeHtml(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a class="u" href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}
function extractUrl(s) {
  const m = s.match(/https?:\/\/[^\s)\]]+/);
  return m ? m[0] : null;
}
function categoryOfSectionTitle(t) {
  if (/AI|Agent|智能/.test(t)) return "AI 工具";
  if (/硬件|嵌入式|DIY/.test(t)) return "硬件 & 嵌入式";
  if (/设计|前端|网页/.test(t)) return "前端 & 设计";
  if (/软件|工具|桌面/.test(t)) return "桌面 & 系统";
  if (/开源|开发/.test(t)) return "开源项目 & 开发";
  if (/搜索|OSINT/.test(t)) return "搜索 & OSINT";
  if (/教程|资源/.test(t)) return "教程 & 资源";
  return "其他";
}
function domain(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return u; }
}

function parseMarkdown(text) {
  const items = [];
  let cur = null;
  let cat = "其他";
  let catNo = 8;
  for (const line of text.split(/\r?\n/)) {
    const sec = line.match(/^##\s+(\d+)\.\s+(.+)$/);
    if (sec) { cat = categoryOfSectionTitle(sec[2]); catNo = parseInt(sec[1], 10); continue; }
    const head = line.match(/^###\s+([⏳🔄✅])\s*(\d+\.\d+)\s+(.+)$/u);
    if (head) {
      cur = {
        status: STATUS[head[1]].key, statusSym: head[1], id: head[2],
        name: head[3].trim(), category: cat, catNo,
        fields: [], desc: "", url: null, image: null, difficulty: 0,
      };
      items.push(cur);
      continue;
    }
    const field = line.match(/^-\s+\*\*([^*]+)\*\*：\s*(.*)$/);
    if (field && cur) {
      const key = field[1].trim(), val = field[2].trim();
      if (!val) continue;
      cur.fields.push({ k: key, v: val });
      if (key.includes("简介")) cur.desc = val;
      else if (key.includes("封面")) cur.image = val;
      else if (key.includes("难度")) cur.difficulty = (val.match(/⭐/g) || []).length;
      if (!cur.url && /作者|来源|视频|原文|仓库|网址/.test(key)) cur.url = extractUrl(val);
      continue;
    }
    if (cur && !cur.desc) {
      const li = line.match(/^\s*[-*]\s+(.+)$/);
      if (li && !line.startsWith("- **")) cur.desc = li[1];
    }
  }
  return items;
}

/* ============================================================
 * 过滤 / 排序 / 渲染
 * ============================================================ */
const STATUS_RANK = { pending: 0, doing: 1, done: 2 };
function filtered() {
  const { items, category, query, sortField, sortDir } = state;
  const q = query.trim().toLowerCase();
  let list = items.filter(it => {
    if (category && it.category !== category) return false;
    if (!q) return true;
    return (it.name + " " + it.desc + " " + it.id + " " + it.category).toLowerCase().includes(q);
  });
  list = [...list].sort((a, b) => {
    let r = 0;
    if (sortField === "name") r = a.name.localeCompare(b.name, "zh-CN");
    else if (sortField === "diff") r = (a.difficulty || 0) - (b.difficulty || 0);
    else if (sortField === "status") r = (STATUS_RANK[a.status] || 0) - (STATUS_RANK[b.status] || 0);
    else r = a.id.localeCompare(b.id, "en", { numeric: true }); // id
    if (r === 0) r = a.id.localeCompare(b.id, "en", { numeric: true });
    return sortDir === "desc" ? -r : r;
  });
  return list;
}

function statusLabel(item) { return STATUS[item.statusSym].label; }
function statusCls(item) { return "st-" + item.status; }
function diffBadge(item) {
  return item.difficulty ? `<span class="badge diff">${"★".repeat(item.difficulty)}</span>` : "";
}
function catBadge(item) {
  // 行内只看图标（颜色已隐含分类，悬停 title 看全名）
  const icon = CAT_ICONS[item.category] || "";
  return `<span class="badge cat ${catCls(item.category)}" title="${item.category}"><span class="cat-icon">${icon}</span></span>`;
}
function thumbHtml(item) {
  // 统一用分类 SVG 图标作缩略图（移除首字母占位与远程封面图，避免隐私泄露与加载延迟）
  const icon = CAT_ICONS[item.category] || CAT_ICONS["其他"] || "";
  return `<div class="thumb ${catCls(item.category)}"><span class="cat-icon">${icon}</span></div>`;
}
function detailRows(item) {
  return item.fields.filter(f => !f.k.includes("简介") && !f.k.includes("封面")).map(f =>
    `<div class="df"><span class="k">${f.k}</span><span class="v">${inline(f.v)}</span></div>`).join("");
}

function rowHtml(item) {
  const src = item.url ? domain(item.url) : "-";
  return `
  <div class="row ${catCls(item.category)}" data-id="${item.id}">
    <input type="checkbox" class="pick" data-pick="${item.id}" aria-label="选择 ${item.id}" title="选择">
    <span class="id">${item.id}</span>
    ${thumbHtml(item)}
    <span class="name"><span class="txt" title="${escapeAttr(item.name)}">${inline(item.name)}</span></span><span class="cat-slot">${catBadge(item)}</span><span class="difficulty">${diffBadge(item)}</span>
    <span class="src"><a href="${item.url || "#"}" target="${item.url ? "_blank" : "_self"}" rel="noopener" title="${item.url || ""}">${src}</a></span>
    <span class="status ${statusCls(item)}">${statusLabel(item)}</span>
    <span class="chev"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
  </div>
  <div class="detail-panel" data-for="${item.id}"><div class="dp-inner"><div class="dp-body">
    ${detailRows(item)}
    <div class="dp-actions" data-id="${item.id}">
      <button type="button" class="dp-act" data-act="study" title="研究档案：笔记 / 抓取正文 / 计时">🔬 研究</button>
      <button type="button" class="dp-act" data-act="open" title="在新标签打开原文"${item.url ? "" : " disabled"}>↗ 原文</button>
      <button type="button" class="dp-act" data-act="status" title="切换状态">↻ 状态</button>
      <button type="button" class="dp-act" data-act="copy" title="复制链接">⧉ 复制</button>
    </div>
  </div></div></div>`;
}

function renderList(list) {
  const el = document.getElementById("listView");
  if (!list.length) {
    let t = "暂无匹配条目", d = "试试调整筛选或搜索关键词";
    if (state.query.trim()) { t = "搜索无结果"; d = `没找到匹配「${state.query.trim()}」的项目`; }
    else if (state.category) { t = "该分类下暂无条目"; d = `「${state.category}」分类下还没有项目`; }
    else if (state.items.length === 0) { t = "清单是空的"; d = "暂无任何条目，去新增第一个吧"; }
    el.innerHTML = `<div class="empty"><div class="em-t">${t}</div><div class="em-d">${d}</div></div>`;
    return;
  }
// 分组折叠：按分类折叠的行隐藏
  const folded = state.fold;
  const anyFolded = Object.values(folded).some(Boolean);
  const out = [];
  let skipCat = null;  // 当前折叠跳过的分类
  for (const it of list) {
    if (anyFolded && folded[it.category]) {
      if (skipCat !== it.category) {
        const cnt = list.filter(x => x.category === it.category).length;
        out.push(`<div class="cat-fold" data-fold="${it.category}">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
          ${it.category} <span class="cnt">${cnt}</span> 项已折叠（双击分类名展开）
        </div>`);
        skipCat = it.category;
      }
      continue;
    }
    skipCat = null;
    out.push(rowHtml(it));
  }
  el.innerHTML = out.join("");
  // 初次加载 stagger 渐入
  if (state.listAnim) {
    el.classList.add("anim");
    el.querySelectorAll(".row").forEach((r, i) => {
      r.style.animationDelay = Math.min(i * 36, 400) + "ms";
      const panel = r.nextElementSibling;
      if (panel && panel.classList.contains("detail-panel")) panel.style.animationDelay = Math.min(i * 36, 400) + "ms";
    });
    state.listAnim = false;
  } else {
    el.classList.remove("anim");
  }
  // 新增条目飞入 + 高亮
  if (state.lastNewId) {
    const newRow = el.querySelector(`.row[data-id="${state.lastNewId}"]`);
    if (newRow) {
      newRow.classList.add("just-in");
      newRow.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => { state.lastNewId = null; }, 1200);
    } else {
      state.lastNewId = null;
    }
  }
}

function coverHtml(item) {
  const stCls = { pending: "sp", doing: "sd", done: "sf" }[item.status];
  const ph = `<div class="ph">${item.name.slice(0, 1)}</div>`;
  return `<div class="cover ${catCls(item.category)}">
    ${item.image ? `<img src="${item.image}" loading="lazy" alt="" onerror="this.remove()">` : ph}
    <span class="stt ${stCls}">${statusLabel(item)}</span>
  </div>`;
}

function cardHtml(item) {
  const src = item.url ? domain(item.url) : "-";
  return `
  <article class="card ${catCls(item.category)}" data-id="${item.id}">
    <svg class="corner-mark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2 L14.8 8.6 L22 11 L14.8 13.4 L12 22 L9.2 13.4 L2 11 L9.2 8.6 Z"/>
    </svg>
    ${coverHtml(item)}
    <div class="body">
      <div class="nm">${inline(item.name)}</div>
      <div class="bdg">${catBadge(item)}${diffBadge(item)}</div>
      ${item.desc ? `<div class="ds">${inline(item.desc)}</div>` : ""}
      <div class="detail"><div class="di"><div class="di-in">${detailRows(item)}</div></div></div>
      <div class="ft">
        <span class="sr"><a href="${item.url || "#"}" target="${item.url ? "_blank" : "_self"}" rel="noopener" title="${item.url || ""}">${src}</a></span>
        <span class="more">详情</span>
        <button type="button" class="study-btn" onclick="event.stopPropagation();openEntry('${escapeAttr(item.id)}')">📝研究</button>
      </div>
    </div>
  </article>`;
}

function renderBoard(list) {
  document.getElementById("boardView").innerHTML = list.length
    ? list.map(cardHtml).join("") : `<div class="empty">暂无匹配条目</div>`;
}

function renderBanner(list) {
  const inner = document.getElementById("bannerInner");
  const cat = state.category;
  const color = cat ? catColor(cat) : "#e8a33d";
  inner.classList.remove(...CATS.map(c => c.cls));
  inner.classList.add(cat ? catCls(cat) : "c-ai");
  inner.style.setProperty("--cat", color);
  document.getElementById("bannerSvg").innerHTML = cat
    ? CAT_TEXTURES[cat](color) : CAT_TEXTURES["AI 工具"](color);
  if (cat) {
    document.getElementById("bannerTitle").textContent = cat;
    document.getElementById("bannerSub").textContent = `该分类下的 ${list.length} 个项目，点击条目展开详情`;
  } else {
    document.getElementById("bannerTitle").textContent = "待研究项目库";
    document.getElementById("bannerSub").textContent = "记录看到的高分项目与工具，有空一个个研究";
  }
  const np = list.filter(i => i.status === "pending").length;
  const nd = list.filter(i => i.status === "doing").length;
  const nf = list.filter(i => i.status === "done").length;
  document.getElementById("bannerBadges").innerHTML =
    `<span class="pill">待研究 <b>${np}</b></span><span class="pill">进行中 <b>${nd}</b></span><span class="pill">已完成 <b>${nf}</b></span>`;
  document.getElementById("bannerNum").innerHTML = `${list.length}<small>ITEMS</small>`;
  // 切换分类时重触发入场动画
  const bwrap = inner.querySelector(".bwrap");
  if (bwrap) {
    bwrap.classList.remove("replay");
    void bwrap.offsetWidth;
    bwrap.classList.add("replay");
  }
}

function syncSlider() {
  const wrap = document.getElementById("viewSwitch");
  const active = wrap.querySelector("button.active");
  const slider = document.getElementById("vsSlider");
  if (!active) return;
  slider.style.width = active.offsetWidth + "px";
  slider.style.transform = `translateX(${active.offsetLeft - 3}px)`;
}

/* 统计数字滚动动画 */
function animateNum(el, target) {
  const cur = parseInt(el.textContent.replace(/\D/g, ""), 10) || 0;
  if (cur === target) return;
  const t0 = performance.now(), dur = 500;
  function tick(t) {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(cur + (target - cur) * e);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function render() {
  const list = filtered();

  // 视图切换 fade（让切换有过渡感）
  const visibleView = [...document.querySelectorAll("#listView, #boardView")].find(e => !e.hidden);
  if (visibleView) visibleView.classList.add("view-fade");
  const doRender = () => {
  const nTotal = list.length;
  const nPending = list.filter(i => i.status === "pending").length;
  const nDoing = list.filter(i => i.status === "doing").length;
  const nDone = list.filter(i => i.status === "done").length;
  animateNum(document.getElementById("nTotal"), nTotal);
  animateNum(document.getElementById("nPending"), nPending);
  animateNum(document.getElementById("nDoing"), nDoing);
  animateNum(document.getElementById("nDone"), nDone);
  document.getElementById("subTotal").textContent = `共 ${nTotal} 条 · 进度 ${nTotal ? Math.round((nPending + nDoing * 0.5) / nTotal * 100) : 0}%`;
  document.getElementById("progressBar").style.width = (nTotal ? ((nPending + nDoing * 0.5) / nTotal * 100) : 0) + "%";

  const isBoard = state.view === "board";
  document.getElementById("listView").hidden = isBoard;
  document.getElementById("boardView").hidden = !isBoard;
  document.getElementById("viewSwitch").querySelectorAll("button").forEach(b =>
    b.classList.toggle("active", b.dataset.view === state.view));
  if (isBoard) renderBoard(list); else renderList(list);
  renderBanner(list);
  syncSlider();
  syncPicked();
  updateSortHead();
    if (visibleView) visibleView.classList.remove("view-fade");
  };
  requestAnimationFrame(doRender);
}

/* ============================================================
 * Toast
 * ============================================================ */
let toastTimer = null;
function toast(msg, type) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast " + (type || "ok") + " show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

/* ============================================================
 * 数据加载 + 浏览器自动备份
 * ============================================================ */
let backupInfo = null;

function setLoaded(show) {
  document.getElementById("statsbar").hidden = !show;
  document.getElementById("toolrow").hidden = !show;
  document.getElementById("meta").hidden = !show;
  document.getElementById("banner").hidden = !show;
  document.getElementById("emptyState").classList.toggle("show", !show);
}

function applyText(text, name, via, fromBackup) {
  state.items = parseMarkdown(text);
  state.listAnim = true;
  const restoreBtn = fromBackup && state.httpMode
    ? `<button onclick="restoreFromBackup()">恢复文件</button>` : "";
  document.getElementById("meta").innerHTML =
    `<span>共 ${state.items.length} 个条目 · ${name} · ${via}</span>` +
    (fromBackup ? `<span class="bak-warn">⚠ 显示浏览器备份，文件可能丢失 ${restoreBtn}</span>` : backupInfo
      ? `<span class="bak-ok">备份 ${backupInfo.time}</span>` : "");
  document.getElementById("fname").textContent = name;
  document.getElementById("footerFile").textContent = "FILE: " + name;
  document.getElementById("reloadBtn").hidden = false;
  try { localStorage.setItem("last_board_file", name); } catch (_) {}
  setLoaded(true);
  buildCats();
  render();
  renderDaily();
  updateEmpty();
}

/* - 空态文案分场景 - */
function updateEmpty() {
  const t = document.getElementById("emptyTitle");
  const d = document.getElementById("emptyDesc");
  const btn = document.getElementById("emptyPickBtn");
  if (state.httpMode) {
    t.textContent = "清单是空的";
    d.textContent = "暂无任何条目。点「新增」粘贴一个链接，30 秒内开始你的灵感收集。";
    btn.textContent = "新增第一条";
  } else {
    t.textContent = `加载 ${state.dataName} 开始`;
    d.textContent = `看板读取本地的 ${state.dataName} 文件。请先启动服务（双击 start.bat），或点击下方按钮手动选择文件。`;
    btn.textContent = "选择文件";
  }
}

function idbOpen() {
  return new Promise((res, rej) => {
    let rq;
    try { rq = indexedDB.open("board_db", 2); }
    catch (e) { rej(e); return; }
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles");
      if (!db.objectStoreNames.contains("backup")) db.createObjectStore("backup");
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbSet(store, key, val) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (_) {}
}
async function idbGet(store, key) {
  try {
    const db = await idbOpen();
    return await new Promise((res, rej) => {
      const rq = db.transaction(store, "readonly").objectStore(store).get(key);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => rej(rq.error);
    });
  } catch (_) { return null; }
}
function fmtTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function httpLoad() {
  const dot = document.getElementById("svcDot");
  dot.classList.remove("ok", "err");
  dot.classList.add("loading");
  try {
    const r = await fetch("/api/data", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    if (!d.ok || !d.content) throw new Error("bad data");
    state.httpMode = true;
    state.dataName = d.name || "数据文件";
    dot.classList.remove("loading");
    dot.classList.add("ok");
    applyText(d.content, d.name, "服务模式");
    const now = Date.now();
    await idbSet("backup", "readme", { name: d.name, content: d.content, time: now });
    backupInfo = { time: fmtTime(now) };
    return true;
  } catch (e) {
    const bak = await idbGet("backup", "readme");
    if (bak) {
      dot.classList.remove("loading");
      dot.classList.add("err");
      applyText(bak.content, bak.name, "浏览器备份（服务未运行）", true);
      backupInfo = { time: fmtTime(bak.time) };
      return true;
    }
    dot.classList.remove("loading");
    dot.classList.add("err");
    return false;
  }
}

async function restoreFromBackup() {
  if (!confirm(`将用浏览器备份覆盖 ${state.dataName} 当前内容，确认恢复？`)) return;
  const bak = await idbGet("backup", "readme");
  if (!bak) { toast("没有可用备份", "err"); return; }
  try {
    const r = await fetch("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: bak.content }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "恢复失败");
    await httpLoad();
    toast(`已从备份恢复 ${state.dataName}`, "ok");
  } catch (e) {
    toast("恢复失败：" + e.message, "err");
  }
}

function buildCats() {
  const counts = {};
  state.items.forEach(i => counts[i.category] = (counts[i.category] || 0) + 1);
  const wrap = document.getElementById("cats");
  const chip = (name, count, active) => {
    const folded = state.fold[name] ? " folded" : "";
    return `<button class="chip ${catCls(name)}${active ? " active" : ""}${folded}" data-cat="${name}">${name} <span class="c">${count}</span></button>`;
  };
  wrap.innerHTML =
    chip("全部", state.items.length, state.category === null) +
    CATS.filter(c => counts[c.name]).map(c => chip(c.name, counts[c.name], state.category === c.name)).join("");
}

/* ============================================================
 * 事件
 * ============================================================ */
document.getElementById("reloadBtn").addEventListener("click", async () => {
  if (state.httpMode) await httpLoad();
});
document.getElementById("searchInput").addEventListener("input", e => { state.query = e.target.value; render(); });
document.getElementById("sortHead").addEventListener("click", e => {
  const btn = e.target.closest(".sh-btn");
  if (!btn) return;
  const f = btn.dataset.sf;
  if (state.sortField === f) {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
  } else {
    state.sortField = f;
    // 难度字段默认降序（高难度先看），其他默认升序
    state.sortDir = f === "diff" ? "desc" : "asc";
  }
  updateSortHead();
  render();
});
function updateSortHead() {
  document.querySelectorAll("#sortHead .sh-btn").forEach(b => {
    const active = b.dataset.sf === state.sortField;
    b.classList.toggle("active", active);
    b.classList.toggle("asc", active && state.sortDir === "asc");
    b.classList.toggle("desc", active && state.sortDir === "desc");
  });
}
document.getElementById("cats").addEventListener("click", e => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  state.category = chip.dataset.cat === "全部" ? null : chip.dataset.cat;
  buildCats();
  render();
});

/* 分组折叠：双击 chip 折叠/展开该分类 */
document.getElementById("cats").addEventListener("dblclick", e => {
  const chip = e.target.closest(".chip");
  if (!chip || !chip.dataset.cat || chip.dataset.cat === "全部") return;
  const c = chip.dataset.cat;
  state.fold[c] = !state.fold[c];
  buildCats();
  render();
});

/* 点击折叠块展开 */
document.getElementById("listView").addEventListener("click", e => {
  const fold = e.target.closest(".cat-fold");
  if (!fold) return;
  state.fold[fold.dataset.fold] = false;
  buildCats();
  render();
});

/* 密度切换 */
function setDensity(d) {
  document.body.classList.toggle("density-compact", d === "compact");
  document.querySelectorAll("#density button").forEach(b => b.classList.toggle("active", b.dataset.d === d));
  try { localStorage.setItem("board_density", d); } catch (_) {}
}
document.getElementById("density").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (btn) setDensity(btn.dataset.d);
});
document.getElementById("viewSwitch").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.view = btn.dataset.view;
  try { localStorage.setItem("board_view", state.view); } catch (_) {}
  render();
});
document.getElementById("listView").addEventListener("click", e => {
  // 详情面板内的操作按钮优先处理
  const actBtn = e.target.closest(".dp-act");
  if (actBtn) {
    e.stopPropagation();
    const id = actBtn.closest(".dp-actions").dataset.id;
    const item = state.items.find(x => x.id === id);
    if (!item) return;
    const act = actBtn.dataset.act;
    if (act === "study") openStudy(item);
    else if (act === "open" && item.url) window.open(item.url, "_blank", "noopener");
    else if (act === "status") cycleStatus(item);
    else if (act === "copy") copyLink(item.url);
    return;
  }
  const row = e.target.closest(".row");
  if (!row || e.target.closest("a") || e.target.closest(".pick")) return;
  row.classList.toggle("open");
});

/* 列表详情面板：状态循环（待研究 → 进行中 → 已完成 → 待研究） */
async function cycleStatus(item) {
  const next = item.status === "pending" ? "doing" : item.status === "doing" ? "done" : "pending";
  const sym = next === "doing" ? "🔄" : next === "done" ? "✅" : "⏳";
  try {
    const r = await fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, status: sym }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "更新失败");
    item.status = next;
    render();
    toast("状态已更新", "ok");
  } catch (e) { toast("状态更新失败：" + e.message, "err"); }
}
async function copyLink(url) {
  if (!url) { toast("该条目无链接", "err"); return; }
  try { await navigator.clipboard.writeText(url); toast("链接已复制", "ok"); }
  catch (_) { toast("复制失败，请手动复制", "err"); }
}
document.getElementById("boardView").addEventListener("click", e => {
  const card = e.target.closest(".card");
  if (!card || e.target.closest("a")) return;
  card.classList.toggle("open");
});

try {
  const v = localStorage.getItem("board_view");
  if (v === "list" || v === "board") state.view = v;
} catch (_) {}
try {
  const d = localStorage.getItem("board_density");
  if (d === "compact") setDensity("compact");
} catch (_) {}

/* ============================================================
 * 主题切换
 * ============================================================ */
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("board_theme", t); } catch (_) {}
  document.querySelectorAll("#themePanel .tp-item").forEach(b =>
    b.classList.toggle("active", b.dataset.t === t));
  if (state.items.length) renderBanner(filtered()); // 横幅 --cat 随主题刷新
}
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem("board_theme"); } catch (_) {}
  // 默认浅色主题（晨曦暖白），不跟随系统深色
  applyTheme(t || "light");
})();
document.getElementById("themeBtn").addEventListener("click", e => {
  e.stopPropagation();
  document.getElementById("themePanel").classList.toggle("open");
});
document.addEventListener("click", e => {
  if (!e.target.closest(".theme-wrap")) document.getElementById("themePanel").classList.remove("open");
});
document.getElementById("themePanel").addEventListener("click", e => {
  const item = e.target.closest(".tp-item");
  if (!item) return;
  applyTheme(item.dataset.t);
  document.getElementById("themePanel").classList.remove("open");
});

/* 卡片封面鼠标视差 */
const boardEl = document.getElementById("boardView");
const prefersReduce = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
boardEl.addEventListener("mousemove", e => {
  if (prefersReduce()) return;
  const card = e.target.closest(".card");
  if (!card) return;
  const img = card.querySelector(".cover img");
  if (!img) return;
  const r = card.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  img.style.transition = "transform 0.1s linear";
  img.style.transform = `scale(1.08) translate(${(x * 14).toFixed(1)}px, ${(y * 10).toFixed(1)}px)`;
});
boardEl.addEventListener("mouseleave", e => {
  const img = e.target.querySelector ? e.target.querySelector(".cover img") : null;
  if (img) { img.style.transition = ""; img.style.transform = ""; }
});

/* ============================================================
 * 新增模态
 * ============================================================ */
const modal = document.getElementById("modal");
let draftDiff = 1;

document.getElementById("addBtn").addEventListener("click", () => {
  if (!state.httpMode) { toast("请先启动服务（双击 start.bat）", "err"); return; }
  document.getElementById("fetchUrl").value = "";
  document.getElementById("linkName").value = "";
  document.getElementById("linkDesc").value = "";
  document.getElementById("fetchPrev").classList.remove("show");
  document.getElementById("fetchErr").classList.remove("show");
  document.getElementById("fetchWarn").classList.remove("show");
  document.getElementById("fetchLoad").classList.remove("show");
  document.getElementById("editForm").hidden = true;
  document.getElementById("genBtn").hidden = true;
  document.getElementById("okMsg").classList.remove("show");
  document.getElementById("nameErr").classList.remove("show");
  draftDiff = 1;
  document.querySelectorAll("#starPicker button").forEach(b => b.classList.toggle("on", b.dataset.d === "1"));
  modal.classList.add("open");
  setTimeout(() => document.getElementById("fetchUrl").focus(), 80);
});

document.getElementById("cancelBtn").addEventListener("click", () => modal.classList.remove("open"));
modal.addEventListener("click", e => { if (e.target === modal) modal.classList.remove("open"); });
document.addEventListener("keydown", e => { if (e.key === "Escape") modal.classList.remove("open"); });
document.getElementById("starPicker").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  draftDiff = parseInt(b.dataset.d, 10);
  document.querySelectorAll("#starPicker button").forEach(x =>
    x.classList.toggle("on", x.dataset.d === String(draftDiff)));
});

async function fetchMetaFromUrl() {
  const url = document.getElementById("fetchUrl").value.trim();
  if (!/^https?:\/\//i.test(url)) { showFetchErr("请粘贴有效的 http(s) 链接"); return; }
  document.getElementById("fetchErr").classList.remove("show");
  document.getElementById("fetchWarn").classList.remove("show");
  document.getElementById("fetchPrev").classList.remove("show");
  document.getElementById("editForm").hidden = true;
  document.getElementById("genBtn").hidden = true;
  document.getElementById("fetchLoad").classList.add("show");
  document.getElementById("fetchBtn").disabled = true;
  try {
    const r = await fetch("/api/fetch-meta?url=" + encodeURIComponent(url), { cache: "no-store" });
    const d = await r.json();
    if (!d.ok) { showFetchErr(d.error || "识别失败"); return; }
    const m = d.meta;
    const warnEl = document.getElementById("fetchWarn");
    if (m.warning) {
      warnEl.textContent = "⚠️ 未能抓取页面内容（" + m.warning + "），已用链接兜底解析";
      warnEl.classList.add("show");
    } else {
      warnEl.classList.remove("show");
    }
    document.getElementById("fpTitle").textContent = m.title || "（未识别到标题）";
    document.getElementById("fpAuthor").textContent = [m.author, m.site].filter(Boolean).join(" · ");
    document.getElementById("fpDesc").textContent = (m.desc || "").slice(0, 180);
    if (m.image) {
      document.getElementById("fpImg").src = m.image;
      document.getElementById("fpImg").hidden = false;
      document.getElementById("fpPh").textContent = "";
    } else {
      document.getElementById("fpImg").hidden = true;
      document.getElementById("fpPh").textContent = m.title ? m.title.slice(0, 1) : "?";
    }
    document.getElementById("fetchPrev").classList.add("show");
    document.getElementById("linkName").value = m.title || "";
    document.getElementById("linkDesc").value = m.desc || "";
    const sel = document.getElementById("linkCat");
    sel.innerHTML = CATS.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
    sel.value = m.category || "其他";
    document.getElementById("editForm").hidden = false;
    document.getElementById("genBtn").hidden = false;
  } catch (e) {
    showFetchErr("识别失败：" + e.message);
  } finally {
    document.getElementById("fetchLoad").classList.remove("show");
    document.getElementById("fetchBtn").disabled = false;
  }
}
function showFetchErr(msg) {
  document.getElementById("fetchErr").textContent = msg;
  document.getElementById("fetchErr").classList.add("show");
}
document.getElementById("fetchBtn").addEventListener("click", fetchMetaFromUrl);
document.getElementById("fetchUrl").addEventListener("keydown", e => { if (e.key === "Enter") fetchMetaFromUrl(); });

document.getElementById("genBtn").addEventListener("click", async () => {
  const url = document.getElementById("fetchUrl").value.trim();
  const name = document.getElementById("linkName").value.trim();
  const cat = document.getElementById("linkCat").value;
  const desc = document.getElementById("linkDesc").value.trim();
  if (!name) { document.getElementById("nameErr").classList.add("show"); return; }

  const btn = document.getElementById("genBtn");
  btn.disabled = true;
  btn.textContent = "写入中…";
  try {
    const r = await fetch("/api/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, name, cat, desc, difficulty: draftDiff }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "写入失败");
    state.lastNewId = d.id;
    toast(`已写入 ${state.dataName}（${d.id} · ${d.category}）`, "ok");
    particleBurst(innerWidth / 2, innerHeight - 140);
    // 收藏里程碑
    try {
      const cnt = parseInt(document.getElementById("nTotal").textContent, 10) || 0;
      if (cnt > 0 && cnt % 5 === 0) setTimeout(() => toast(`第 ${cnt} 个收藏，里程碑达成`, "ok"), 800);
    } catch (_) {}
    await httpLoad();
    setTimeout(() => modal.classList.remove("open"), 700);
  } catch (e) {
    toast("写入失败：" + e.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "写入 README";
  }
});

/* ============================================================
 * 启动
 * ============================================================ */
async function init() {
  const ok = await httpLoad();
  if (!ok) {
    document.getElementById("svcDot").classList.add("err");
  }
  window.addEventListener("resize", syncSlider);
  // 页面进入序列
  requestAnimationFrame(() => document.body.classList.add("seq-on"));
}
init();

/* ============================================================
 * 创意功能：粒子 / 批量 / 随机抽取 / 统计 / 研究模式 / 快捷键
 * ============================================================ */

/* - 今日推荐（产品隐喻：从待研究里算法挑一个） - */
function todayStr() { return new Date().toISOString().slice(0, 10); }
function dailyPick() {
  const pool = state.items.filter(i => i.status === "pending");
  if (!pool.length) return null;
  // 同难度按编号小（数字）；已展示过的跳过
  const sorted = [...pool].sort((a, b) => (a.difficulty || 0) - (b.difficulty || 0) || a.id.localeCompare(b.id, "en", { numeric: true }));
  return sorted.find(i => !state.dailyShown.has(i.id)) || sorted[0];
}
function renderDaily() {
  const box = document.getElementById("daily");
  // 今日关闭过？
  try { if (localStorage.getItem("daily_hide_date") === todayStr()) { box.hidden = true; return; } } catch (_) {}
  const item = dailyPick();
  if (!item) { box.hidden = true; return; }
  box.hidden = false;
  box.classList.remove("appear");
  void box.offsetWidth;
  box.classList.add("appear");
  const cover = document.getElementById("dCover");
  cover.classList.remove(...CATS.map(c => c.cls));
  cover.classList.add(catCls(item.category));
  cover.style.setProperty("--cat", catColor(item.category));
  cover.innerHTML = item.image
    ? `<img src="${item.image}" alt="" loading="lazy" onerror="this.remove()">`
    : `<div class="ph">${item.name.slice(0, 1)}</div>`;
  document.getElementById("dTitle").textContent = item.name;
  document.getElementById("dMeta").innerHTML =
    `<span class="badge cat ${catCls(item.category)}">${item.category}</span><span class="badge diff">${"★".repeat(item.difficulty || 1)}</span><span class="status st-${item.status}">${statusLabel(item)}</span>`;
  document.getElementById("dailyStart").onclick = () => openStudy(item);
  document.getElementById("dailySkip").onclick = () => { state.dailyShown.add(item.id); renderDaily(); };
  box.dataset.curId = item.id;
}

/* 今日推荐关闭（×）按钮 */
document.getElementById("dailyClose").addEventListener("click", () => {
  try { localStorage.setItem("daily_hide_date", todayStr()); } catch (_) {}
  document.getElementById("daily").hidden = true;
});

/* - 新增成功粒子绽放 - */
function particleBurst(x, y) {
  const field = document.getElementById("particleField");
  const colors = ["var(--accent)", "var(--ok)", "var(--doing)", "#c4b5fd", "#fda4af"];
  for (let i = 0; i < 14; i++) {
    const p = document.createElement("span");
    p.className = "particle";
    p.style.left = (x || innerWidth / 2) + "px";
    p.style.top = (y || innerHeight / 2) + "px";
    p.style.background = colors[i % colors.length];
    p.style.setProperty("--px", (Math.random() * 160 - 80).toFixed(0) + "px");
    p.style.setProperty("--py", (Math.random() * -120 - 20).toFixed(0) + "px");
    p.style.animationDelay = (Math.random() * 0.12).toFixed(2) + "s";
    field.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}

/* - 批量操作 - */
const picked = new Set();
function syncPicked() {
  document.querySelectorAll(".row").forEach(r => {
    const cb = r.querySelector(".pick");
    const on = picked.has(r.dataset.id);
    r.classList.toggle("picked", on);
    if (cb) cb.checked = on;
  });
  const n = picked.size;
  document.getElementById("bulkbar").classList.toggle("show", n > 0);
  document.getElementById("bulkCount").textContent = `已选 ${n} 项`;
}
document.getElementById("listView").addEventListener("change", e => {
  const cb = e.target.closest(".pick");
  if (!cb) return;
  if (cb.checked) picked.add(cb.dataset.pick); else picked.delete(cb.dataset.pick);
  syncPicked();
});
async function bulkAction(fn) {
  if (!picked.size) return;
  for (const id of [...picked]) await fn(id);
  picked.clear();
  await httpLoad();
  syncPicked();
}
document.getElementById("bulkDoing").addEventListener("click", () => bulkAction(id => fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "🔄" }) })));
document.getElementById("bulkDone").addEventListener("click", () => bulkAction(id => fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "✅" }) })));
document.getElementById("bulkPending").addEventListener("click", () => bulkAction(id => fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "⏳" }) })));
document.getElementById("bulkDelete").addEventListener("click", async () => {
  if (!confirm(`确认删除选中的 ${picked.size} 个条目？此操作不可撤销。`)) return;
  await bulkAction(id => fetch("/api/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
  toast(`已删除 ${picked.size} 个条目`, "ok");
});

/* - 随机抽取（滚动点名 + 难度加权） - */
let rollItem = null;
let rollTimer = null;
function weightedPick() {
  const pool = state.items.filter(i => i.status === "pending");
  const src = pool.length ? pool : state.items;
  if (!src.length) return null;
  const weights = src.map(it => 1 + (it.difficulty || 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < src.length; i++) {
    r -= weights[i];
    if (r <= 0) return src[i];
  }
  return src[src.length - 1];
}
function rollStart() {
  const modal = document.getElementById("rollModal");
  modal.classList.add("open");
  const nameEl = document.getElementById("rollName");
  const hitEl = document.getElementById("rollHit");
  document.getElementById("rollStudy").hidden = true;
  document.getElementById("rollOpen").hidden = true;
  const pool = state.items.filter(i => i.status === "pending");
  const src = pool.length ? pool : state.items;
  if (!src.length) { nameEl.textContent = "清单是空的"; hitEl.textContent = ""; return; }
  nameEl.classList.add("rolling");
  let tick = 0;
  const totalTicks = 18 + Math.floor(Math.random() * 8);
  clearInterval(rollTimer);
  rollTimer = setInterval(() => {
    tick++;
    nameEl.textContent = src[Math.floor(Math.random() * src.length)].name;
    if (tick >= totalTicks) {
      clearInterval(rollTimer);
      nameEl.classList.remove("rolling");
      rollItem = weightedPick();
      nameEl.textContent = rollItem.name;
      hitEl.textContent = `${rollItem.id} · ${rollItem.category} · 难度 ${"★".repeat(rollItem.difficulty || 1)}`;
      document.getElementById("rollStudy").hidden = false;
      document.getElementById("rollOpen").hidden = false;
    }
  }, 70 + tick * 6);
}
document.getElementById("rollBtn").addEventListener("click", () => {
  if (!state.httpMode || !state.items.length) { toast("请先加载数据", "err"); return; }
  rollStart();
});
document.getElementById("rollAgain").addEventListener("click", rollStart);
document.getElementById("rollStudy").addEventListener("click", () => {
  if (!rollItem) return;
  document.getElementById("rollModal").classList.remove("open");
  openStudy(rollItem);
});
document.getElementById("rollOpen").addEventListener("click", () => {
  if (rollItem && rollItem.url) window.open(rollItem.url, "_blank");
});
document.getElementById("rollModal").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove("open"); });

/* - 统计洞察 - */
function ringHtml(id, title, segs, centerNum, centerLabel) {
  let grad = "", legend = "";
  let acc = 0;
  const total = segs.reduce((a, s) => a + s.v, 0) || 1;
  segs = segs.filter(s => s.v > 0);
  segs.forEach(s => {
    const from = acc / total * 100;
    acc += s.v;
    const to = acc / total * 100;
    grad += `${s.c} ${from}% ${to}% `;
    legend += `<div class="lg"><span class="sw" style="background:${s.c}"></span><span class="nm">${s.n}</span><span class="pc">${s.v} · ${(s.v / total * 100).toFixed(0)}%</span></div>`;
  });
  if (!grad) grad = "var(--border) 0% 100%";
  return `
  <div class="ring-card">
    <div class="rt">${title}</div>
    <div class="ring-row">
      <div class="ring" style="background: conic-gradient(${grad})">
        <div class="ring-hole"><span class="rn">${centerNum}</span><span class="rl">${centerLabel}</span></div>
      </div>
      <div class="legend">${legend || '<span style="color:var(--text-3);font-size:12px">暂无数据</span>'}</div>
    </div>
  </div>`;
}
function openStats() {
  if (!state.items.length) { toast("请先加载数据", "err"); return; }
  const items = state.items;
  document.getElementById("statsSub").textContent = `基于当前 ${items.length} 个条目的库存结构`;
  const rings = document.getElementById("rings");
  // 分类分布
  const catCount = {};
  items.forEach(i => catCount[i.category] = (catCount[i.category] || 0) + 1);
  const catSegs = Object.entries(catCount).map(([n, v]) => ({ n, v, c: catColor(n) }));
  // 难度分布
  const diffCount = { 1: 0, 2: 0, 3: 0 };
  items.forEach(i => diffCount[i.difficulty || 1]++);
  const diffSegs = [[1, "入门 ★", "#a3a3b0"], [2, "中等 ★★", "#e8a33d"], [3, "进阶 ★★★", "#f87171"]]
    .map(([k, n, c]) => ({ n, v: diffCount[k], c }));
  // 状态分布
  const stCount = { pending: 0, doing: 0, done: 0 };
  items.forEach(i => stCount[i.status]++);
  const stSegs = [["pending", "待研究", "var(--accent)"], ["doing", "进行中", "var(--doing)"], ["done", "已完成", "var(--ok)"]]
    .map(([k, n, c]) => ({ n, v: stCount[k], c }));
  const done = stCount.done;
  const total = items.length;
  rings.innerHTML =
    ringHtml("r1", "分类分布", catSegs, items.length, "条目") +
    ringHtml("r2", "难度分布", diffSegs, items.reduce((a, i) => a + (i.difficulty || 1), 0) / items.length, "平均难度") +
    ringHtml("r3", "状态分布", stSegs, total, "总数") +
    ringHtml("r4", "完成进度", [{ n: "已完成", v: done, c: "var(--ok)" }, { n: "未完成", v: total - done, c: "var(--border)" }], total ? Math.round(done / total * 100) : 0, "完成率");
  document.getElementById("statsModal").classList.add("open");
}
document.getElementById("statsBtn").addEventListener("click", openStats);
document.getElementById("statsModal").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove("open"); });

/* - 沉浸研究模式 - */
let studyItem = null;
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
  if (!state.httpMode) { toast("请先启动服务", "err"); return; }
  studyItem = item;
  document.getElementById("studyTitle").textContent = item.name;
  const color = catColor(item.category);
  const meta = document.getElementById("studyMeta");
  meta.innerHTML = `<span class="badge cat ${catCls(item.category)}">${item.category}</span><span class="badge diff">${"★".repeat(item.difficulty || 1)}</span><span class="status ${statusCls(item)}">${statusLabel(item)}</span>`;
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
  document.getElementById("studyNote").value = nf ? nf.v.replace(/^（待补充）$/, "") : "";
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
  document.getElementById("timerToggle").textContent = "开始";
}
document.getElementById("studyBack").addEventListener("click", () => document.getElementById("studyOverlay").classList.remove("open"));
document.getElementById("studyOverlay").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove("open"); });
document.getElementById("studyOpen").addEventListener("click", () => { if (studyItem && studyItem.url) window.open(studyItem.url, "_blank"); });
document.getElementById("studyStatus").addEventListener("click", async () => {
  if (!studyItem) return;
  const next = studyItem.status === "pending" ? "🔄" : studyItem.status === "doing" ? "✅" : "⏳";
  await fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: studyItem.id, status: next }) });
  await httpLoad();
  const item = state.items.find(i => i.id === studyItem.id);
  if (item) studyItem = item;
  document.getElementById("studyStatus").textContent = item.status === "pending" ? "标记为进行中" : item.status === "doing" ? "标记为已完成" : "重置为待研究";
  toast(`已标记为 ${item.status === "pending" ? "待研究" : item.status === "doing" ? "进行中" : "已完成"}`, "ok");
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
document.getElementById("studySave").addEventListener("click", async () => {
  if (!studyItem) return;
  const note = document.getElementById("studyNote").value.trim();
  try {
    const r = await fetch("/api/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: studyItem.id, note: note || "（待补充）" }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "保存失败");
    await httpLoad();
    toast("笔记已写回 README.md", "ok");
  } catch (e) {
    toast("保存失败：" + e.message, "err");
  }
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
  rows[idx].scrollIntoView({ block: "nearest" });
}
document.addEventListener("keydown", e => {
  if (document.getElementById("modal").classList.contains("open") ||
      document.getElementById("studyOverlay").classList.contains("open") ||
      document.getElementById("rollModal").classList.contains("open")) return;
  // ? 键打开快捷键面板（不区分大小写 + shift）
  if (e.key === "?" || (e.shiftKey && e.key === "/")) {
    e.preventDefault();
    document.getElementById("hotkeyModal").classList.toggle("open");
    return;
  }
  if (document.getElementById("hotkeyModal").classList.contains("open")) {
    if (e.key === "Escape") document.getElementById("hotkeyModal").classList.remove("open");
    return;
  }
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (!state.items.length) return;
  const k = e.key.toLowerCase();
  if (k === "j") { e.preventDefault(); kbdMove(1); }
  else if (k === "k") { e.preventDefault(); kbdMove(-1); }
  else if (k === "n") { document.getElementById("addBtn").click(); }
  else if (k === "r") { document.getElementById("rollBtn").click(); }
  else if (k === "e") {
    const row = kbdRow();
    if (row) {
      const item = state.items.find(i => i.id === row.dataset.id);
      if (item) openStudy(item);
    }
  } else if (k === "s") { openStats(); }
  else if (k === "/") { e.preventDefault(); document.getElementById("searchInput").focus(); }
  else if (e.key === "Enter") {
    const row = kbdRow();
    if (row) row.click();
  }
});
document.getElementById("hotkeyModal").addEventListener("click", e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
});

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

/* 属性 / 文本安全的 HTML 转义（含引号，用于 data-* / src / 文本节点）。
 * 全局已有 escapeHtml 仅转义 & < >，这里独立定义以避免影响 inline()。 */
function escapeAttr(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function openEntry(id) {
  currentEntryId = String(id);
  // 隐藏看板视图与列表视图，显示详情视图
  document.getElementById("listView").hidden = true;
  document.getElementById("boardView").hidden = true;
  document.getElementById("entryView").hidden = false;
  // 隐藏看板周边工具栏 / 横幅 / 统计条，制造全屏覆盖感
  const tr = document.getElementById("toolrow"); if (tr) tr.hidden = true;
  const sb = document.getElementById("statsbar"); if (sb) sb.hidden = true;
  const bn = document.getElementById("banner"); if (bn) bn.hidden = true;
  // 重置表单，避免显示上一条的残留
  document.getElementById("ssGrid").innerHTML =
    '<div class="ss-empty">加载中…</div>';

  fetch("/api/entry?id=" + encodeURIComponent(currentEntryId))
    .then(r => r.json())
    .then(({ ok, entry, error }) => {
      if (!ok) { toast(error || "加载失败", "error"); return; }
      document.getElementById("entryTitle").textContent = entry.title || "";
      document.getElementById("entryId").textContent = "#" + currentEntryId;
      const f = entry.fields || {};
      const form = document.getElementById("entryForm");
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
      renderSsGrid(currentEntryId, entry.screenshots || []);
      loadContentPreview(currentEntryId);
    })
    .catch(e => toast("网络错误: " + e.message, "error"));
}

/** 加载已抓取的正文预览 */
function loadContentPreview(id) {
  fetch("/api/entry/content?id=" + encodeURIComponent(id))
    .then(r => r.json())
    .then(({ ok, content, hasContent }) => {
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
    .catch(() => {});
}

function closeEntry() {
  document.getElementById("entryView").hidden = true;
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
  if (sb) sb.hidden = false;
  if (bn) bn.hidden = false;
  currentEntryId = null;
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

  // 抓取正文
  const scrapeBtn = document.getElementById("scrapeBtn");
  if (scrapeBtn) scrapeBtn.addEventListener("click", () => {
    if (!currentEntryId) return;
    const hint = document.getElementById("scrapeHint");
    if (hint) hint.textContent = "抓取中…";
    scrapeBtn.disabled = true;
    fetch("/api/entry/scrape", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: currentEntryId })
    }).then(r => r.json()).then(r => {
      scrapeBtn.disabled = false;
      if (r.ok) { toast("正文抓取成功"); loadContentPreview(currentEntryId); }
      else { toast("抓取未成功: " + (r.warning || r.error || "未知"), "error"); if (hint) hint.textContent = r.warning || "抓取失败，可稍后重试"; }
    }).catch(e => { scrapeBtn.disabled = false; toast("网络错误: " + e.message, "error"); });
  });

  // 保存档案
  const form = document.getElementById("entryForm");
  if (form) form.addEventListener("submit", e => {
    e.preventDefault();
    if (!currentEntryId) return;
    const fd = new FormData(e.target);
    const fields = Object.fromEntries(fd);
    fields.rating = Number(fields.rating);
    fields.recommendLevel = Number(fields.recommendLevel);
    fetch("/api/entry/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ id: currentEntryId }, fields))
    }).then(r => r.json()).then(r => {
      if (r.ok) toast("档案已保存");
      else toast("保存失败: " + (r.error || ""), "error");
    }).catch(e => toast("网络错误: " + e.message, "error"));
  });

  // 上传截图
  const ssUploadBtn = document.getElementById("ssUploadBtn");
  if (ssUploadBtn) ssUploadBtn.addEventListener("click", () => {
    if (!currentEntryId) return;
    const fileInput = document.getElementById("ssInput");
    if (!fileInput.files.length) { toast("请先选择图片", "error"); return; }
    const fd = new FormData();
    fd.append("file", fileInput.files[0]);
    fd.append("caption", document.getElementById("ssCaption").value);
    toast("上传中...");
    fetch("/api/entry/screenshot?id=" + encodeURIComponent(currentEntryId), {
      method: "POST", body: fd
    }).then(r => r.json()).then(r => {
      if (r.ok) {
        toast("截图已上传");
        fileInput.value = "";
        document.getElementById("ssCaption").value = "";
        openEntry(currentEntryId);
      } else {
        toast("上传失败: " + (r.error || ""), "error");
      }
    }).catch(e => toast("网络错误: " + e.message, "error"));
  });

  // 删除截图（事件委托）
  const ssGrid = document.getElementById("ssGrid");
  if (ssGrid) ssGrid.addEventListener("click", e => {
    const btn = e.target.closest(".ss-del");
    if (!btn || !currentEntryId) return;
    if (!confirm("删除这张截图?")) return;
    fetch("/api/entry/screenshot/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: currentEntryId, file: btn.dataset.file })
    }).then(r => r.json()).then(r => {
      if (r.ok) { toast("已删除"); openEntry(currentEntryId); }
      else toast("删除失败: " + (r.error || ""), "error");
    }).catch(e => toast("网络错误: " + e.message, "error"));
  });
});

// 卡片内联 onclick 需要全局作用域访问
window.openEntry = openEntry;

