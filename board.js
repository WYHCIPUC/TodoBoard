"use strict";

/* v2.2 可信恢复状态与请求合同。保持纯函数，供 DOM 测试和浏览器共用。 */
const TRUST_STATE_META = Object.freeze({
  healthy: { label: "数据健康", tone: "ok", action: "查看数据保护状态" },
  action_required: { label: "需要处理", tone: "warn", action: "查看并确认下一步" },
  locked: { label: "数据已锁定", tone: "warn", action: "查看占用状态" },
  ambiguous: { label: "候选不明确", tone: "danger", action: "明确选择恢复候选" },
  upgrade_required: { label: "需要升级", tone: "warn", action: "查看升级预检" },
  in_progress: { label: "正在验证", tone: "progress", action: "查看操作进度" },
  verified: { label: "恢复已验证", tone: "ok", action: "查看验证结果" },
  failed: { label: "恢复受阻", tone: "danger", action: "查看安全诊断" },
});

function normalizeTrustedState(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const state = Object.prototype.hasOwnProperty.call(TRUST_STATE_META, value.state) ? value.state : "failed";
  return {
    state,
    condition: TRUST_STATE_META[state],
    selection: ["none", "selected", "ambiguous"].includes(value.selection) ? value.selection : "none",
    transactions: Array.isArray(value.transactions) ? value.transactions : [],
    activeRecoveryImport: value.activeRecoveryImport || null,
    allowedActions: Array.isArray(value.allowedActions) ? value.allowedActions : [],
    confirmations: Array.isArray(value.confirmations) ? value.confirmations : [],
    maintenance: value.maintenance && typeof value.maintenance === "object" ? value.maintenance : { mode: "normal", activeMutations: 0 },
    verifiedAt: value.verifiedAt || null,
  };
}

function newRequestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = bytes[6] & 0x0f | 0x40;
  bytes[8] = bytes[8] & 0x3f | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function trustedMutationBody(values, requestId) {
  return JSON.stringify({ requestId: requestId || newRequestId(), ...(values || {}) });
}

function selectedRecoveryCandidate(status, targetKey) {
  const normalized = normalizeTrustedState(status);
  if (!targetKey) return null;
  for (const transaction of normalized.transactions) {
    for (const candidate of transaction.candidates || []) {
      if (transaction.transactionId + ":" + candidate.name === targetKey) {
        return { transactionId: transaction.transactionId, candidateName: candidate.name, candidate };
      }
    }
  }
  return null;
}

function recoveryConfirmation(status, action, targetKey) {
  const normalized = normalizeTrustedState(status);
  return normalized.confirmations.find(item => item.action === action && item.targetKey === targetKey) || null;
}

function trustedStateAnnouncement(status) {
  const normalized = normalizeTrustedState(status);
  const detail = normalized.state === "ambiguous" ? "。必须先选择一个完整候选并查看预览" :
    normalized.state === "in_progress" ? "。操作完成并通过写后验证前不会报告成功" : "";
  return normalized.condition.label + detail;
}

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
  { name: "收件箱", cls: "c-inbox" },
];

/* 归档状态是服务端持久化状态；保持这组文案与 API 合同一一对应。 */
const ARCHIVE_STATUS_META = Object.freeze({
  queued: { label: "排队中", tone: "queued", description: "等待归档处理" },
  running: { label: "归档中", tone: "running", description: "正在生成归档产物" },
  partial: { label: "部分完成", tone: "partial", description: "部分产物已保存" },
  succeeded: { label: "已归档", tone: "succeeded", description: "归档产物已完成" },
  failed: { label: "归档失败", tone: "failed", description: "可手动重试" },
  manual_required: { label: "需要手动补录", tone: "manual", description: "请提供 Markdown 或纯文本" },
  not_archived: { label: "未归档", tone: "queued", description: "尚未建立本地归档，可开始归档" },
});
const ARCHIVE_RETRY_STATES = new Set(["partial", "failed", "manual_required", "not_archived"]);

function normalizeArchiveStatus(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const state = Object.prototype.hasOwnProperty.call(ARCHIVE_STATUS_META, value.state)
    ? value.state : "queued";
  return {
    id: String(value.id || ""),
    state,
    attempt: Number.isFinite(Number(value.attempt)) ? Number(value.attempt) : 0,
    nextRunAt: value.nextRunAt || value.nextRetryAt || null,
    lastError: value.lastError || value.error || null,
    degradationReasons: Array.isArray(value.degradationReasons) ? value.degradationReasons : [],
  };
}

function archiveCanRetry(state) { return ARCHIVE_RETRY_STATES.has(state); }

function archiveTimeLabel(value) {
  if (!value) return "未安排";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未安排";
  return date.toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function archiveErrorLabel(value) {
  // 批量接口返回 { code, message }，逐条接口返回字符串；两种都要可读。
  const text = value && typeof value === "object" ? (value.message || value.code || value.error || "") : value;
  return String(text || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function archiveRetryRequest(id) {
  return {
    url: "/api/archive/retry",
    options: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: String(id) }) },
  };
}

function manualContentRequest(id, content) {
  return {
    url: "/api/entry/content",
    options: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: String(id), content }) },
  };
}

function archiveResponseState(previous, response) {
  const current = normalizeArchiveStatus(previous);
  if (!response || response.ok === false) return { archive: current, recovered: true };
  return { archive: normalizeArchiveStatus(response.archive || { id: current.id, state: "queued" }), recovered: true };
}

/* 待处理原因与回顾周期共用同一套展示语义，避免 UI 与服务端 code 漂移。 */
const ATTENTION_REASON_META = Object.freeze({
  archive_blocked: { label: "归档待处理", tone: "danger" },
  review_due: { label: "回顾到期", tone: "warn" },
  open_action: { label: "未完成行动项", tone: "info" },
  stalled: { label: "研究停滞", tone: "warn" },
  unresearched: { label: "未研究", tone: "info" },
  lifecycle_missing: { label: "缺少创建时间", tone: "muted" },
});

function attentionReasonLabel(code) {
  return (ATTENTION_REASON_META[code] || { label: String(code || "待处理") }).label;
}

function reviewDateValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = number => String(number).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

/* 日期输入按本地日终点转成规范 UTC；早于当前时间或格式非法时返回空串。 */
function reviewTargetIso(value, now) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999);
  if (!Number.isFinite(target.getTime())) return "";
  return target.getTime() > (now === undefined ? Date.now() : now) ? target.toISOString() : "";
}

function reviewRelativeLabel(value, now) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "未安排";
  const current = now === undefined ? Date.now() : now;
  if (time < current) return "已到期";
  const days = Math.ceil((time - current) / 86400000);
  if (days === 0) return "今天到期";
  return days + " 天后";
}

function lifecycleDayLabel(value) {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未记录" : date.toLocaleDateString("zh-CN");
}

/* 把批量归档状态合并回条目；服务端状态永远覆盖本地默认值，缺失条目保持原样。 */
function applyArchiveStatuses(items, statuses) {
  const byId = new Map();
  for (const status of statuses || []) {
    if (!status || status.id === undefined || status.id === null) continue;
    byId.set(String(status.id), status);
  }
  let applied = 0;
  for (const item of items) {
    const status = byId.get(String(item.id));
    if (!status) continue;
    item.archive = normalizeArchiveStatus(status);
    applied++;
  }
  return applied;
}

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
  "收件箱": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="M4 13h5l2 3h2l2-3h5"/></svg>',
};
const catCls = name => (CATS.find(c => c.name === name) || CATS.find(c => c.name === "其他")).cls;
const catNo = name => Math.max(1, CATS.findIndex(c => c.name === name) + 1);

const STATUS = {
  "⏳": { key: "pending", label: "待研究" },
  "🔄": { key: "doing",  label: "进行中" },
  "✅": { key: "done",   label: "已完成" },
};

const DEMO_MODE = (() => {
  try {
    return new URLSearchParams(window.location.search).get("demo") === "1" || window.location.hostname.endsWith(".github.io");
  } catch (_) { return false; }
})();

const CAT_TEXTURES = {
  "AI 工具": (c) => `<circle cx="20" cy="20" r="3" fill="${c}"/><circle cx="80" cy="20" r="3" fill="${c}"/><circle cx="50" cy="60" r="3" fill="${c}"/><circle cx="20" cy="100" r="3" fill="${c}"/><circle cx="80" cy="100" r="3" fill="${c}"/><path d="M20 20 L80 20 L50 60 L20 100 L80 100" fill="none" stroke="${c}" stroke-width="1" opacity="0.5"/>`,
  "硬件 & 嵌入式": (c) => `<path d="M10 30 h40 v40 h40" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M90 30 h20 v60 h-40" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.6"/><circle cx="10" cy="30" r="3" fill="${c}"/><circle cx="90" cy="70" r="3" fill="${c}"/>`,
  "前端 & 设计": (c) => `<rect x="10" y="10" width="70" height="70" fill="none" stroke="${c}" stroke-width="1.5"/><rect x="30" y="30" width="50" height="50" fill="${c}" opacity="0.15"/><circle cx="90" cy="20" r="8" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  "桌面 & 系统": (c) => `<rect x="10" y="20" width="80" height="60" fill="none" stroke="${c}" stroke-width="1.5"/><rect x="10" y="20" width="80" height="12" fill="${c}" opacity="0.15"/><circle cx="18" cy="26" r="1.5" fill="${c}"/>`,
  "开源项目 & 开发": (c) => `<path d="M10 30 h50 M10 45 h70 M10 60 h40 M10 75 h60" stroke="${c}" stroke-width="1.5" fill="none"/><circle cx="85" cy="30" r="3" fill="${c}"/>`,
  "搜索 & OSINT": (c) => `<circle cx="50" cy="60" r="12" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="50" cy="60" r="26" fill="none" stroke="${c}" stroke-width="1" opacity="0.6"/><circle cx="50" cy="60" r="40" fill="none" stroke="${c}" stroke-width="0.8" opacity="0.35"/><path d="M50 60 L70 40" stroke="${c}" stroke-width="1.5"/>`,
  "教程 & 资源": (c) => `<rect x="30" y="10" width="50" height="80" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M38 24 h34 M38 38 h34 M38 52 h22" stroke="${c}" stroke-width="1.2"/>`,
  "其他": (c) => `<circle cx="25" cy="25" r="2.5" fill="${c}"/><circle cx="75" cy="25" r="2.5" fill="${c}"/><circle cx="25" cy="75" r="2.5" fill="${c}"/><circle cx="75" cy="75" r="2.5" fill="${c}"/><circle cx="50" cy="50" r="2.5" fill="${c}"/>`,
  "收件箱": (c) => `<path d="M15 25h70v55H15z M15 55h22l8 12h10l8-12h22" fill="none" stroke="${c}" stroke-width="1.5"/>`,
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
  "收件箱": { d: "#f0abfc", l: "#a21caf", a: "#e879f9", f: "#d8b4fe" },
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
  demoMode: DEMO_MODE,
  serviceStatus: "connecting",
  serviceReachable: false,
  dataName: "数据文件",  // 数据文件名（服务模式来自 /api/data 的 name，如 DATA.md）
  listAnim: false,
  lastNewId: null,
  dailyShown: new Set(),
  deepMatchIds: null,
  fold: {},  // 分组折叠：{分类名: true=折叠}
};

/* ============================================================
 * Markdown 解析
 * ============================================================ */
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
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
  if (/收件箱|Inbox/i.test(t)) return "收件箱";
  if (/AI|Agent|智能/.test(t)) return "AI 工具";
  if (/硬件|嵌入式|DIY/.test(t)) return "硬件 & 嵌入式";
  if (/设计|前端|网页/.test(t)) return "前端 & 设计";
  if (/软件|工具|桌面/.test(t)) return "桌面 & 系统";
  if (/开源|开发/.test(t)) return "开源项目 & 开发";
  if (/搜索|OSINT/.test(t)) return "搜索 & OSINT";
  if (/教程|资源/.test(t)) return "教程 & 资源";
  if (/其他/.test(t)) return "其他";
  return String(t || "").replace(/^\s*\d+\.\s*/, "").replace(/^[^\p{L}\p{N}]+/u, "").trim() || "其他";
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
        fields: [], desc: "", url: null, image: null, difficulty: 0, tags: [],
        lifecycle: { createdAt: null, lastStudiedAt: null, nextReviewAt: null },
        archive: normalizeArchiveStatus({ id: head[2] }),
      };
      items.push(cur);
      continue;
    }
    const life = line.match(/^<!--\s*linggan:(created-at|last-studied-at|next-review-at)=([^\s]+)\s*-->/);
    if (life && cur) {
      const key = { "created-at": "createdAt", "last-studied-at": "lastStudiedAt", "next-review-at": "nextReviewAt" }[life[1]];
      if (key) cur.lifecycle[key] = life[2];
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
      else if (key.includes("标签")) cur.tags = val.split(/[,，]/).map(x => x.trim()).filter(Boolean);
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
    const fields = it.fields.map(field => field.k + " " + field.v).join(" ");
    const localMatch = (it.name + " " + it.desc + " " + it.id + " " + it.category + " " + fields).toLowerCase().includes(q);
    return localMatch || (state.deepMatchIds && state.deepMatchIds.has(it.id));
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
function archiveStatus(item) { return normalizeArchiveStatus(item.archive); }
function archiveStatusHtml(item, compact) {
  const archive = archiveStatus(item);
  const meta = ARCHIVE_STATUS_META[archive.state];
  const error = archiveErrorLabel(archive.lastError);
  const next = archive.nextRunAt ? `下次重试：${archiveTimeLabel(archive.nextRunAt)}` : "暂无下次重试时间";
  const detail = `${error ? `最近错误：${error}` : meta.description} · ${next}`;
  return `<span class="archive-badge archive-${meta.tone}" role="status" aria-label="归档状态：${escapeAttr(meta.label)}">${escapeHtml(meta.label)}</span>` +
    (compact ? "" : `<span class="archive-detail" title="${escapeAttr(detail)}">${escapeHtml(detail)}</span>`);
}
function archiveControlsHtml(item) {
  const archive = archiveStatus(item);
  const retryLabel = archive.state === "not_archived" ? "开始归档" : "重试归档";
  const retry = archiveCanRetry(archive.state)
    ? `<button type="button" class="archive-action archive-retry" data-archive-action="retry" data-id="${escapeAttr(item.id)}">${retryLabel}</button>` : "";
  const manual = archive.state === "manual_required"
    ? `<button type="button" class="archive-action" data-archive-action="manual" data-id="${escapeAttr(item.id)}">补录内容</button>` : "";
  const integrity = `<button type="button" class="archive-action" data-archive-action="integrity" data-id="${escapeAttr(item.id)}">校验归档</button>`;
  return retry + manual + integrity;
}
function archivePanelHtml(item) {
  const archive = archiveStatus(item);
  const meta = ARCHIVE_STATUS_META[archive.state];
  const error = archiveErrorLabel(archive.lastError);
  const reason = archive.degradationReasons.map(archiveErrorLabel).filter(Boolean).join("；");
  return `<section class="archive-panel archive-${meta.tone}" aria-label="归档状态详情">
    <div class="archive-panel-head"><div>${archiveStatusHtml(item)}</div><span class="archive-attempt">第 ${archive.attempt} 次尝试</span></div>
    <p class="archive-panel-copy">${escapeHtml(meta.description)} · 下次重试：${escapeHtml(archiveTimeLabel(archive.nextRunAt))}</p>
    ${error ? `<p class="archive-error">最近错误：${escapeHtml(error)}</p>` : ""}
    ${reason ? `<p class="archive-reason">处理说明：${escapeHtml(reason)}</p>` : ""}
    <p class="archive-raw-note">原始 HTML 超过 20 MB 时仅跳过 raw.html.gz，其余归档产物仍会保留。</p>
    ${integrityResultHtml(item.id)}
    <div class="archive-controls" data-id="${escapeAttr(item.id)}">${archiveControlsHtml(item)}</div>
  </section>`;
}
function diffBadge(item) {
  return item.difficulty ? `<span class="badge diff">${"★".repeat(item.difficulty)}</span>` : "";
}
function catBadge(item) {
  // 行内只看图标（颜色已隐含分类，悬停 title 看全名）
  const icon = CAT_ICONS[item.category] || "";
  return `<span class="badge cat ${catCls(item.category)}" title="${escapeAttr(item.category)}"><span class="cat-icon">${icon}</span></span>`;
}
function thumbHtml(item) {
  // 统一用分类 SVG 图标作缩略图（移除首字母占位与远程封面图，避免隐私泄露与加载延迟）
  const icon = CAT_ICONS[item.category] || CAT_ICONS["其他"] || "";
  return `<div class="thumb ${catCls(item.category)}"><span class="cat-icon">${icon}</span></div>`;
}
function detailRows(item) {
  return item.fields.filter(f => !f.k.includes("简介") && !f.k.includes("封面")).map(f =>
    `<div class="df"><span class="k">${escapeHtml(f.k)}</span><span class="v">${inline(f.v)}</span></div>`).join("");
}

function rowHtml(item) {
  const src = item.url ? domain(item.url) : "-";
  const nextStatus = item.status === "pending" ? "进行中" : item.status === "doing" ? "已完成" : "待研究";
  return `
  <article class="row ${catCls(item.category)}" data-id="${item.id}" role="listitem" tabindex="0">
    <input type="checkbox" class="pick" data-pick="${item.id}" aria-label="选择 ${item.id}" title="选择">
    <span class="id">${item.id}</span>
    ${thumbHtml(item)}
    <span class="name"><span class="txt" title="${escapeAttr(item.name)}">${inline(item.name)}</span></span><span class="cat-slot">${catBadge(item)}</span><span class="difficulty">${diffBadge(item)}</span>
    <span class="src"><a href="${escapeAttr(item.url || "#")}" target="${item.url ? "_blank" : "_self"}" rel="noopener" title="${escapeAttr(item.url || "")}">${escapeHtml(src)}</a></span>
    <span class="status ${statusCls(item)}">${statusLabel(item)}<span class="archive-inline">${archiveStatusHtml(item, true)}</span></span>
    <button type="button" class="row-disclosure chev" aria-expanded="false" aria-controls="detail-${item.id}" aria-label="展开 ${escapeAttr(item.name)} 的详情"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
  </article>
  <div class="detail-panel" id="detail-${item.id}" data-for="${item.id}" aria-hidden="true" inert><div class="dp-inner"><div class="dp-body">
    ${detailRows(item)}
    ${archivePanelHtml(item)}
    <div class="dp-actions" data-id="${item.id}">
      <button type="button" class="dp-act" data-act="study" title="研究档案：笔记 / 抓取正文 / 计时">🔬 研究</button>
      <button type="button" class="dp-act" data-act="open" title="在新标签打开原文"${item.url ? "" : " disabled"}>↗ 原文</button>
      <button type="button" class="dp-act" data-act="status" title="更新为${nextStatus}">→ ${nextStatus}</button>
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
    else if (state.items.length === 0) { t = "从第一条收藏开始"; d = "粘贴一个链接，工作台会先保存线索，再自动解析和留存内容。"; }
    const captureAction = state.items.length === 0 && state.httpMode
      ? '<button type="button" class="btn primary empty-capture" data-empty-capture>＋ 收藏第一条内容</button>' : "";
    el.innerHTML = `<div class="empty"><div class="em-t">${escapeHtml(t)}</div><div class="em-d">${escapeHtml(d)}</div>${captureAction}</div>`;
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
        out.push(`<div class="cat-fold" data-fold="${escapeAttr(it.category)}">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
          ${escapeHtml(it.category)} <span class="cnt">${cnt}</span> 项已折叠（双击分类名展开）
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
      r.style.animationDelay = Math.min(i, 5) * 16 + "ms";
      const panel = r.nextElementSibling;
      if (panel && panel.classList.contains("detail-panel")) panel.style.animationDelay = Math.min(i, 5) * 16 + "ms";
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
  const icon = CAT_ICONS[item.category] || CAT_ICONS["其他"] || "";
  const ph = `<div class="ph"><span class="ph-icon">${icon}</span><span class="ph-label">${escapeHtml(item.category)}</span></div>`;
  return `<div class="cover ${catCls(item.category)}">
    ${item.image ? `<img src="${escapeAttr(item.image)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : ph}
    <span class="stt ${stCls}">${statusLabel(item)}</span>
  </div>`;
}

function cardHtml(item) {
  const src = item.url ? domain(item.url) : "-";
  const detailId = "card-detail-" + String(item.id).replace(/[^a-zA-Z0-9_-]/g, "-");
  return `
  <article class="card ${catCls(item.category)}" data-id="${item.id}" role="listitem">
    <svg class="corner-mark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2 L14.8 8.6 L22 11 L14.8 13.4 L12 22 L9.2 13.4 L2 11 L9.2 8.6 Z"/>
    </svg>
    ${coverHtml(item)}
    <div class="body">
      <div class="card-kicker"><span>${escapeHtml(item.id)}</span><span>${escapeHtml(item.category)}</span></div>
      <div class="nm">${inline(item.name)}</div>
      <div class="bdg">${catBadge(item)}${diffBadge(item)}${archiveStatusHtml(item, true)}</div>
      <div class="archive-card-meta">${archiveStatusHtml(item)}</div>
      ${item.desc ? `<div class="ds">${inline(item.desc)}</div>` : ""}
      <div class="detail" id="${detailId}" aria-hidden="true" inert><div class="di"><div class="di-in">${detailRows(item)}</div></div></div>
      <div class="archive-controls" data-id="${escapeAttr(item.id)}">${archiveControlsHtml(item)}</div>
      <div class="ft">
        <span class="sr"><a href="${escapeAttr(item.url || "#")}" target="${item.url ? "_blank" : "_self"}" rel="noopener" title="${escapeAttr(item.url || "")}">${escapeHtml(src)}</a></span>
        <button type="button" class="card-disclosure" aria-expanded="false" aria-controls="${detailId}" aria-label="展开 ${escapeAttr(item.name)} 的详情">查看详情</button>
        <button type="button" class="study-btn" data-entry-id="${escapeAttr(item.id)}">研究档案</button>
      </div>
    </div>
  </article>`;
}

function renderBoard(list) {
  document.getElementById("boardView").innerHTML = list.length
    ? list.map(cardHtml).join("") : `<div class="empty">暂无匹配条目</div>`;
}

let lastBannerMotionKey = null;
function renderBanner(list) {
  const inner = document.getElementById("bannerInner");
  const cat = state.category;
  const color = cat ? catColor(cat) : "#e8a33d";
  inner.classList.remove(...CATS.map(c => c.cls));
  inner.classList.add(cat ? catCls(cat) : "c-ai");
  inner.style.setProperty("--cat", color);
  const texture = cat ? (CAT_TEXTURES[cat] || CAT_TEXTURES["其他"]) : CAT_TEXTURES["AI 工具"];
  document.getElementById("bannerSvg").innerHTML = texture(color);
  if (cat) {
    document.getElementById("bannerTitle").textContent = cat;
    document.getElementById("bannerSub").textContent = `查看该分类中的 ${list.length} 个项目，继续研究或带入头脑风暴`;
  } else {
    document.getElementById("bannerTitle").textContent = "灵感来袭";
    document.getElementById("bannerSub").textContent = "先把灵感可靠收进来，再在本机整理、研究并推进为结论";
  }
  document.getElementById("brainstormBridgeLabel").textContent = cat
    ? `基于“${cat}”项目生成方案`
    : "基于当前项目生成方案";
  const np = list.filter(i => i.status === "pending").length;
  const nd = list.filter(i => i.status === "doing").length;
  const nf = list.filter(i => i.status === "done").length;
  const progress = completionProgress(list.length, nf, nd);
  document.getElementById("bannerBadges").innerHTML =
    `<span class="pill">待研究 <b>${np}</b></span><span class="pill">进行中 <b>${nd}</b></span><span class="pill">已完成 <b>${nf}</b></span>`;
  document.getElementById("bannerNum").innerHTML = `${list.length}<small>ITEMS</small>`;
  document.getElementById("bannerProgressLabel").textContent = `研究推进 ${progress}%`;
  document.getElementById("bannerProgressMeta").textContent = progress === 0 ? "从一条灵感开始" : progress === 100 ? "本组已全部完成" : `${nd + nf} / ${list.length} 已推进`;
  document.getElementById("bannerProgressBar").style.setProperty("--progress", String(progress / 100));
  document.getElementById("bannerProgressTrack").setAttribute("aria-valuenow", String(progress));
  // 仅在分类真正变化时重播，避免每次数据刷新都强制同步布局。
  const bwrap = inner.querySelector(".bwrap");
  const motionKey = cat || "__all__";
  if (bwrap && lastBannerMotionKey !== null && lastBannerMotionKey !== motionKey && !prefersReduce()) {
    [...bwrap.children].forEach((child, index) => {
      child.getAnimations().forEach(animation => animation.cancel());
      child.animate(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 220, delay: index * 24, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
      );
    });
  }
  lastBannerMotionKey = motionKey;
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
const numberAnimationFrames = new WeakMap();
function animateNum(el, target) {
  const cur = parseInt(el.textContent.replace(/\D/g, ""), 10) || 0;
  if (cur === target) return;
  const previousFrame = numberAnimationFrames.get(el);
  if (previousFrame) cancelAnimationFrame(previousFrame);
  if (prefersReduce()) {
    el.textContent = target;
    return;
  }
  const t0 = performance.now(), dur = 220;
  function tick(t) {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(cur + (target - cur) * e);
    if (p < 1) numberAnimationFrames.set(el, requestAnimationFrame(tick));
    else numberAnimationFrames.delete(el);
  }
  numberAnimationFrames.set(el, requestAnimationFrame(tick));
}

function completionProgress(total, done, doing) {
  return total ? Math.round((done + doing * 0.5) / total * 100) : 0;
}

function render() {
  const list = filtered();
  const nTotal = list.length;
  const nPending = list.filter(i => i.status === "pending").length;
  const nDoing = list.filter(i => i.status === "doing").length;
  const nDone = list.filter(i => i.status === "done").length;
  const progress = completionProgress(nTotal, nDone, nDoing);
  animateNum(document.getElementById("nTotal"), nTotal);
  animateNum(document.getElementById("nPending"), nPending);
  animateNum(document.getElementById("nDoing"), nDoing);
  animateNum(document.getElementById("nDone"), nDone);
  document.getElementById("subTotal").textContent = `共 ${nTotal} 条 · 完成 ${progress}%`;
  document.getElementById("progressBar").style.setProperty("--progress", String(progress / 100));
  document.getElementById("progressTrack").setAttribute("aria-valuenow", String(progress));

  const isBoard = state.view === "board";
  document.getElementById("listView").hidden = isBoard;
  document.getElementById("boardView").hidden = !isBoard;
  document.getElementById("viewSwitch").querySelectorAll("button").forEach(b => {
    const active = b.dataset.view === state.view;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
  if (isBoard) renderBoard(list); else renderList(list);
  renderBanner(list);
  renderDaily(list);
  if (productView === "relationship") renderRelationship();
  syncSlider();
  reconcilePicked(list.map(item => item.id));
  syncPicked();
  updateSortHead();
  refreshMotionVisibility();
}

/* ============================================================
 * Toast
 * ============================================================ */
let toastTimer = null;
function toast(msg, type) {
  const el = document.getElementById("toast");
  const urgent = type === "err";
  el.setAttribute("role", urgent ? "alert" : "status");
  el.setAttribute("aria-live", urgent ? "assertive" : "polite");
  el.textContent = msg;
  el.className = "toast " + (type || "ok") + " show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

/* ============================================================
 * 数据加载 + 浏览器自动备份
 * ============================================================ */
let backupInfo = null;
let brainstormLastAnalysis = null;
let httpLoadSequence = 0;
let httpLoadController = null;

/* 会话 Cookie 因浏览器恢复或服务升级失效时，安全续期并只重放一次未执行的 API 请求。 */
async function localApiFetch(url, options = {}) {
  const normalized = Object.assign({ credentials: "same-origin" }, options);
  const method = String(normalized.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const headers = new Headers(normalized.headers || {});
    if (!headers.has("Idempotency-Key")) headers.set("Idempotency-Key", newRequestId());
    normalized.headers = headers;
  }
  let response = await fetch(url, normalized);
  if (response.status !== 401 || state.demoMode) return response;
  const renewed = await fetch("/", { cache: "no-store", credentials: "same-origin" });
  if (!renewed.ok) return response;
  response = await fetch(url, normalized);
  return response;
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    if (!Object.prototype.hasOwnProperty.call(button.dataset, "idleLabel")) {
      button.dataset.idleLabel = button.textContent;
    }
    if (label) button.textContent = label;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    return;
  }
  if (Object.prototype.hasOwnProperty.call(button.dataset, "idleLabel")) {
    button.textContent = button.dataset.idleLabel;
    delete button.dataset.idleLabel;
  }
  button.removeAttribute("aria-busy");
  button.disabled = false;
}

let trustedStatus = normalizeTrustedState({ state: "in_progress" });
let recoveryPreviewTarget = null;
let trustedLoadSequence = 0;

function renderTrustedRail(status) {
  const current = normalizeTrustedState(status);
  const rail = document.getElementById("trustRail");
  if (!rail) return current;
  rail.dataset.state = current.state;
  document.getElementById("trustRailTitle").textContent = current.condition.label;
  document.getElementById("trustRailDetail").textContent = trustedStateAnnouncement(current);
  const button = document.getElementById("trustCenterBtn");
  button.textContent = current.condition.action;
  button.setAttribute("aria-label", current.condition.action + "，当前状态：" + current.condition.label);
  return current;
}

function recoveryFailure(message) {
  const error = document.getElementById("recoveryError");
  error.textContent = String(message || "恢复状态读取失败").slice(0, 500);
  error.hidden = false;
  error.focus({ preventScroll: true });
  requestAnimationFrame(() => error.focus({ preventScroll: true }));
}

function renderRecoveryCenter(status) {
  const current = renderTrustedRail(status);
  const title = document.getElementById("recoveryTitle");
  const summary = document.getElementById("recoverySummary");
  const stateBox = document.getElementById("recoveryStatus");
  const list = document.getElementById("recoveryCandidateList");
  if (!title || !summary || !stateBox || !list) return current;
  title.textContent = current.condition.label;
  summary.textContent = trustedStateAnnouncement(current) + "。不会自动猜测恢复候选，也不会在写后验证完成前报告成功。";
  stateBox.innerHTML = `<strong>${escapeHtml(current.condition.label)}</strong>` +
    `<span>维护模式：${escapeHtml(current.maintenance.mode || "normal")} · 在途写入：${Number(current.maintenance.activeMutations || 0)}</span>`;
  const candidates = [];
  for (const transaction of current.transactions) {
    for (const candidate of transaction.candidates || []) {
      candidates.push({ transactionId: transaction.transactionId, state: transaction.state, candidate });
    }
  }
  list.innerHTML = candidates.length ? candidates.map(item => {
    const targetKey = item.transactionId + ":" + item.candidate.name;
    const selected = recoveryPreviewTarget === targetKey;
    return `<label class="recovery-candidate"><input type="radio" name="recoveryCandidate" value="${escapeAttr(targetKey)}" ${selected ? "checked" : ""}>` +
      `<span><strong>${escapeHtml(item.candidate.name)}</strong><small>${escapeHtml(item.state)} · ${escapeHtml((item.candidate.completeScopes || []).join(" / "))}</small></span>` +
      `<code>${escapeHtml(String(item.candidate.fingerprint || "").slice(0, 12))}</code></label>`;
  }).join("") : '<p class="recovery-empty">当前没有需要选择的恢复候选。</p>';
  const selected = selectedRecoveryCandidate(current, recoveryPreviewTarget);
  document.getElementById("recoveryPreviewBtn").disabled = !selected;
  document.getElementById("recoveryConfirmBtn").disabled = !selected || !recoveryConfirmation(current, "restore-old", recoveryPreviewTarget);
  return current;
}

async function loadTrustedState(options = {}) {
  const sequence = ++trustedLoadSequence;
  try {
    const response = await localApiFetch("/api/recovery/status", { cache: "no-store" });
    const data = await readJsonResponse(response);
    if (sequence !== trustedLoadSequence) return trustedStatus;
    trustedStatus = normalizeTrustedState(data);
    renderRecoveryCenter(trustedStatus);
    document.getElementById("recoveryError").hidden = true;
    return trustedStatus;
  } catch (error) {
    if (sequence !== trustedLoadSequence) return trustedStatus;
    trustedStatus = normalizeTrustedState({ state: "failed" });
    renderRecoveryCenter(trustedStatus);
    if (options.focusError) recoveryFailure(error.message);
    return trustedStatus;
  }
}

async function openRecoveryCenter() {
  if (!requireService("查看可信恢复状态")) return;
  const modal = document.getElementById("recoveryModal");
  recoveryPreviewTarget = null;
  document.getElementById("recoveryPreview").hidden = true;
  document.getElementById("recoveryError").hidden = true;
  modal.classList.add("open");
  await loadTrustedState({ focusError: true });
}

async function previewSelectedRecovery() {
  const selected = selectedRecoveryCandidate(trustedStatus, recoveryPreviewTarget);
  if (!selected) { recoveryFailure("请先明确选择一个恢复候选。"); return; }
  const button = document.getElementById("recoveryPreviewBtn");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const response = await localApiFetch("/api/recovery/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: selected.transactionId, candidateName: selected.candidateName }),
    });
    const data = await readJsonResponse(response);
    document.getElementById("recoveryPreviewText").textContent = [
      "候选：" + data.candidate.name,
      "代类型：" + data.candidate.kind,
      "完整范围：" + data.candidate.completeScopes.join("、"),
      "状态指纹：" + data.candidate.fingerprint,
      "磁盘修改：否",
    ].join("\n");
    document.getElementById("recoveryPreview").hidden = false;
    await loadTrustedState({ focusError: true });
  } catch (error) { recoveryFailure(error.message); }
  finally { button.removeAttribute("aria-busy"); button.disabled = !selectedRecoveryCandidate(trustedStatus, recoveryPreviewTarget); }
}

async function confirmSelectedRecovery() {
  const selected = selectedRecoveryCandidate(trustedStatus, recoveryPreviewTarget);
  const confirmation = recoveryConfirmation(trustedStatus, "restore-old", recoveryPreviewTarget);
  if (!selected || !confirmation || document.getElementById("recoveryPreview").hidden) {
    recoveryFailure("必须先查看当前候选的只读预览。");
    return;
  }
  const button = document.getElementById("recoveryConfirmBtn");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const response = await localApiFetch("/api/recovery/restore-old", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: trustedMutationBody({ transactionId: selected.transactionId, candidateName: selected.candidateName, confirmationToken: confirmation.token }),
    });
    const data = await readJsonResponse(response);
    if (!data.verified || data.receipt !== "committed") throw new Error("服务端未返回写后验证收据");
    recoveryPreviewTarget = null;
    document.getElementById("recoveryPreview").hidden = true;
    await loadTrustedState({ focusError: true });
    await httpLoad();
    toast("已恢复并通过写后验证", "ok");
  } catch (error) { recoveryFailure(error.message); }
  finally { button.removeAttribute("aria-busy"); }
}

document.getElementById("trustCenterBtn").addEventListener("click", openRecoveryCenter);
document.getElementById("recoveryRefreshBtn").addEventListener("click", () => loadTrustedState({ focusError: true }));
document.getElementById("recoveryCandidateList").addEventListener("change", event => {
  const input = event.target.closest('input[name="recoveryCandidate"]');
  if (!input) return;
  recoveryPreviewTarget = input.value;
  document.getElementById("recoveryPreview").hidden = true;
  document.getElementById("recoveryConfirmBtn").disabled = true;
  document.getElementById("recoveryPreviewBtn").disabled = false;
});
document.getElementById("recoveryPreviewBtn").addEventListener("click", previewSelectedRecovery);
document.getElementById("recoveryConfirmBtn").addEventListener("click", confirmSelectedRecovery);

function setServiceState(status) {
  const states = {
    connecting: { label: "连接中", title: "正在连接本地服务", dot: "loading" },
    online: { label: "本地已保存", title: "服务正常，修改会写入本地数据", dot: "ok" },
    demo: { label: "在线演示", title: "公共示例数据，只读体验；点击查看说明", dot: "ok" },
    "offline-cache": { label: "只读备份", title: "服务未连接，当前显示浏览器缓存；点击重试", dot: "err" },
    "data-error": { label: "数据异常", title: "服务可访问，但数据读取失败；点击重试", dot: "err" },
    file: { label: "只读文件", title: "当前是手动选择的只读文件；点击连接本地服务", dot: "err" },
    offline: { label: "服务未连接", title: "点击重新连接本地服务", dot: "err" },
  };
  const current = states[status] || states.offline;
  state.serviceStatus = status;
  state.httpMode = status === "online";
  const control = document.getElementById("svcState");
  const dot = document.getElementById("svcDot");
  control.dataset.status = status;
  control.title = current.title;
  control.setAttribute("aria-label", current.title);
  document.getElementById("svcLabel").textContent = current.label;
  dot.classList.remove("ok", "err", "loading");
  dot.classList.add(current.dot);
  document.body.classList.toggle("is-readonly", !state.httpMode);
  document.body.classList.toggle("is-demo", state.demoMode);
  document.querySelectorAll("[data-capture-trigger]").forEach(button => {
    if (!button.dataset.captureTitle) button.dataset.captureTitle = button.title || "收藏内容";
    button.disabled = !state.httpMode;
    button.title = state.httpMode ? button.dataset.captureTitle : "需要连接本地服务后收藏内容";
  });
  const brainstormSaveButton = document.getElementById("brainstormSaveBtn");
  if (brainstormSaveButton) brainstormSaveButton.disabled = !state.httpMode || !brainstormLastAnalysis;
  document.querySelectorAll("#bulkbar button").forEach(button => { button.disabled = !state.httpMode; });
}

function requireService(action) {
  if (state.httpMode) return true;
  if (state.demoMode) {
    toast(`${action || "该操作"}需要本地版；在线 Demo 不会保存修改`, "err");
    return false;
  }
  toast(`${action || "该操作"}需要连接本地服务；当前内容为只读`, "err");
  return false;
}

function setLoaded(show) {
  document.getElementById("statsbar").hidden = true;
  document.getElementById("toolrow").hidden = !show;
  document.getElementById("meta").hidden = true;
  document.getElementById("banner").hidden = !show;
  document.getElementById("emptyState").classList.toggle("show", !show);
}

function applyText(text, name, via, fromBackup) {
  state.items = parseMarkdown(text);
  state.listAnim = true;
  const restoreBtn = fromBackup && state.serviceReachable
    ? '<button type="button" data-restore-backup>恢复文件</button>' : "";
  const meta = document.getElementById("meta");
  meta.innerHTML = fromBackup
    ? `<span class="bak-warn">⚠ 当前显示浏览器备份，源文件可能丢失 ${restoreBtn}</span>`
    : "";
  document.getElementById("fname").textContent = name;
  document.getElementById("footerFile").textContent = "FILE: " + name;
  document.getElementById("reloadBtn").hidden = false;
  try { localStorage.setItem("last_board_file", name); } catch (_) {}
  setLoaded(true);
  meta.hidden = !fromBackup;
  buildCats();
  render();
  updateEmpty();
}
document.getElementById("meta").addEventListener("click", e => {
  if (e.target.closest("[data-restore-backup]")) restoreFromBackup();
});

/* - 空态文案分场景 - */
function updateEmpty() {
  const t = document.getElementById("emptyTitle");
  const d = document.getElementById("emptyDesc");
  const btn = document.getElementById("emptyPickBtn");
  if (state.httpMode) {
    t.textContent = "从第一条收藏开始";
    d.textContent = "粘贴链接后会先保存线索，再自动解析并创建本地内容备份。";
    btn.textContent = "收藏第一条内容";
  } else {
    t.textContent = `加载 ${state.dataName} 开始`;
    d.textContent = `不要直接双击 board.html。便携版请双击 start-portable.bat，源码版请双击 start.bat；也可以在下方手动选择 Markdown 文件只读浏览。`;
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
  const sequence = ++httpLoadSequence;
  if (httpLoadController) httpLoadController.abort();
  httpLoadController = new AbortController();
  setServiceState("connecting");
  state.serviceReachable = false;
  try {
    const r = await localApiFetch("/api/data", { cache: "no-store", signal: httpLoadController.signal });
    state.serviceReachable = true;
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    if (sequence !== httpLoadSequence) return false;
    if (!d.ok || !d.content) throw new Error("bad data");
    state.dataName = d.name || "数据文件";
    setServiceState("online");
    applyText(d.content, d.name, "服务模式");
    loadTrustedState();
    loadArchiveStatuses(state.items);
    loadAttention();
    setTimeout(maybeShowOnboarding, 180);
    const now = Date.now();
    await idbSet("backup", "readme", { name: d.name, content: d.content, time: now });
    backupInfo = { time: fmtTime(now) };
    return true;
  } catch (e) {
    if (e.name === "AbortError" || sequence !== httpLoadSequence) return false;
    state.httpMode = false;
    renderTrustedRail({ state: "failed" });
    const bak = await idbGet("backup", "readme");
    if (bak) {
      setServiceState(state.serviceReachable ? "data-error" : "offline-cache");
      applyText(bak.content, bak.name, "浏览器备份（服务未运行）", true);
      backupInfo = { time: fmtTime(bak.time) };
      return true;
    }
    setServiceState(state.serviceReachable ? "data-error" : "offline");
    return false;
  } finally {
    if (sequence === httpLoadSequence) httpLoadController = null;
  }
}

let archiveLoadSequence = 0;
const ARCHIVE_STATUS_FALLBACK_CONCURRENCY = 4;

async function loadArchiveStatuses(items) {
  if (!state.httpMode || !items.length) return;
  const sequence = ++archiveLoadSequence;
  let statuses = null;
  let legacyFallback = false;
  try {
    // 一次批量读取；条目数量不再放大成本，也不会撞上默认 300 次/分钟的接口限流。
    const response = await localApiFetch("/api/archive/statuses", { cache: "no-store" });
    if (response.ok) {
      const data = await readJsonResponse(response);
      if (!Array.isArray(data.statuses)) return;
      statuses = data.statuses;
    } else if ([404, 405].includes(response.status)) {
      legacyFallback = true;
    } else {
      // 网络、限流或服务异常：保留上一次已知状态，不回退成逐条请求风暴。
      return;
    }
  } catch (_) {
    return;
  }
  if (sequence !== archiveLoadSequence) return;
  if (statuses) applyArchiveStatuses(items, statuses);
  else if (legacyFallback) await loadArchiveStatusesOneByOne(items, sequence);
  if (sequence === archiveLoadSequence) render();
}

/* 仅用于旧服务端没有批量接口时的兼容回退；并发受限，避免重复触发限流。 */
async function loadArchiveStatusesOneByOne(items, sequence) {
  const pending = items.slice();
  const worker = async () => {
    while (pending.length) {
      if (sequence !== archiveLoadSequence) return;
      const item = pending.shift();
      try {
        const response = await localApiFetch("/api/archive/status?id=" + encodeURIComponent(item.id), { cache: "no-store" });
        if (!response.ok) continue;
        const data = await readJsonResponse(response);
        if (data.archive || data.status) item.archive = normalizeArchiveStatus(data.archive || data.status);
      } catch (_) {
        // 保留服务端不可达前的状态。
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ARCHIVE_STATUS_FALLBACK_CONCURRENCY, pending.length) }, worker));
}

async function demoLoad() {
  state.demoMode = true;
  state.serviceReachable = false;
  setServiceState("demo");
  document.getElementById("demoBanner").hidden = false;
  try {
    const response = await fetch("DATA.example.md", { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const content = await response.text();
    if (!content.trim()) throw new Error("示例数据为空");
    state.dataName = "公共示例数据";
    applyText(content, "公共示例数据", "在线演示");
    document.getElementById("footerFile").textContent = "DEMO · 公共示例数据";
    document.getElementById("reloadBtn").textContent = "重置 Demo";
    const goal = document.getElementById("brainstormGoal");
    goal.value = "从示例项目中组合一套可验证的本地研究工作流";
    goal.readOnly = true;
    goal.title = "在线 Demo 使用预置分析目标；下载本地版可自由分析自己的项目库";
    document.querySelectorAll("[data-brainstorm-goal]").forEach(button => { button.disabled = true; });
    const goalButton = document.getElementById("brainstormGoalBtn");
    goalButton.disabled = true;
    goalButton.textContent = "预置演示方案";
    return true;
  } catch (error) {
    setLoaded(false);
    toast("在线 Demo 加载失败：" + error.message, "err");
    return false;
  }
}

async function restoreFromBackup() {
  if (!confirm(`将用浏览器备份覆盖 ${state.dataName} 当前内容，确认恢复？`)) return;
  const bak = await idbGet("backup", "readme");
  if (!bak) { toast("没有可用备份", "err"); return; }
  try {
    const r = await localApiFetch("/api/restore", {
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
    return `<button class="chip ${catCls(name)}${active ? " active" : ""}${folded}" data-cat="${escapeAttr(name)}">${escapeHtml(name)} <span class="c">${count}</span></button>`;
  };
  wrap.innerHTML =
    chip("全部", state.items.length, state.category === null) +
    CATS.filter(c => counts[c.name]).map(c => chip(c.name, counts[c.name], state.category === c.name)).join("") +
    Object.keys(counts).filter(name => !CATS.some(c => c.name === name))
      .map(name => chip(name, counts[name], state.category === name)).join("");
}

async function readJsonResponse(response) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch (_) { throw new Error(response.ok ? "服务响应格式异常" : `HTTP ${response.status}`); }
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data;
}

async function retryArchive(id, button) {
  if (button && button.disabled) return false;
  if (!requireService("重试归档")) return false;
  if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  try {
    const request = archiveRetryRequest(id);
    const data = await readJsonResponse(await localApiFetch(request.url, request.options));
    const item = state.items.find(entry => entry.id === String(id));
    if (item) item.archive = archiveResponseState(item.archive, data).archive;
    render();
    if (currentEntryId === String(id)) renderEntryArchive(item ? item.archive : data.archive);
    toast(data.created ? "归档任务已创建" : "归档已重新排队", "ok");
    return true;
  } catch (error) {
    toast("归档重试失败：" + error.message, "err");
    return false;
  } finally {
    if (button) { button.disabled = false; button.removeAttribute("aria-busy"); }
  }
}

async function submitManualContent(id, textarea, button) {
  const content = textarea.value.trim();
  if (!content) { toast("请先填写 Markdown 或纯文本", "err"); textarea.focus(); return false; }
  if (!requireService("提交手动归档")) return false;
  if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  textarea.disabled = true;
  try {
    const request = manualContentRequest(id, content);
    const data = await readJsonResponse(await localApiFetch(request.url, request.options));
    const item = state.items.find(entry => entry.id === String(id));
    if (item) item.archive = archiveResponseState(item.archive, data).archive;
    textarea.value = "";
    render();
    if (currentEntryId === String(id)) {
      renderEntryArchive(item ? item.archive : data.archive);
      loadContentPreview(id);
    }
    toast("内容已保存，归档正在处理", "ok");
    return true;
  } catch (error) {
    toast("手动归档失败：" + error.message, "err");
    return false;
  } finally {
    textarea.disabled = false;
    if (button) { button.disabled = false; button.removeAttribute("aria-busy"); }
  }
}

function handleArchiveControlClick(event) {
  const button = event.target.closest("[data-archive-action]");
  if (!button) return false;
  event.preventDefault();
  event.stopPropagation();
  const id = button.dataset.id;
  if (button.dataset.archiveAction === "retry") retryArchive(id, button);
  else if (button.dataset.archiveAction === "manual") openEntry(id);
  else if (button.dataset.archiveAction === "integrity") checkEntryIntegrity(id, button);
  return true;
}

function renderEntryArchive(archive) {
  const host = document.getElementById("entryArchive");
  if (!host || !currentEntryId) return;
  const item = { id: currentEntryId, archive: normalizeArchiveStatus(archive) };
  host.innerHTML = archivePanelHtml(item) + (item.archive.state === "manual_required" ? `
    <form class="manual-archive-form" id="manualArchiveForm" data-id="${escapeAttr(currentEntryId)}">
      <label for="manualArchiveContent">手动补录内容</label>
      <textarea id="manualArchiveContent" rows="8" placeholder="粘贴 Markdown 或纯文本内容"></textarea>
      <div class="manual-archive-actions"><span>服务端会再次校验内容大小；原始 HTML 归档上限为 20 MB。</span><button type="submit" class="btn primary">保存并重试归档</button></div>
    </form>` : "");
}

/* ============================================================
 * 事件
 * ============================================================ */
document.getElementById("emptyPickBtn").addEventListener("click", () => {
  if (state.httpMode) document.getElementById("addBtn").click();
  else document.getElementById("dataFileInput").click();
});
document.getElementById("dataFileInput").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    state.serviceReachable = false;
    setServiceState("file");
    state.dataName = file.name || "数据文件";
    applyText(text, state.dataName, "只读文件模式");
    toast("已进入只读浏览模式；编辑请启动本地服务", "ok");
  } catch (error) { toast("读取文件失败：" + error.message, "err"); }
});
document.getElementById("reloadBtn").addEventListener("click", async () => {
  if (state.demoMode) await demoLoad();
  else if (state.httpMode) await httpLoad();
});
document.getElementById("svcState").addEventListener("click", async () => {
  if (state.demoMode) { toast("当前为只读在线 Demo；下载本地版可保存自己的数据", "ok"); return; }
  if (state.httpMode) { toast("本地服务正常，数据会自动保存", "ok"); return; }
  const connected = await httpLoad();
  const online = connected && state.httpMode;
  toast(online ? "已重新连接本地服务" : "仍未连接，请确认程序正在运行", online ? "ok" : "err");
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && ["offline", "offline-cache", "data-error"].includes(state.serviceStatus)) httpLoad();
});
let deepSearchTimer = null;
let deepSearchSeq = 0;
function scheduleDeepSearch() {
  clearTimeout(deepSearchTimer);
  const query = state.query.trim();
  state.deepMatchIds = null;
  if (!state.httpMode || query.length < 2) return;
  const seq = ++deepSearchSeq;
  deepSearchTimer = setTimeout(async () => {
    try {
      const response = await localApiFetch("/api/search?q=" + encodeURIComponent(query), { cache: "no-store" });
      const data = await response.json();
      if (seq !== deepSearchSeq || state.query.trim() !== query || !data.ok) return;
      state.deepMatchIds = new Set((data.results || []).map(item => item.id));
      render();
    } catch (_) {}
  }, 250);
}
document.getElementById("searchInput").addEventListener("input", e => {
  state.query = e.target.value;
  document.getElementById("searchClearBtn").hidden = !state.query;
  scheduleDeepSearch();
  render();
});
function clearSearch() {
  const input = document.getElementById("searchInput");
  input.value = "";
  state.query = "";
  state.deepMatchIds = null;
  deepSearchSeq++;
  clearTimeout(deepSearchTimer);
  document.getElementById("searchClearBtn").hidden = true;
  render();
  input.focus();
}
document.getElementById("searchClearBtn").addEventListener("click", clearSearch);
document.getElementById("searchInput").addEventListener("keydown", e => {
  if (e.key === "Escape" && state.query) clearSearch();
});
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
function toggleRow(row) {
  const open = row.classList.toggle("open");
  const disclosure = row.querySelector(".row-disclosure");
  if (disclosure) {
    disclosure.setAttribute("aria-expanded", String(open));
    disclosure.setAttribute("aria-label", `${open ? "收起" : "展开"} ${row.querySelector(".name .txt")?.textContent || "条目"} 的详情`);
  }
  const panel = row.nextElementSibling;
  if (panel && panel.classList.contains("detail-panel")) {
    panel.setAttribute("aria-hidden", String(!open));
    panel.toggleAttribute("inert", !open);
  }
}
document.getElementById("listView").addEventListener("click", e => {
  if (handleArchiveControlClick(e)) return;
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
  toggleRow(row);
});

/* 列表详情面板：状态循环（待研究 → 进行中 → 已完成 → 待研究） */
async function updateItemStatus(item, next) {
  if (!requireService("更新状态")) return false;
  const action = next === "doing" ? "start" : next === "done" ? "complete" : "reset";
  try {
    // 生命周期接口同时维护状态、研究时间与下次回顾，避免列表与档案状态不一致。
    const data = await postLifecycle(item.id, action);
    applyLifecycleResult(item.id, data);
    if (studyItem && studyItem.id === String(item.id)) renderStudyLifecycle(studyItem);
    toast(`已更新为${statusLabel(item)}`, "ok");
    return true;
  } catch (e) {
    toast("状态更新失败：" + e.message, "err");
    return false;
  }
}
async function cycleStatus(item) {
  const next = item.status === "pending" ? "doing" : item.status === "doing" ? "done" : "pending";
  return updateItemStatus(item, next);
}

/* ============================================================
 * 生命周期 / 待处理中心 / 归档完整性
 * 后端能力复用 v2.2 API，前端只负责展示、排序说明和显式操作。
 * ============================================================ */
async function postLifecycle(id, action, nextReviewAt) {
  const body = { requestId: newRequestId(), id: String(id), action };
  if (nextReviewAt) body.nextReviewAt = nextReviewAt;
  const response = await localApiFetch("/api/lifecycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJsonResponse(response);
}

function applyLifecycleResult(id, data) {
  const item = state.items.find(entry => entry.id === String(id));
  if (!item) return null;
  if (data && data.lifecycle) item.lifecycle = { ...item.lifecycle, ...data.lifecycle };
  if (data && data.status && STATUS[data.status]) {
    item.statusSym = data.status;
    item.status = STATUS[data.status].key;
  }
  render();
  return item;
}

function renderStudyLifecycle(item) {
  const lifecycle = (item && item.lifecycle) || { createdAt: null, lastStudiedAt: null, nextReviewAt: null };
  const meta = document.getElementById("studyLifecycleMeta");
  if (meta) meta.textContent = lifecycle.lastStudiedAt ? `上次研究 ${lifecycleDayLabel(lifecycle.lastStudiedAt)}` : "尚未记录研究时间";
  const dates = document.getElementById("studyLifecycleDates");
  if (dates) {
    const rows = [
      ["创建", lifecycleDayLabel(lifecycle.createdAt)],
      ["上次研究", lifecycleDayLabel(lifecycle.lastStudiedAt)],
      ["下次回顾", lifecycle.nextReviewAt ? `${lifecycleDayLabel(lifecycle.nextReviewAt)}（${reviewRelativeLabel(lifecycle.nextReviewAt)}）` : "未安排"],
    ];
    dates.innerHTML = rows.map(([label, value]) => `<span><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`).join("");
  }
  const input = document.getElementById("studyReviewDate");
  if (input) {
    input.value = reviewDateValue(lifecycle.nextReviewAt) || reviewDateValue(new Date(Date.now() + 30 * 86400000).toISOString());
  }
}

let attentionData = null;
let attentionLoadSequence = 0;
const ATTENTION_REASON_ORDER = ["archive_blocked", "review_due", "open_action", "stalled", "unresearched", "lifecycle_missing"];

function attentionItemFor(id) {
  return state.items.find(item => item.id === String(id)) || null;
}

function updateAttentionBadge() {
  const badge = document.getElementById("attentionCount");
  const button = document.getElementById("attentionBtn");
  if (!badge || !button) return;
  const count = attentionData && attentionData.counts ? Number(attentionData.counts.items) || 0 : 0;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = count === 0;
  button.setAttribute("aria-label", count ? `待处理中心，${count} 项` : "待处理中心");
}

async function loadAttention() {
  if (!state.httpMode) {
    attentionData = null;
    updateAttentionBadge();
    if (document.getElementById("attentionModal").classList.contains("open")) renderAttention(null);
    return;
  }
  const sequence = ++attentionLoadSequence;
  try {
    const response = await localApiFetch("/api/attention", { cache: "no-store" });
    const data = await readJsonResponse(response);
    if (sequence !== attentionLoadSequence) return;
    if (!data.ok) throw new Error(data.error || "待处理中心不可用");
    attentionData = data;
    updateAttentionBadge();
    if (document.getElementById("attentionModal").classList.contains("open")) renderAttention(data);
  } catch (error) {
    if (sequence !== attentionLoadSequence) return;
    if (document.getElementById("attentionModal").classList.contains("open")) {
      document.getElementById("attentionList").innerHTML = `<div class="attention-empty">待处理中心暂时不可用：${escapeHtml(error.message)}</div>`;
    }
  }
}

function renderAttention(data) {
  const summary = document.getElementById("attentionSummary");
  const policy = document.getElementById("attentionPolicy");
  const list = document.getElementById("attentionList");
  if (!summary || !list) return;
  if (!data) {
    summary.textContent = "启动本地服务后可以计算待处理项目。";
    policy.textContent = "";
    list.innerHTML = '<div class="attention-empty">当前没有可读取的待处理数据。</div>';
    return;
  }
  const counts = data.counts || {};
  const byReason = counts.byReason || {};
  const parts = ATTENTION_REASON_ORDER.filter(code => byReason[code]).map(code => `${attentionReasonLabel(code)} ${byReason[code]}`);
  summary.textContent = `共 ${Number(counts.items) || 0} 项需要关注${parts.length ? "：" + parts.join(" · ") : ""}`;
  policy.textContent = "排序依据：归档阻断 → 回顾到期 → 未完成行动项 → 研究停滞 → 未研究 → 缺少创建时间。每项显示命中规则与到期时间，操作只作用于本机数据。";
  const items = data.items || [];
  if (!items.length) {
    list.innerHTML = '<div class="attention-empty">当前没有需要处理的项目。继续收集或研究即可。</div>';
    return;
  }
  const statusClass = { "待研究": "st-pending", "进行中": "st-doing", "已完成": "st-done" };
  list.innerHTML = items.map(item => {
    const reasons = Array.isArray(item.reasons) ? item.reasons : [];
    const due = reasons.find(reason => reason.dueAt);
    const warning = (item.warnings || []).length ? `<span class="attention-warning">${escapeHtml(item.warnings.join(" / "))}</span>` : "";
    return `<article class="attention-item" data-attention-id="${escapeAttr(item.id)}">
      <div class="attention-item-head">
        <span class="attention-id">#${escapeHtml(item.id)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <span class="status ${statusClass[item.status] || "st-pending"}">${escapeHtml(item.status || "待研究")}</span>
      </div>
      <div class="attention-reasons">${reasons.map(reason => `<span class="attention-reason tone-${escapeAttr((ATTENTION_REASON_META[reason.code] || {}).tone || "muted")}">${escapeHtml(attentionReasonLabel(reason.code))}</span>`).join("")}${warning}</div>
      <div class="attention-meta">
        <span>主因：${escapeHtml(attentionReasonLabel(item.primaryReason))}</span>
        ${due ? `<span>到期：${escapeHtml(lifecycleDayLabel(due.dueAt))}</span>` : ""}
        <span>最近活动：${escapeHtml(lifecycleDayLabel(item.activityAt))}</span>
      </div>
      <div class="attention-item-actions">
        <button type="button" class="btn" data-attention-action="study">打开研究</button>
        <button type="button" class="btn" data-attention-action="defer">延后 7 天</button>
        ${item.status !== "已完成" ? '<button type="button" class="btn" data-attention-action="reviewed">已回顾</button><button type="button" class="btn primary" data-attention-action="complete">完成</button>' : ""}
        ${reasons.some(reason => reason.code === "lifecycle_missing") ? '<button type="button" class="btn" data-attention-action="repair">修复时间</button>' : ""}
      </div>
    </article>`;
  }).join("");
}

async function handleAttentionAction(action, id, button) {
  if (action === "study") {
    const item = attentionItemFor(id);
    if (!item) { toast("条目已变化，请重新读取数据", "err"); return; }
    openStudy(item);
    return;
  }
  const mapping = { defer: "set_review", reviewed: "mark_reviewed", complete: "complete", repair: "repair_lifecycle" };
  if (!mapping[action]) return;
  if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  try {
    const nextReviewAt = action === "defer" ? new Date(Date.now() + 7 * 86400000).toISOString() : undefined;
    const data = await postLifecycle(id, mapping[action], nextReviewAt);
    applyLifecycleResult(id, data);
    await loadAttention();
    toast(action === "defer" ? "已延后 7 天" : "待处理状态已更新", "ok");
  } catch (error) {
    toast("处理失败：" + error.message, "err");
  } finally {
    if (button) { button.disabled = false; button.removeAttribute("aria-busy"); }
  }
}

const integrityResults = new Map();

function integrityResultHtml(id) {
  const result = integrityResults.get(String(id));
  if (!result) return "";
  const labels = {
    healthy: "完整", damaged: "损坏", unverified: "未验证", unchecked: "未校验", not_archived: "未归档",
  };
  const label = labels[result.state] || result.state || "未知";
  const reasons = Array.isArray(result.reasonCodes) && result.reasonCodes.length ? " · " + result.reasonCodes.join(" / ") : "";
  const checked = result.checkedAt ? " · " + archiveTimeLabel(result.checkedAt) : "";
  const tone = result.state === "healthy" ? "ok" : result.state === "damaged" ? "danger" : "muted";
  return `<p class="archive-integrity tone-${tone}" role="status">完整性：${escapeHtml(label + reasons + checked)}</p>`;
}

async function checkEntryIntegrity(id, button) {
  if (button && button.disabled) return;
  if (!requireService("校验归档完整性")) return;
  if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  try {
    const data = await readJsonResponse(await localApiFetch("/api/archive/integrity/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [String(id)] }),
    }));
    const result = (data.results || [])[0];
    if (!result) throw new Error("服务端未返回校验结果");
    integrityResults.set(String(id), result);
    const item = state.items.find(entry => entry.id === String(id));
    render();
    if (currentEntryId === String(id)) renderEntryArchive(item ? item.archive : { id, state: "queued" });
    toast(result.state === "healthy" ? "归档文件校验通过" : "归档校验完成，请查看结果", result.state === "healthy" ? "ok" : "err");
  } catch (error) {
    toast("归档校验失败：" + error.message, "err");
  } finally {
    if (button) { button.disabled = false; button.removeAttribute("aria-busy"); }
  }
}

async function checkAllIntegrity(button) {
  if (!requireService("检查归档完整性")) return;
  const ids = state.items.slice(0, 200).map(item => item.id);
  const report = document.getElementById("integrityReport");
  if (!ids.length) { toast("请先加载数据", "err"); return; }
  if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  if (report) { report.hidden = false; report.textContent = "正在校验 " + ids.length + " 个条目的归档文件…"; }
  try {
    const data = await readJsonResponse(await localApiFetch("/api/archive/integrity/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }));
    const results = data.results || [];
    for (const result of results) integrityResults.set(String(result.id), result);
    const counts = {};
    for (const result of results) counts[result.state] = (counts[result.state] || 0) + 1;
    const summary = Object.entries(counts).map(([state, count]) => `${state} ${count}`).join(" · ");
    const damaged = results.filter(result => result.state === "damaged");
    const lines = [
      `已检查 ${results.length} 项${state.items.length > 200 ? "（仅前 200 项）" : ""}：${summary || "无结果"}`,
      ...damaged.slice(0, 20).map(result => `#${result.id} 损坏：${(result.reasonCodes || []).join(" / ") || "未知原因"}`),
      damaged.length > 20 ? `……另有 ${damaged.length - 20} 项损坏` : "",
    ].filter(Boolean);
    if (report) report.textContent = lines.join("\n");
    render();
    toast(damaged.length ? "发现需要修复的归档" : "归档完整性检查完成", damaged.length ? "err" : "ok");
  } catch (error) {
    if (report) report.textContent = "检查失败：" + error.message;
    toast("完整性检查失败：" + error.message, "err");
  } finally {
    if (button) { button.disabled = false; button.removeAttribute("aria-busy"); }
  }
}

function openAttention() {
  document.getElementById("attentionModal").classList.add("open");
  document.getElementById("attentionSummary").textContent = "正在计算需要关注的项目…";
  document.getElementById("attentionList").innerHTML = '<div class="attention-empty">读取中…</div>';
  if (attentionData) renderAttention(attentionData);
  loadAttention();
}

document.getElementById("attentionBtn").addEventListener("click", openAttention);
document.getElementById("attentionRefreshBtn").addEventListener("click", () => loadAttention());
document.getElementById("attentionModal").addEventListener("click", event => {
  if (event.target === event.currentTarget) event.currentTarget.classList.remove("open");
});
document.getElementById("attentionList").addEventListener("click", event => {
  const button = event.target.closest("[data-attention-action]");
  const article = button && button.closest("[data-attention-id]");
  if (!button || !article) return;
  handleAttentionAction(button.dataset.attentionAction, article.dataset.attentionId, button);
});
document.getElementById("integrityCheckBtn").addEventListener("click", event => checkAllIntegrity(event.currentTarget));
async function copyLink(url) {
  if (!url) { toast("该条目无链接", "err"); return; }
  try { await navigator.clipboard.writeText(url); toast("链接已复制", "ok"); }
  catch (_) { toast("复制失败，请手动复制", "err"); }
}
document.getElementById("boardView").addEventListener("click", e => {
  if (handleArchiveControlClick(e)) return;
  const card = e.target.closest(".card");
  if (!card || e.target.closest("a")) return;
  const studyButton = e.target.closest(".study-btn");
  if (studyButton) {
    openEntry(studyButton.dataset.entryId || card.dataset.id);
    return;
  }
  const open = card.classList.toggle("open");
  const disclosure = card.querySelector(".card-disclosure");
  const detail = card.querySelector(".detail");
  if (detail) {
    detail.inert = !open;
    detail.setAttribute("aria-hidden", String(!open));
  }
  if (disclosure) {
    disclosure.setAttribute("aria-expanded", String(open));
    disclosure.setAttribute("aria-label", `${open ? "收起" : "展开"} ${card.querySelector(".nm")?.textContent || "条目"} 的详情`);
    disclosure.textContent = open ? "收起详情" : "查看详情";
  }
});
document.addEventListener("error", e => {
  const image = e.target;
  if (image instanceof HTMLImageElement && image.matches(".cover img, #dCover img")) image.remove();
}, true);

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
function setHeaderMenu(panelId, buttonId, open, focusFirst = false) {
  const panel = document.getElementById(panelId);
  const button = document.getElementById(buttonId);
  panel.classList.toggle("open", open);
  panel.hidden = !open;
  panel.inert = !open;
  panel.setAttribute("aria-hidden", String(!open));
  button.setAttribute("aria-expanded", String(open));
  if (open && focusFirst) {
    requestAnimationFrame(() => panel.querySelector("button:not(:disabled)")?.focus({ preventScroll: true }));
  }
}
function closeHeaderMenus(restoreFocus = false) {
  const active = document.getElementById("themePanel").classList.contains("open")
    ? document.getElementById("themeBtn")
    : document.getElementById("morePanel").classList.contains("open")
      ? document.getElementById("moreBtn") : null;
  setHeaderMenu("themePanel", "themeBtn", false);
  setHeaderMenu("morePanel", "moreBtn", false);
  if (restoreFocus && active) active.focus({ preventScroll: true });
}
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
  const open = !document.getElementById("themePanel").classList.contains("open");
  setHeaderMenu("morePanel", "moreBtn", false);
  setHeaderMenu("themePanel", "themeBtn", open, open);
});
document.addEventListener("click", e => {
  if (!e.target.closest(".theme-wrap")) {
    setHeaderMenu("themePanel", "themeBtn", false);
  }
});
document.getElementById("themePanel").addEventListener("click", e => {
  const item = e.target.closest(".tp-item");
  if (!item) return;
  applyTheme(item.dataset.t);
  setHeaderMenu("themePanel", "themeBtn", false);
  document.getElementById("themeBtn").focus({ preventScroll: true });
});

document.getElementById("moreBtn").addEventListener("click", e => {
  e.stopPropagation();
  const open = !document.getElementById("morePanel").classList.contains("open");
  setHeaderMenu("themePanel", "themeBtn", false);
  setHeaderMenu("morePanel", "moreBtn", open, open);
});
document.getElementById("morePanel").addEventListener("click", e => {
  const item = e.target.closest("button[data-target]");
  if (!item) return;
  setHeaderMenu("morePanel", "moreBtn", false);
  document.getElementById(item.dataset.target).click();
});

const ONBOARDING_KEY = "linggan_onboarding_v2_seen";
function markOnboardingSeen() {
  try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch (_) {}
}
function openOnboarding() {
  document.getElementById("onboardingStartBtn").textContent = state.items.length ? "收藏新的链接" : "收藏第一个链接";
  document.getElementById("onboardingModal").classList.add("open");
}
function closeOnboarding() {
  markOnboardingSeen();
  document.getElementById("onboardingModal").classList.remove("open");
}
function maybeShowOnboarding() {
  if (!state.httpMode) return;
  try { if (localStorage.getItem(ONBOARDING_KEY)) return; } catch (_) {}
  openOnboarding();
}
document.getElementById("helpBtn").addEventListener("click", openOnboarding);
document.getElementById("onboardingLaterBtn").addEventListener("click", closeOnboarding);
document.getElementById("onboardingStartBtn").addEventListener("click", () => {
  closeOnboarding();
  document.getElementById("addBtn").click();
});
document.getElementById("onboardingModal").addEventListener("click", e => {
  if (e.target === e.currentTarget || e.target.closest(".onboarding-dismiss")) closeOnboarding();
});
document.addEventListener("click", e => {
  if (!e.target.closest(".more-wrap")) {
    setHeaderMenu("morePanel", "moreBtn", false);
  }
});
document.addEventListener("click", e => {
  const close = e.target.closest(".modal-x");
  if (close) close.closest(".modal-overlay").classList.remove("open");
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (document.getElementById("studyOverlay").classList.contains("open")) {
    e.preventDefault();
    closeStudy();
    return;
  }
  if (document.getElementById("onboardingModal").classList.contains("open")) markOnboardingSeen();
  const openModal = [...document.querySelectorAll(".modal-overlay.open")].pop();
  if (openModal) openModal.classList.remove("open");
  closeHeaderMenus(true);
});

/* 所有弹窗共用焦点闭环、背景锁定与触发点恢复。 */
const dialogFocusState = { active: null, opener: null };
const dialogBackground = [...document.querySelectorAll(".demo-banner, .topbar, .trust-rail, .statsbar, .main, footer, .bulkbar")];
function dialogFocusable(dialog) {
  return [...dialog.querySelectorAll('button:not(:disabled), input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.hidden && element.getClientRects().length > 0);
}
function syncDialogFocus() {
  const open = [...document.querySelectorAll(".modal-overlay.open, .study-overlay.open")].pop() || null;
  if (open && dialogFocusState.active !== open) {
    dialogFocusState.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogFocusState.active = open;
    dialogBackground.forEach(element => { if (!open.contains(element)) element.inert = true; });
    document.body.classList.add("dialog-open");
    requestAnimationFrame(() => {
      const preferred = open.querySelector("[autofocus]") ||
        open.querySelector("#fetchUrl, #commandInput") || open.querySelector(".modal-x") || dialogFocusable(open)[0];
      if (preferred) preferred.focus({ preventScroll: true });
    });
    return;
  }
  if (!open && dialogFocusState.active) {
    dialogBackground.forEach(element => { element.inert = false; });
    document.body.classList.remove("dialog-open");
    const opener = dialogFocusState.opener;
    dialogFocusState.active = null;
    dialogFocusState.opener = null;
    if (opener && opener.isConnected) requestAnimationFrame(() => opener.focus({ preventScroll: true }));
  }
}
document.querySelectorAll(".modal-overlay, .study-overlay").forEach(dialog => {
  new MutationObserver(syncDialogFocus).observe(dialog, { attributes: true, attributeFilter: ["class"] });
});
document.addEventListener("keydown", e => {
  if (e.key !== "Tab" || !dialogFocusState.active || !dialogFocusState.active.classList.contains("open")) return;
  const focusable = dialogFocusable(dialogFocusState.active);
  if (!focusable.length) { e.preventDefault(); return; }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* 动效生命周期：页面隐藏或区块离屏时暂停，避免长期后台占用。 */
const prefersReduce = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let motionObserver = null;
const surfaceMotionFrames = new WeakMap();
document.addEventListener("keydown", () => {
  document.documentElement.dataset.input = "keyboard";
}, true);
document.addEventListener("pointerdown", () => {
  document.documentElement.dataset.input = "pointer";
}, true);
function refreshMotionVisibility() {
  if (!motionObserver || prefersReduce()) return;
  document.querySelectorAll(".topbar, #banner, #daily, #toolrow, #emptyState, #listView, #boardView, #relationshipView, #brainstormView").forEach(element => {
    if (element.dataset.motionObserved) return;
    element.dataset.motionObserved = "true";
    element.classList.add("motion-surface");
    motionObserver.observe(element);
  });
}
function restartSurfaceMotion(element) {
  if (!element || prefersReduce() || document.documentElement.dataset.input === "keyboard") return;
  const previousFrame = surfaceMotionFrames.get(element);
  if (previousFrame) cancelAnimationFrame(previousFrame);
  element.classList.remove("product-view-enter");
  surfaceMotionFrames.set(element, requestAnimationFrame(() => {
    element.classList.add("product-view-enter");
    surfaceMotionFrames.delete(element);
  }));
}
if ("IntersectionObserver" in window) {
  motionObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => entry.target.classList.toggle("is-motion-offscreen", !entry.isIntersecting));
  }, { threshold: 0.01 });
}
function syncDocumentMotion() {
  document.documentElement.classList.toggle("motion-paused", document.hidden);
}
document.addEventListener("visibilitychange", syncDocumentMotion);
syncDocumentMotion();
refreshMotionVisibility();

/* 卡片封面鼠标视差：逐卡复位、单帧合并，并在页面隐藏时清理。 */
const boardEl = document.getElementById("boardView");
let parallaxFrame = null;
let parallaxCard = null;
let parallaxPoint = null;
function resetCardParallax(card = parallaxCard) {
  if (parallaxFrame) cancelAnimationFrame(parallaxFrame);
  parallaxFrame = null;
  parallaxPoint = null;
  const image = card && card.querySelector(".cover img");
  if (image) {
    image.style.removeProperty("transition");
    image.style.removeProperty("transform");
  }
  if (!card || card === parallaxCard) parallaxCard = null;
}
boardEl.addEventListener("pointermove", e => {
  if (prefersReduce() || e.pointerType === "touch") return;
  const card = e.target.closest(".card");
  if (!card) return;
  if (parallaxCard && parallaxCard !== card) resetCardParallax(parallaxCard);
  parallaxCard = card;
  parallaxPoint = { x: e.clientX, y: e.clientY };
  if (parallaxFrame) return;
  parallaxFrame = requestAnimationFrame(() => {
    parallaxFrame = null;
    if (!parallaxCard || !parallaxPoint || document.hidden) return;
    const image = parallaxCard.querySelector(".cover img");
    if (!image) return;
    const rect = parallaxCard.getBoundingClientRect();
    const x = (parallaxPoint.x - rect.left) / rect.width - 0.5;
    const y = (parallaxPoint.y - rect.top) / rect.height - 0.5;
    image.style.transition = "transform 90ms linear";
    image.style.transform = `scale(1.075) translate(${(x * 12).toFixed(1)}px, ${(y * 8).toFixed(1)}px)`;
  });
});
boardEl.addEventListener("pointerout", e => {
  const card = e.target.closest(".card");
  if (card && !card.contains(e.relatedTarget)) resetCardParallax(card);
});
boardEl.addEventListener("pointerleave", () => resetCardParallax());
document.addEventListener("visibilitychange", () => { if (document.hidden) resetCardParallax(); });

/* ============================================================
 * 新增模态
 * ============================================================ */
const modal = document.getElementById("modal");
let draftDiff = 1;

function openCaptureModal() {
  if (!state.httpMode) { toast("请先启动服务（双击 start.bat）", "err"); return; }
  document.getElementById("fetchUrl").value = "";
  document.getElementById("linkName").value = "";
  document.getElementById("linkDesc").value = "";
  document.getElementById("linkTags").value = "";
  document.getElementById("linkWhy").value = "";
  document.getElementById("linkCustomCat").value = "";
  document.getElementById("linkCustomCat").hidden = true;
  document.getElementById("fetchPrev").classList.remove("show");
  document.getElementById("fetchErr").classList.remove("show");
  document.getElementById("fetchWarn").classList.remove("show");
  document.getElementById("fetchLoad").classList.remove("show");
  document.getElementById("editForm").hidden = true;
  document.getElementById("genBtn").hidden = true;
  document.getElementById("okMsg").classList.remove("show");
  document.getElementById("nameErr").classList.remove("show");
  document.getElementById("linkName").removeAttribute("aria-invalid");
  document.getElementById("fetchUrl").removeAttribute("aria-invalid");
  document.getElementById("duplicateBox").hidden = true;
  duplicateDraft = null;
  duplicateId = null;
  draftDiff = 1;
  document.querySelectorAll("#starPicker button").forEach(b => {
    const active = b.dataset.d === "1";
    b.classList.toggle("on", active);
    b.setAttribute("aria-pressed", String(active));
  });
  modal.classList.add("open");
  setTimeout(() => document.getElementById("fetchUrl").focus(), 80);
}
document.querySelectorAll("[data-capture-trigger]").forEach(button => button.addEventListener("click", openCaptureModal));
document.getElementById("listView").addEventListener("click", event => {
  if (event.target.closest("[data-empty-capture]")) openCaptureModal();
});

document.getElementById("cancelBtn").addEventListener("click", () => modal.classList.remove("open"));
modal.addEventListener("click", e => { if (e.target === modal) modal.classList.remove("open"); });
document.getElementById("starPicker").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  draftDiff = parseInt(b.dataset.d, 10);
  document.querySelectorAll("#starPicker button").forEach(x => {
    const active = x.dataset.d === String(draftDiff);
    x.classList.toggle("on", active);
    x.setAttribute("aria-pressed", String(active));
  });
});

async function fetchMetaFromUrl() {
  const url = document.getElementById("fetchUrl").value.trim();
  if (!/^https?:\/\//i.test(url)) { showFetchErr("请粘贴有效的 http(s) 链接"); return; }
  const button = document.getElementById("fetchBtn");
  document.getElementById("fetchUrl").removeAttribute("aria-invalid");
  document.getElementById("fetchErr").classList.remove("show");
  document.getElementById("fetchWarn").classList.remove("show");
  document.getElementById("fetchPrev").classList.remove("show");
  document.getElementById("editForm").hidden = true;
  document.getElementById("genBtn").hidden = true;
  document.getElementById("fetchLoad").classList.add("show");
  setButtonBusy(button, true, "识别中…");
  try {
    const r = await localApiFetch("/api/fetch-meta?url=" + encodeURIComponent(url), { cache: "no-store" });
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
    const customCats = [...new Set(state.items.map(item => item.category))]
      .filter(name => !CATS.some(c => c.name === name));
    sel.innerHTML = CATS.concat(customCats.map(name => ({ name })))
      .map(c => `<option value="${escapeAttr(c.name)}">${escapeHtml(c.name)}</option>`).join("") +
      '<option value="__custom__">＋ 自定义分类</option>';
    sel.value = m.category || "其他";
    document.getElementById("editForm").hidden = false;
    document.getElementById("genBtn").hidden = false;
  } catch (e) {
    showFetchErr("识别失败：" + e.message);
  } finally {
    document.getElementById("fetchLoad").classList.remove("show");
    setButtonBusy(button, false);
  }
}
function showFetchErr(msg) {
  document.getElementById("fetchErr").textContent = msg;
  document.getElementById("fetchErr").classList.add("show");
  document.getElementById("fetchUrl").setAttribute("aria-invalid", "true");
}
document.getElementById("fetchBtn").addEventListener("click", fetchMetaFromUrl);
document.getElementById("fetchUrl").addEventListener("keydown", e => { if (e.key === "Enter") fetchMetaFromUrl(); });
document.getElementById("linkCat").addEventListener("change", e => {
  const input = document.getElementById("linkCustomCat");
  input.hidden = e.target.value !== "__custom__";
  if (!input.hidden) input.focus();
});

let duplicateDraft = null;
let duplicateId = null;

async function saveDraft(payload) {
  const btn = document.getElementById("genBtn");
  setButtonBusy(btn, true, "写入中…");
  document.getElementById("duplicateBox").hidden = true;
  try {
    const r = await localApiFetch("/api/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "写入失败");
    if (d.duplicate) {
      duplicateDraft = payload;
      duplicateId = d.id;
      document.getElementById("duplicateTitle").textContent = `该链接已存在（${d.id} · ${d.title || "已有条目"}）`;
      document.getElementById("duplicateMergeBtn").hidden = !payload.tags && !payload.whySaved;
      const duplicateBox = document.getElementById("duplicateBox");
      duplicateBox.hidden = false;
      requestAnimationFrame(() => {
        duplicateBox.scrollIntoView({ block: "nearest", behavior: prefersReduce() ? "auto" : "smooth" });
        document.getElementById("duplicateOpenBtn").focus({ preventScroll: true });
      });
      return;
    }
    duplicateDraft = null;
    duplicateId = null;
    state.lastNewId = d.id;
    toast(`已写入 ${state.dataName}（${d.id} · ${d.category}）`, "ok");
    await httpLoad();
    try {
      const cnt = state.items.length;
      if (cnt > 0 && cnt % 5 === 0) {
        particleBurst(innerWidth / 2, innerHeight - 140);
        setTimeout(() => toast(`第 ${cnt} 个收藏，里程碑达成`, "ok"), 800);
      }
    } catch (_) {}
    setTimeout(() => modal.classList.remove("open"), 700);
  } catch (e) {
    toast("写入失败：" + e.message, "err");
  } finally {
    setButtonBusy(btn, false);
  }
}

document.getElementById("genBtn").addEventListener("click", async () => {
  const url = document.getElementById("fetchUrl").value.trim();
  const name = document.getElementById("linkName").value.trim();
  const selectedCat = document.getElementById("linkCat").value;
  const cat = selectedCat === "__custom__"
    ? document.getElementById("linkCustomCat").value.trim()
    : selectedCat;
  const desc = document.getElementById("linkDesc").value.trim();
  const tags = document.getElementById("linkTags").value.trim();
  const whySaved = document.getElementById("linkWhy").value.trim();
  if (!name) {
    document.getElementById("nameErr").classList.add("show");
    document.getElementById("linkName").setAttribute("aria-invalid", "true");
    document.getElementById("linkName").focus();
    return;
  }
  if (!cat) { toast("请填写自定义分类名称", "err"); return; }

  await saveDraft({ url, name, cat, desc, tags, whySaved, difficulty: draftDiff });
});
document.getElementById("linkName").addEventListener("input", e => {
  if (!e.target.value.trim()) return;
  e.target.removeAttribute("aria-invalid");
  document.getElementById("nameErr").classList.remove("show");
});
document.getElementById("duplicateOpenBtn").addEventListener("click", async () => {
  if (!duplicateId) return;
  const id = duplicateId;
  modal.classList.remove("open");
  await httpLoad();
  openEntry(id);
});
document.getElementById("duplicateSaveBtn").addEventListener("click", async () => {
  if (!duplicateDraft) return;
  await saveDraft(Object.assign({}, duplicateDraft, { allowDuplicate: true }));
});
document.getElementById("duplicateMergeBtn").addEventListener("click", async () => {
  if (!duplicateDraft || !duplicateId) return;
  const button = document.getElementById("duplicateMergeBtn");
  setButtonBusy(button, true, "合并中…");
  try {
    const response = await localApiFetch("/api/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: duplicateId, tags: duplicateDraft.tags, whySaved: duplicateDraft.whySaved }),
    });
    const data = await readJsonResponse(response);
    if (!data.ok) throw new Error(data.error || "合并失败");
    const id = duplicateId;
    modal.classList.remove("open");
    await httpLoad();
    toast(data.merged ? "标签与收藏原因已合并" : "已有条目已包含这些信息", "ok");
    openEntry(id);
  } catch (error) {
    toast("合并失败：" + error.message, "err");
  } finally {
    button.disabled = false;
  }
});

/* ============================================================
 * 启动
 * ============================================================ */
async function init() {
  const ok = state.demoMode ? await demoLoad() : await httpLoad();
  try {
    const savedView = localStorage.getItem("product_view");
    if (ok && ["relationship", "brainstorm"].includes(savedView)) setProductView(savedView, { instant: true });
  } catch (_) {}
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
function dailyPick(items = state.items) {
  const pool = items.filter(i => i.status === "pending");
  if (!pool.length) return null;
  // 同难度按编号小（数字）；已展示过的跳过
  const sorted = [...pool].sort((a, b) => (a.difficulty || 0) - (b.difficulty || 0) || a.id.localeCompare(b.id, "en", { numeric: true }));
  return sorted.find(i => !state.dailyShown.has(i.id)) || sorted[0];
}
function renderDaily(items = filtered()) {
  const box = document.getElementById("daily");
  // 今日关闭过？
  try { if (localStorage.getItem("daily_hide_date") === todayStr()) { box.hidden = true; return; } } catch (_) {}
  const item = dailyPick(items);
  if (!item) { box.hidden = true; return; }
  box.hidden = false;
  const motionKey = String(item.id);
  if (box.dataset.motionItem !== motionKey) {
    box.classList.remove("appear");
    requestAnimationFrame(() => box.classList.add("appear"));
    box.dataset.motionItem = motionKey;
  }
  const cover = document.getElementById("dCover");
  cover.classList.remove(...CATS.map(c => c.cls));
  cover.classList.add(catCls(item.category));
  cover.style.setProperty("--cat", catColor(item.category));
  cover.innerHTML = item.image
    ? `<img src="${escapeAttr(item.image)}" alt="" loading="lazy">`
    : `<div class="ph">${escapeHtml(item.name.slice(0, 1))}</div>`;
  document.getElementById("dTitle").textContent = item.name;
  document.getElementById("dMeta").innerHTML =
    `<span class="badge cat ${catCls(item.category)}">${escapeHtml(item.category)}</span><span class="badge diff">${"★".repeat(item.difficulty || 1)}</span><span class="status st-${item.status}">${statusLabel(item)}</span>`;
  document.getElementById("dailyStart").onclick = async e => {
    const button = e.currentTarget;
    setButtonBusy(button, true, "准备中…");
    try {
      if (item.status === "pending" && !await updateItemStatus(item, "doing")) return;
      openStudy(item);
    } finally {
      setButtonBusy(button, false);
    }
  };
  document.getElementById("dailySkip").onclick = () => { state.dailyShown.add(item.id); renderDaily(filtered()); };
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
    setTimeout(() => p.remove(), 520);
  }
}

/* - 批量操作 - */
const picked = new Set();
function reconcilePicked(visibleIds) {
  const visible = new Set(visibleIds.map(String));
  [...picked].forEach(id => { if (!visible.has(String(id))) picked.delete(id); });
}
function syncPicked() {
  document.querySelectorAll(".row").forEach(r => {
    const cb = r.querySelector(".pick");
    const on = picked.has(r.dataset.id);
    r.classList.toggle("picked", on);
    if (cb) cb.checked = on;
  });
  const n = picked.size;
  document.getElementById("bulkbar").classList.toggle("show", n > 0);
  document.body.classList.toggle("bulk-active", n > 0);
  document.getElementById("bulkCount").textContent = `已选 ${n} 项`;
}
document.getElementById("listView").addEventListener("change", e => {
  const cb = e.target.closest(".pick");
  if (!cb) return;
  if (cb.checked) picked.add(cb.dataset.pick); else picked.delete(cb.dataset.pick);
  syncPicked();
});
async function bulkAction(fn) {
  if (!requireService("批量操作")) return 0;
  if (!picked.size) return;
  const ids = [...picked];
  try {
    for (const id of ids) {
      const response = await fn(id);
      let data = null;
      try { data = await response.json(); } catch (_) {}
      if (!response.ok || !data || !data.ok) {
        throw new Error((data && data.error) || `HTTP ${response.status}`);
      }
    }
    picked.clear();
    await httpLoad();
    syncPicked();
    return ids.length;
  } catch (error) {
    toast("批量操作失败：" + error.message, "err");
    return 0;
  }
}
document.getElementById("bulkDoing").addEventListener("click", () => bulkAction(id => localApiFetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "🔄" }) })));
document.getElementById("bulkDone").addEventListener("click", () => bulkAction(id => localApiFetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "✅" }) })));
document.getElementById("bulkPending").addEventListener("click", () => bulkAction(id => localApiFetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "⏳" }) })));
document.getElementById("bulkDelete").addEventListener("click", async () => {
  const count = picked.size;
  if (!confirm(`确认将选中的 ${count} 个条目移到回收站？`)) return;
  const changed = await bulkAction(id => localApiFetch("/api/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
  if (changed === count) toast(`已将 ${count} 个条目移到回收站`, "ok");
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
  if ((!state.httpMode && !state.demoMode) || !state.items.length) { toast("请先加载数据", "err"); return; }
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
  const gradientStops = [];
  let legend = "";
  let acc = 0;
  const total = segs.reduce((a, s) => a + s.v, 0) || 1;
  segs = segs.filter(s => s.v > 0);
  segs.forEach(s => {
    const from = acc / total * 100;
    acc += s.v;
    const to = acc / total * 100;
    gradientStops.push(`${s.c} ${from}% ${to}%`);
    const name = escapeHtml(String(s.n));
    legend += `<div class="lg"><span class="sw" style="background:${s.c}"></span><span class="nm" title="${escapeAttr(s.n)}">${name}</span><span class="pc">${s.v} · ${(s.v / total * 100).toFixed(0)}%</span></div>`;
  });
  const grad = gradientStops.length ? gradientStops.join(", ") : "var(--border) 0% 100%";
  return `
  <div class="ring-card">
    <div class="rt">${escapeHtml(title)}</div>
    <div class="ring-row">
      <div class="ring" style="background: conic-gradient(${grad})">
        <div class="ring-hole"><span class="rn">${escapeHtml(String(centerNum))}</span><span class="rl">${escapeHtml(String(centerLabel))}</span></div>
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
    ringHtml("r2", "难度分布", diffSegs, (items.reduce((a, i) => a + (i.difficulty || 1), 0) / items.length).toFixed(1), "平均难度") +
    ringHtml("r3", "状态分布", stSegs, total, "总数") +
    ringHtml("r4", "完成进度", [{ n: "已完成", v: done, c: "var(--ok)" }, { n: "未完成", v: total - done, c: "var(--border)" }], (total ? Math.round(done / total * 100) : 0) + "%", "完成率");
  document.getElementById("statsModal").classList.add("open");
}
document.getElementById("statsBtn").addEventListener("click", openStats);
document.getElementById("statsModal").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove("open"); });

/* - 知识关系画布：将本地条目、归档状态与分析关系放到同一操作空间 - */
const RELATIONSHIP_CANVAS = Object.freeze({ width: 1160, height: 1060, nodeWidth: 236, nodeHeight: 108 });
const RELATIONSHIP_SOURCE_LABELS = Object.freeze({
  all: "全部来源", web: "网页链接", github: "GitHub", social: "社交平台", local: "本地记录",
});
const relationshipState = {
  analysis: null,
  source: "all",
  archive: "all",
  scope: "all",
  selectedId: null,
  detailOpen: false,
  positions: new Map(),
  zoom: 1,
  panX: 0,
  panY: 0,
  sequence: 0,
  controller: null,
  pointer: null,
  suppressClick: false,
};

function relationshipSourceType(item) {
  if (!item || !item.url) return "local";
  const host = domain(item.url).toLowerCase();
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (["x.com", "twitter.com", "weibo.com", "bilibili.com", "xiaohongshu.com"].some(value => host === value || host.endsWith("." + value))) return "social";
  return "web";
}

function relationshipArchiveGroup(item) {
  const value = archiveStatus(item).state;
  return ["succeeded", "partial"].includes(value) ? "saved" : "attention";
}

function relationshipField(item, pattern) {
  const field = (item && item.fields || []).find(entry => pattern.test(entry.k));
  return field ? String(field.v || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "").trim() : "";
}

function relationshipFallbackGraph(items) {
  const nodes = items.map(item => ({
    id: item.id,
    title: item.name,
    category: item.category,
    status: item.status,
    url: item.url || "",
    domain: item.url ? domain(item.url) : "",
    tags: item.tags || [],
    hasArchive: relationshipArchiveGroup(item) === "saved",
    cluster: catNo(item.category),
    degree: 0,
  }));
  const candidates = [];
  for (let index = 0; index < nodes.length; index++) {
    for (let next = index + 1; next < nodes.length; next++) {
      const a = nodes[index], b = nodes[next];
      const common = (a.tags || []).filter(tag => (b.tags || []).includes(tag)).slice(0, 3);
      const sameCategory = a.category === b.category;
      const sameDomain = Boolean(a.domain && a.domain === b.domain);
      if (!common.length && !sameDomain && !sameCategory) continue;
      const weight = Math.min(1, common.length * 0.24 + (sameDomain ? 0.3 : 0) + (sameCategory ? 0.16 : 0));
      candidates.push({
        source: a.id, target: b.id, weight,
        signals: common.length ? common : [sameDomain ? a.domain : a.category],
        relation: common.length ? "主题共振" : sameDomain ? "来源生态" : "同类对照",
        types: common.length ? ["theme"] : sameDomain ? ["source"] : ["portfolio"],
      });
    }
  }
  candidates.sort((a, b) => b.weight - a.weight);
  const degree = new Map(nodes.map(node => [node.id, 0]));
  const edges = [];
  for (const edge of candidates) {
    if (edges.length >= 60) break;
    if (degree.get(edge.source) >= 5 || degree.get(edge.target) >= 5) continue;
    edges.push(edge);
    degree.set(edge.source, degree.get(edge.source) + 1);
    degree.set(edge.target, degree.get(edge.target) + 1);
  }
  nodes.forEach(node => { node.degree = degree.get(node.id) || 0; });
  return { nodes, edges };
}

function relationshipHydrateGraph(graph) {
  const itemById = new Map(state.items.map(item => [item.id, item]));
  const sourceNodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const nodes = sourceNodes.map(node => {
    const item = itemById.get(String(node.id));
    if (!item) return null;
    return Object.assign({}, node, {
      id: String(node.id), title: item.name, category: item.category, status: item.status,
      url: item.url || node.url || "", domain: item.url ? domain(item.url) : node.domain || "",
      tags: item.tags || node.tags || [], hasArchive: relationshipArchiveGroup(item) === "saved",
    });
  }).filter(Boolean);
  const ids = new Set(nodes.map(node => node.id));
  const edges = (graph && Array.isArray(graph.edges) ? graph.edges : []).filter(edge => ids.has(String(edge.source)) && ids.has(String(edge.target))).map(edge => Object.assign({}, edge, {
    source: String(edge.source), target: String(edge.target),
  }));
  return { nodes, edges };
}

function relationshipFilteredGraph() {
  const graph = relationshipState.analysis || relationshipFallbackGraph(state.items);
  const itemById = new Map(state.items.map(item => [item.id, item]));
  let nodes = graph.nodes.filter(node => {
    const item = itemById.get(node.id);
    if (!item) return false;
    if (relationshipState.scope === "inbox" && item.status !== "pending") return false;
    if (relationshipState.scope === "review" && item.status !== "done") return false;
    if (relationshipState.source !== "all" && relationshipSourceType(item) !== relationshipState.source) return false;
    if (relationshipState.archive !== "all" && relationshipArchiveGroup(item) !== relationshipState.archive) return false;
    return true;
  });
  nodes = [...nodes].sort((a, b) => {
    if (a.id === relationshipState.selectedId) return -1;
    if (b.id === relationshipState.selectedId) return 1;
    return (b.degree || 0) - (a.degree || 0) || a.id.localeCompare(b.id, "en", { numeric: true });
  }).slice(0, 21);
  const ids = new Set(nodes.map(node => node.id));
  const edges = graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  return { nodes, edges, total: graph.nodes.length };
}

function relationshipLayout(nodes) {
  const ranked = [...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0) || a.id.localeCompare(b.id, "en", { numeric: true }));
  const laneSize = Math.ceil(ranked.length / 3);
  const buckets = [
    ranked.slice(laneSize, laneSize * 2),
    ranked.slice(0, laneSize),
    ranked.slice(laneSize * 2),
  ];
  const zones = [];
  const positions = new Map();
  const occupied = [];
  let adjusted = false;
  const orderedBuckets = buckets.filter(members => members.length).sort((a, b) => {
    const aDegree = Math.max(...a.map(node => node.degree || 0));
    const bDegree = Math.max(...b.map(node => node.degree || 0));
    return bDegree - aDegree || b.length - a.length;
  });
  const columnOrder = [1, 0, 2];
  orderedBuckets.forEach((members, orderIndex) => {
    const column = columnOrder[orderIndex] == null ? orderIndex : columnOrder[orderIndex];
    members.sort((a, b) => (b.degree || 0) - (a.degree || 0) || a.id.localeCompare(b.id, "en", { numeric: true }));
    const zoneMeta = [
      { title: "关联来源", color: "#2c9b73" },
      { title: "重点关系", color: "#8b5cf6" },
      { title: "探索补充", color: "#e6506e" },
    ][column];
    const x = 25 + column * 375;
    const zone = { id: column, title: zoneMeta.title, count: members.length, color: zoneMeta.color, x, y: 58, width: 340, height: 930, nodeIds: new Set(members.map(node => node.id)) };
    zones.push(zone);
    const step = members.length > 1 ? Math.min(185, Math.floor(730 / (members.length - 1))) : 0;
    members.forEach((node, index) => {
      const saved = relationshipState.positions.get(node.id);
      const natural = {
        x: x + 22 + (index % 2) * 70,
        y: 112 + index * step,
      };
      const candidates = [];
      if (saved && relationshipPointInsideZone(saved, zone)) candidates.push(saved);
      else if (saved) adjusted = true;
      candidates.push(natural);
      for (let slot = 0; slot < Math.max(8, members.length + 3); slot++) {
        candidates.push({ x: x + 22 + (slot % 2) * 70, y: 112 + slot * 132 });
      }
      const point = candidates.map(relationshipClampPoint).find(candidate => !occupied.some(other => relationshipPointsOverlap(candidate, other))) || relationshipClampPoint(natural);
      if (saved && (Math.abs(point.x - saved.x) > 1 || Math.abs(point.y - saved.y) > 1)) adjusted = true;
      positions.set(node.id, point);
      occupied.push(point);
    });
  });
  return { positions, zones, adjusted };
}

function relationshipClampPoint(point) {
  return {
    x: Math.max(10, Math.min(RELATIONSHIP_CANVAS.width - RELATIONSHIP_CANVAS.nodeWidth - 10, Number(point.x) || 0)),
    y: Math.max(10, Math.min(RELATIONSHIP_CANVAS.height - RELATIONSHIP_CANVAS.nodeHeight - 10, Number(point.y) || 0)),
  };
}

function relationshipPointInsideZone(point, zone) {
  return point.x >= zone.x + 12
    && point.x <= zone.x + zone.width - RELATIONSHIP_CANVAS.nodeWidth - 12
    && point.y >= zone.y + 42
    && point.y <= zone.y + zone.height - RELATIONSHIP_CANVAS.nodeHeight - 12;
}

function relationshipPointsOverlap(a, b, gap = 16) {
  return a.x < b.x + RELATIONSHIP_CANVAS.nodeWidth + gap
    && a.x + RELATIONSHIP_CANVAS.nodeWidth + gap > b.x
    && a.y < b.y + RELATIONSHIP_CANVAS.nodeHeight + gap
    && a.y + RELATIONSHIP_CANVAS.nodeHeight + gap > b.y;
}

function relationshipNodeLabel(node) {
  if (node.status === "done") return "阶段结论";
  if (node.status === "doing") return "研究判断";
  return "待验证来源";
}

function relationshipArchiveLabel(item) {
  const value = archiveStatus(item).state;
  if (value === "succeeded") return "完整留存";
  if (value === "partial") return "部分留存";
  if (["failed", "manual_required"].includes(value)) return "需要处理";
  return "留存排队中";
}

function relationshipRenderSidebar() {
  const typeCounts = new Map(Object.keys(RELATIONSHIP_SOURCE_LABELS).map(key => [key, 0]));
  state.items.forEach(item => {
    typeCounts.set("all", typeCounts.get("all") + 1);
    const type = relationshipSourceType(item);
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
  });
  const sourceHost = document.getElementById("relationshipSourceFilters");
  sourceHost.innerHTML = [...typeCounts.entries()].filter(([, count]) => count > 0).map(([type, count]) => `
    <button type="button" class="${relationshipState.source === type ? "active" : ""}" data-relationship-source="${type}" aria-pressed="${relationshipState.source === type}">
      <span>${escapeHtml(RELATIONSHIP_SOURCE_LABELS[type])}</span><b>${count}</b>
    </button>`).join("");
  document.getElementById("relationshipAllCount").textContent = state.items.length;
  document.getElementById("relationshipInboxCount").textContent = state.items.filter(item => item.status === "pending").length;
  document.getElementById("relationshipReviewCount").textContent = state.items.filter(item => item.status === "done").length;
  document.getElementById("relationshipArchiveAll").textContent = state.items.length;
  document.getElementById("relationshipArchiveSaved").textContent = state.items.filter(item => relationshipArchiveGroup(item) === "saved").length;
  document.getElementById("relationshipArchiveAttention").textContent = state.items.filter(item => relationshipArchiveGroup(item) === "attention").length;
  document.getElementById("relationshipLocalStatus").textContent = state.httpMode
    ? `${state.items.length} 条记录 · 本地服务已连接`
    : `${state.items.length} 条记录 · 当前为只读模式`;
}

function relationshipPath(a, b) {
  const ax = a.x + RELATIONSHIP_CANVAS.nodeWidth / 2;
  const ay = a.y + RELATIONSHIP_CANVAS.nodeHeight / 2;
  const bx = b.x + RELATIONSHIP_CANVAS.nodeWidth / 2;
  const by = b.y + RELATIONSHIP_CANVAS.nodeHeight / 2;
  const bend = Math.max(42, Math.abs(bx - ax) * 0.42);
  const direction = bx >= ax ? 1 : -1;
  return `M ${ax.toFixed(1)} ${ay.toFixed(1)} C ${(ax + bend * direction).toFixed(1)} ${ay.toFixed(1)}, ${(bx - bend * direction).toFixed(1)} ${by.toFixed(1)}, ${bx.toFixed(1)} ${by.toFixed(1)}`;
}

function relationshipRenderLinks(graph) {
  const selected = relationshipState.selectedId;
  document.getElementById("relationshipLinks").innerHTML = graph.edges.map((edge, index) => {
    const a = relationshipState.positions.get(edge.source), b = relationshipState.positions.get(edge.target);
    if (!a || !b) return "";
    const related = selected && (edge.source === selected || edge.target === selected);
    const muted = selected && !related;
    const relation = edge.relation || "关联";
    const type = (edge.types || [])[0] || "other";
    const cls = `relationship-link relationship-link-${escapeAttr(type)}${related ? " is-related" : ""}${muted ? " is-muted" : ""}`;
    const label = related ? `<text class="relationship-link-label" x="${((a.x + b.x) / 2 + RELATIONSHIP_CANVAS.nodeWidth / 2).toFixed(1)}" y="${((a.y + b.y) / 2 + RELATIONSHIP_CANVAS.nodeHeight / 2 - 9).toFixed(1)}">${escapeHtml(relation)}</text>` : "";
    return `<path class="${cls}" data-relationship-edge="${index}" d="${relationshipPath(a, b)}"><title>${escapeHtml(relation + " · " + (edge.signals || []).join(" / "))}</title></path>${label}`;
  }).join("");
}

function relationshipRenderMinimap(graph) {
  const scaleX = 132 / RELATIONSHIP_CANVAS.width;
  const scaleY = 86 / RELATIONSHIP_CANVAS.height;
  const nodes = graph.nodes.map(node => {
    const point = relationshipState.positions.get(node.id);
    if (!point) return "";
    return `<i class="relationship-minimap-node" style="left:${(point.x * scaleX).toFixed(1)}px;top:${(point.y * scaleY).toFixed(1)}px;--mini-color:${escapeAttr(catColor(node.category))}"></i>`;
  }).join("");
  const viewport = document.getElementById("relationshipViewport");
  const width = Math.min(132, viewport.clientWidth / relationshipState.zoom * scaleX);
  const height = Math.min(86, viewport.clientHeight / relationshipState.zoom * scaleY);
  const left = Math.max(0, Math.min(132 - width, -relationshipState.panX / relationshipState.zoom * scaleX));
  const top = Math.max(0, Math.min(86 - height, -relationshipState.panY / relationshipState.zoom * scaleY));
  document.getElementById("relationshipMinimap").innerHTML = nodes + `<span class="relationship-minimap-window" style="left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${width.toFixed(1)}px;height:${height.toFixed(1)}px"></span>`;
}

function relationshipRenderDetail(graph) {
  const detail = document.getElementById("relationshipDetail");
  const body = document.getElementById("relationshipDetailBody");
  const actions = document.getElementById("relationshipDetailActions");
  const item = state.items.find(entry => entry.id === relationshipState.selectedId);
  const node = graph.nodes.find(entry => entry.id === relationshipState.selectedId);
  if (!item || !node) {
    document.getElementById("relationshipDetailTitle").textContent = "选择一个节点";
    body.innerHTML = '<div class="relationship-detail-empty">点击画布中的来源、判断或待验证事项，查看本地留存状态和关系依据。</div>';
    actions.hidden = true;
    actions.innerHTML = "";
    detail.classList.add("is-collapsed");
    return;
  }
  detail.classList.toggle("is-collapsed", window.innerWidth <= 940 && !relationshipState.detailOpen);
  document.getElementById("relationshipDetailTitle").textContent = item.name;
  const archive = archiveStatus(item);
  const archiveMeta = ARCHIVE_STATUS_META[archive.state];
  const excerpt = relationshipField(item, /关键发现|结论|研究要点|为什么收藏|简介/) || item.desc || "还没有形成摘录。打开研究档案后，可以补充判断、行动项和结论。";
  const related = graph.edges.filter(edge => edge.source === item.id || edge.target === item.id).sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 6);
  const relatedHtml = related.length ? related.map(edge => {
    const otherId = edge.source === item.id ? edge.target : edge.source;
    const other = state.items.find(entry => entry.id === otherId);
    if (!other) return "";
    return `<button type="button" data-relationship-select="${escapeAttr(other.id)}"><strong>${escapeHtml(other.name)}</strong><small>${escapeHtml(edge.relation || "关联")} · ${escapeHtml((edge.signals || []).slice(0, 2).join(" / ") || other.category)}</small></button>`;
  }).join("") : '<p>当前筛选范围内还没有可靠关联。</p>';
  const tags = (item.tags || []).slice(0, 8).map(tag => `<span>${escapeHtml(tag)}</span>`).join("");
  body.innerHTML = `
    <span class="relationship-source-kind">${escapeHtml(relationshipNodeLabel(node))} · ${escapeHtml(RELATIONSHIP_SOURCE_LABELS[relationshipSourceType(item)])}</span>
    <span class="relationship-detail-domain">${escapeHtml(item.url ? domain(item.url) : "本地记录")} · #${escapeHtml(item.id)}</span>
    ${tags ? `<div class="relationship-detail-tags">${tags}</div>` : ""}
    <section class="relationship-detail-section"><strong>内容摘录</strong><p>${escapeHtml(excerpt)}</p></section>
    <section class="relationship-detail-section"><strong>本地存储状态</strong><div class="relationship-archive-summary"><b>${escapeHtml(archiveMeta.label)}</b><span>${escapeHtml(archiveMeta.description)}</span><span>${escapeHtml(archive.updatedAt ? "更新于 " + archiveTimeLabel(archive.updatedAt) : "本地归档状态会在后台刷新")}</span></div></section>
    <section class="relationship-detail-section"><strong>反向链接（${related.length}）</strong><div class="relationship-related-list">${relatedHtml}</div></section>`;
  actions.hidden = false;
  actions.innerHTML = `
    <button type="button" data-relationship-action="study">研究档案</button>
    ${item.url ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">打开原文</a>` : '<button type="button" disabled>没有原文链接</button>'}
    <button type="button" data-relationship-action="copy">复制本地线索</button>
    <button type="button" class="primary" data-relationship-action="verify">带入验证方案</button>`;
}

function updateRelationshipTransform() {
  const scene = document.getElementById("relationshipScene");
  scene.style.transform = `translate3d(${relationshipState.panX.toFixed(1)}px, ${relationshipState.panY.toFixed(1)}px, 0) scale(${relationshipState.zoom.toFixed(3)})`;
  document.getElementById("relationshipZoomLabel").textContent = Math.round(relationshipState.zoom * 100) + "%";
  if (relationshipState.analysis) relationshipRenderMinimap(relationshipFilteredGraph());
}

function fitRelationshipView(options = {}) {
  const viewport = document.getElementById("relationshipViewport");
  if (!viewport.clientWidth || !viewport.clientHeight) return;
  if (options.instant) viewport.classList.add("is-instant-fit");
  const mobileViewport = viewport.clientWidth < 700;
  const minimumZoom = mobileViewport ? 0.42 : 0.62;
  const zoom = Math.min(1, Math.max(minimumZoom, Math.min((viewport.clientWidth - 34) / RELATIONSHIP_CANVAS.width, (viewport.clientHeight - 34) / RELATIONSHIP_CANVAS.height)));
  relationshipState.zoom = zoom;
  const selectedPoint = relationshipState.positions.get(relationshipState.selectedId);
  relationshipState.panX = selectedPoint
    ? viewport.clientWidth / 2 - (selectedPoint.x + RELATIONSHIP_CANVAS.nodeWidth / 2) * zoom
    : mobileViewport
      ? (viewport.clientWidth - RELATIONSHIP_CANVAS.width * zoom) / 2
      : Math.max(16, (viewport.clientWidth - RELATIONSHIP_CANVAS.width * zoom) / 2);
  relationshipState.panY = 24;
  updateRelationshipTransform();
  if (options.instant) requestAnimationFrame(() => viewport.classList.remove("is-instant-fit"));
}

function setRelationshipZoom(nextZoom, anchorX, anchorY) {
  const viewport = document.getElementById("relationshipViewport");
  const rect = viewport.getBoundingClientRect();
  const x = anchorX == null ? viewport.clientWidth / 2 : anchorX - rect.left;
  const y = anchorY == null ? viewport.clientHeight / 2 : anchorY - rect.top;
  const old = relationshipState.zoom;
  const next = Math.max(0.42, Math.min(1.7, nextZoom));
  const sceneX = (x - relationshipState.panX) / old;
  const sceneY = (y - relationshipState.panY) / old;
  relationshipState.zoom = next;
  relationshipState.panX = x - sceneX * next;
  relationshipState.panY = y - sceneY * next;
  updateRelationshipTransform();
}

function renderRelationship(options = {}) {
  relationshipRenderSidebar();
  const graph = relationshipFilteredGraph();
  if (relationshipState.selectedId && !graph.nodes.some(node => node.id === relationshipState.selectedId)) {
    relationshipState.selectedId = null;
    relationshipState.detailOpen = false;
  }
  const empty = document.getElementById("relationshipEmpty");
  if (!graph.nodes.length) {
    document.getElementById("relationshipNodes").innerHTML = "";
    document.getElementById("relationshipLinks").innerHTML = "";
    document.getElementById("relationshipZones").innerHTML = "";
    empty.hidden = false;
    document.getElementById("relationshipSummary").textContent = state.items.length
      ? "当前筛选组合暂无结果"
      : "收藏第一条内容后，这里会自动建立关系";
    empty.innerHTML = state.items.length
      ? '<strong>这个筛选组合下没有内容</strong><span>返回全部范围，重新查看本地条目之间的关系。</span><button type="button" id="relationshipClearFilters">显示全部内容</button>'
      : '<strong>还没有可以整理的内容</strong><span>先收藏一个来源，画布会自动建立可追溯关系。</span><button type="button" id="relationshipEmptyAdd">收藏第一条内容</button>';
    relationshipRenderDetail(graph);
    return;
  }
  empty.hidden = true;
  const layout = relationshipLayout(graph.nodes);
  layout.positions.forEach((point, id) => relationshipState.positions.set(id, point));
  if (layout.adjusted) queueMicrotask(saveRelationshipPositions);
  const selected = relationshipState.selectedId;
  const relatedIds = new Set();
  if (selected) graph.edges.forEach(edge => {
    if (edge.source === selected) relatedIds.add(edge.target);
    if (edge.target === selected) relatedIds.add(edge.source);
  });
  const itemById = new Map(state.items.map(item => [item.id, item]));
  document.getElementById("relationshipZones").innerHTML = layout.zones.map(zone => `<div class="relationship-zone" style="left:${zone.x}px;top:${zone.y}px;width:${zone.width}px;height:${zone.height}px;--zone-color:${escapeAttr(zone.color)}"><span><b>${escapeHtml(zone.title)}</b><small>${zone.count} 个节点</small></span></div>`).join("");
  document.getElementById("relationshipNodes").innerHTML = graph.nodes.map(node => {
    const item = itemById.get(node.id);
    const point = relationshipState.positions.get(node.id);
    const muted = selected && selected !== node.id && !relatedIds.has(node.id);
    const sourceLabel = RELATIONSHIP_SOURCE_LABELS[relationshipSourceType(item)];
    return `<button type="button" class="relationship-node${selected === node.id ? " is-selected" : ""}${relatedIds.has(node.id) ? " is-related" : ""}${muted ? " is-muted" : ""}" data-relationship-node="${escapeAttr(node.id)}" style="--node-x:${point.x}px;--node-y:${point.y}px;--node-color:${escapeAttr(catColor(item.category))}" role="listitem" aria-label="${escapeAttr(node.title)}，${escapeAttr(relationshipArchiveLabel(item))}">
      <span class="relationship-node-type"><span>${escapeHtml(relationshipNodeLabel(node))}</span><b>${escapeHtml(item.category)}</b></span>
      <strong>${escapeHtml(node.title)}</strong>
      <span class="relationship-node-meta"><span>${escapeHtml(item.url ? domain(item.url) : sourceLabel)}</span><b>${escapeHtml(relationshipArchiveLabel(item))}</b></span>
    </button>`;
  }).join("");
  relationshipRenderLinks(graph);
  relationshipRenderMinimap(graph);
  relationshipRenderDetail(graph);
  document.getElementById("relationshipSummary").textContent = `${graph.nodes.length} 个可见节点 · ${graph.edges.length} 条可追溯关系${graph.total > graph.nodes.length ? ` · 已聚焦高关联节点` : ""}`;
  if (options.fit) {
    fitRelationshipView({ instant: options.instantFit });
    requestAnimationFrame(() => fitRelationshipView({ instant: options.instantFit }));
  }
  else updateRelationshipTransform();
}

function saveRelationshipPositions() {
  const record = {};
  relationshipState.positions.forEach((point, id) => { record[id] = { x: Math.round(point.x), y: Math.round(point.y) }; });
  try { localStorage.setItem("relationship_positions_v1", JSON.stringify(record)); } catch (_) {}
}

function restoreRelationshipPositions() {
  try {
    const record = JSON.parse(localStorage.getItem("relationship_positions_v1") || "{}");
    Object.entries(record).forEach(([id, point]) => {
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) relationshipState.positions.set(id, { x: point.x, y: point.y });
    });
  } catch (_) {}
}
restoreRelationshipPositions();

async function loadRelationship() {
  const sequence = ++relationshipState.sequence;
  if (relationshipState.controller) relationshipState.controller.abort();
  relationshipState.controller = new AbortController();
  const status = document.getElementById("relationshipAnalysisState");
  status.textContent = "正在分析本地关系…";
  try {
    let graph;
    if (state.demoMode) {
      const response = await fetch("demo-brainstorm.json", { cache: "no-store", signal: relationshipState.controller.signal });
      const data = await readJsonResponse(response);
      graph = data.graph;
    } else if (state.httpMode) {
      const goal = state.category ? `整理“${state.category}”中的项目关系` : "整理本地知识库中的来源、判断与验证关系";
      const response = await localApiFetch("/api/brainstorm?mode=panorama&goal=" + encodeURIComponent(goal), { cache: "no-store", signal: relationshipState.controller.signal });
      const data = await readJsonResponse(response);
      graph = data.graph;
    }
    if (sequence !== relationshipState.sequence) return;
    const hydrated = relationshipHydrateGraph(graph || relationshipFallbackGraph(state.items));
    relationshipState.analysis = hydrated.nodes.length ? hydrated : relationshipFallbackGraph(state.items);
    status.textContent = "本地分析已更新";
  } catch (error) {
    if (error.name === "AbortError" || sequence !== relationshipState.sequence) return;
    relationshipState.analysis = relationshipFallbackGraph(state.items);
    status.textContent = "已使用离线基础关系";
  } finally {
    if (sequence !== relationshipState.sequence) return;
    relationshipState.controller = null;
    renderRelationship({ fit: true });
  }
}

function selectRelationshipNode(id) {
  if (!state.items.some(item => item.id === String(id))) return;
  relationshipState.selectedId = String(id);
  relationshipState.detailOpen = true;
  renderRelationship({ fit: true, instantFit: true });
  requestAnimationFrame(() => document.querySelector(`[data-relationship-node="${CSS.escape(String(id))}"]`)?.focus({ preventScroll: true }));
}

function selectedRelationshipItem() {
  return state.items.find(item => item.id === relationshipState.selectedId) || null;
}

function openRelationship() {
  if (!state.items.length) { toast("请先新增至少一条本地记录", "err"); return; }
  setProductView("relationship");
}

const relationshipSidebar = document.getElementById("relationshipSidebar");
const relationshipSidebarScrim = document.getElementById("relationshipSidebarScrim");
const relationshipFilterButton = document.getElementById("relationshipFilterBtn");
let relationshipSidebarGesture = null;
function relationshipCompactLayout() {
  return window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
}
function setRelationshipSidebar(open, options = {}) {
  const compact = relationshipCompactLayout();
  const visible = compact && Boolean(open);
  relationshipSidebar.classList.toggle("is-open", visible);
  relationshipSidebar.inert = compact && !visible;
  relationshipSidebar.setAttribute("aria-hidden", String(compact && !visible));
  relationshipSidebarScrim.hidden = false;
  relationshipSidebarScrim.classList.toggle("is-open", visible);
  relationshipFilterButton.setAttribute("aria-expanded", String(visible));
  if (visible && options.focus !== false) {
    requestAnimationFrame(() => document.getElementById("relationshipSidebarClose").focus({ preventScroll: true }));
  } else if (!visible && options.restoreFocus) {
    relationshipFilterButton.focus({ preventScroll: true });
  }
}
function closeRelationshipSidebarAfterFilter() {
  if (relationshipCompactLayout()) setRelationshipSidebar(false, { restoreFocus: true });
}

/* - 头脑风暴：与灵感看板同级的多维知识碰撞工作台 - */
let brainstormMode = "fusion";
let brainstormLoadSequence = 0;
let brainstormController = null;
let productView = "inspiration";

function setProductView(view, options) {
  options = options || {};
  productView = ["relationship", "brainstorm"].includes(view) ? view : "inspiration";
  const brainstormActive = productView === "brainstorm";
  const relationshipActive = productView === "relationship";
  document.body.classList.toggle("brainstorm-active", brainstormActive);
  document.body.classList.toggle("relationship-active", relationshipActive);
  document.getElementById("brainstormView").hidden = !brainstormActive;
  document.getElementById("relationshipView").hidden = !relationshipActive;
  document.querySelectorAll("[data-product-view]").forEach(button => {
    const selected = button.dataset.productView === productView;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  setRelationshipSidebar(false, { focus: false });
  try { localStorage.setItem("product_view", productView); } catch (_) {}
  if (brainstormActive && options.load !== false) {
    loadBrainstorm();
    loadBrainstormHistory();
  }
  if (relationshipActive) {
    if (options.load !== false) loadRelationship();
    else renderRelationship({ fit: options.fit !== false });
  }
  const surface = relationshipActive ? document.getElementById("relationshipView")
    : brainstormActive ? document.getElementById("brainstormView") : document.getElementById("banner");
  restartSurfaceMotion(surface);
  if (brainstormActive || relationshipActive) {
    window.scrollTo({ top: 0, behavior: options.instant || prefersReduce() ? "auto" : "smooth" });
  }
}

function startRelationshipVerification() {
  const item = selectedRelationshipItem();
  const goal = item
    ? `围绕“${item.name}”形成一套有来源依据、可回滚的最小验证方案`
    : "从当前知识关系中选择高价值连接，形成一套可验证的下一步方案";
  document.getElementById("brainstormGoal").value = goal;
  setProductView("brainstorm", { load: false, instant: true });
  activateBrainstormMode(document.querySelector('[data-brainstorm-mode="fusion"]'));
}

document.getElementById("relationshipNav").addEventListener("click", openRelationship);
document.getElementById("relationshipRefreshBtn").addEventListener("click", loadRelationship);
relationshipFilterButton.addEventListener("click", () => setRelationshipSidebar(true));
document.getElementById("relationshipSidebarClose").addEventListener("click", () => setRelationshipSidebar(false, { restoreFocus: true }));
relationshipSidebarScrim.addEventListener("click", () => setRelationshipSidebar(false, { restoreFocus: true }));
relationshipSidebar.addEventListener("pointerdown", event => {
  if (!relationshipCompactLayout() || !relationshipSidebar.classList.contains("is-open") || event.pointerType !== "touch") return;
  if (!event.target.closest(".relationship-sidebar-grab, .relationship-rail-heading") || event.target.closest("button")) return;
  if (relationshipSidebarGesture) return;
  relationshipSidebarGesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    currentX: event.clientX,
    startedAt: performance.now(),
  };
  relationshipSidebar.classList.add("is-dragging");
  relationshipSidebar.setPointerCapture(event.pointerId);
});
relationshipSidebar.addEventListener("pointermove", event => {
  const gesture = relationshipSidebarGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  gesture.currentX = event.clientX;
  const distance = Math.min(0, event.clientX - gesture.startX);
  relationshipSidebar.style.transform = `translate3d(${distance}px, 0, 0)`;
  relationshipSidebarScrim.style.opacity = String(Math.max(0, 1 + distance / Math.max(1, relationshipSidebar.offsetWidth)));
  event.preventDefault();
});
function finishRelationshipSidebarGesture(event, cancelled = false) {
  const gesture = relationshipSidebarGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const distance = Math.min(0, gesture.currentX - gesture.startX);
  const elapsed = Math.max(1, performance.now() - gesture.startedAt);
  const velocity = Math.abs(distance) / elapsed;
  const dismiss = !cancelled && (distance < -72 || velocity > 0.35);
  if (relationshipSidebar.hasPointerCapture(event.pointerId)) relationshipSidebar.releasePointerCapture(event.pointerId);
  relationshipSidebarGesture = null;
  relationshipSidebar.classList.remove("is-dragging");
  relationshipSidebar.style.removeProperty("transform");
  relationshipSidebarScrim.style.removeProperty("opacity");
  setRelationshipSidebar(!dismiss, { focus: false, restoreFocus: dismiss });
}
relationshipSidebar.addEventListener("pointerup", event => finishRelationshipSidebarGesture(event));
relationshipSidebar.addEventListener("pointercancel", event => finishRelationshipSidebarGesture(event, true));
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || !relationshipSidebar.classList.contains("is-open")) return;
  event.preventDefault();
  setRelationshipSidebar(false, { restoreFocus: true });
});
document.getElementById("relationshipDataBtn").addEventListener("click", () => document.getElementById("dataBtn").click());
document.getElementById("relationshipAddBtn").addEventListener("click", () => document.getElementById("addBtn").click());
document.getElementById("relationshipNoteBtn").addEventListener("click", () => {
  const item = selectedRelationshipItem();
  if (!item) { toast("请先选择一个节点", "err"); return; }
  openEntry(item.id, { returnView: "relationship" });
});
document.getElementById("relationshipVerifyBtn").addEventListener("click", startRelationshipVerification);
document.getElementById("relationshipArrangeBtn").addEventListener("click", () => {
  relationshipState.positions.clear();
  try { localStorage.removeItem("relationship_positions_v1"); } catch (_) {}
  renderRelationship({ fit: true });
  toast("已恢复自动关系布局", "ok");
});
function resetRelationshipFilters() {
  relationshipState.source = "all";
  relationshipState.archive = "all";
  relationshipState.scope = "all";
  document.querySelectorAll("[data-relationship-scope]").forEach(button => {
    const active = button.dataset.relationshipScope === "all";
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-relationship-archive]").forEach(button => {
    const active = button.dataset.relationshipArchive === "all";
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderRelationship({ fit: true });
  closeRelationshipSidebarAfterFilter();
}
document.getElementById("relationshipSourceReset").addEventListener("click", resetRelationshipFilters);
document.getElementById("relationshipEmpty").addEventListener("click", event => {
  if (event.target.closest("#relationshipClearFilters")) resetRelationshipFilters();
  if (event.target.closest("#relationshipEmptyAdd")) document.getElementById("addBtn").click();
});
document.querySelector(".relationship-scope").addEventListener("click", event => {
  const button = event.target.closest("[data-relationship-scope]");
  if (!button) return;
  relationshipState.scope = button.dataset.relationshipScope;
  document.querySelectorAll("[data-relationship-scope]").forEach(item => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  renderRelationship({ fit: true });
  closeRelationshipSidebarAfterFilter();
});
document.getElementById("relationshipSourceFilters").addEventListener("click", event => {
  const button = event.target.closest("[data-relationship-source]");
  if (!button) return;
  relationshipState.source = button.dataset.relationshipSource;
  renderRelationship({ fit: true });
  closeRelationshipSidebarAfterFilter();
});
document.getElementById("relationshipArchiveFilters").addEventListener("click", event => {
  const button = event.target.closest("[data-relationship-archive]");
  if (!button) return;
  relationshipState.archive = button.dataset.relationshipArchive;
  document.querySelectorAll("[data-relationship-archive]").forEach(item => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  renderRelationship({ fit: true });
  closeRelationshipSidebarAfterFilter();
});
document.getElementById("relationshipNodes").addEventListener("click", event => {
  const node = event.target.closest("[data-relationship-node]");
  if (!node || relationshipState.suppressClick) return;
  selectRelationshipNode(node.dataset.relationshipNode);
});
document.getElementById("relationshipDetailClose").addEventListener("click", () => {
  relationshipState.detailOpen = false;
  document.getElementById("relationshipDetail").classList.add("is-collapsed");
  document.getElementById("relationshipViewport").focus({ preventScroll: true });
});
document.getElementById("relationshipDetail").addEventListener("click", async event => {
  const related = event.target.closest("[data-relationship-select]");
  if (related) { selectRelationshipNode(related.dataset.relationshipSelect); return; }
  const action = event.target.closest("[data-relationship-action]");
  const item = selectedRelationshipItem();
  if (!action || !item) return;
  if (action.dataset.relationshipAction === "study") openEntry(item.id, { returnView: "relationship" });
  else if (action.dataset.relationshipAction === "verify") startRelationshipVerification();
  else if (action.dataset.relationshipAction === "copy") {
    if (item.url) await copyLink(item.url);
    else {
      try { await navigator.clipboard.writeText(`${item.id} · ${item.name}`); toast("本地线索已复制", "ok"); }
      catch (_) { toast("复制失败，请手动复制", "err"); }
    }
  }
});

const relationshipViewport = document.getElementById("relationshipViewport");
relationshipViewport.addEventListener("wheel", event => {
  event.preventDefault();
  setRelationshipZoom(relationshipState.zoom * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY);
}, { passive: false });
relationshipViewport.addEventListener("dblclick", event => {
  if (!event.target.closest("[data-relationship-node]")) fitRelationshipView();
});
relationshipViewport.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  const node = event.target.closest("[data-relationship-node]");
  if (node) {
    const point = relationshipState.positions.get(node.dataset.relationshipNode);
    if (!point) return;
    relationshipState.pointer = {
      type: "node", pointerId: event.pointerId, id: node.dataset.relationshipNode,
      startX: event.clientX, startY: event.clientY, pointX: point.x, pointY: point.y, moved: false,
    };
    node.classList.add("is-dragging");
    relationshipViewport.classList.add("is-dragging-node");
  } else {
    relationshipState.pointer = {
      type: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      panX: relationshipState.panX, panY: relationshipState.panY, moved: false,
    };
    relationshipViewport.classList.add("is-panning");
    event.preventDefault();
  }
  relationshipViewport.setPointerCapture(event.pointerId);
});
relationshipViewport.addEventListener("pointermove", event => {
  const pointer = relationshipState.pointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  const dx = event.clientX - pointer.startX;
  const dy = event.clientY - pointer.startY;
  pointer.moved = pointer.moved || Math.hypot(dx, dy) > 4;
  if (pointer.type === "pan") {
    relationshipState.panX = pointer.panX + dx;
    relationshipState.panY = pointer.panY + dy;
    updateRelationshipTransform();
    return;
  }
  const point = {
    x: Math.max(10, Math.min(RELATIONSHIP_CANVAS.width - RELATIONSHIP_CANVAS.nodeWidth - 10, pointer.pointX + dx / relationshipState.zoom)),
    y: Math.max(10, Math.min(RELATIONSHIP_CANVAS.height - RELATIONSHIP_CANVAS.nodeHeight - 10, pointer.pointY + dy / relationshipState.zoom)),
  };
  relationshipState.positions.set(pointer.id, point);
  const node = document.querySelector(`[data-relationship-node="${CSS.escape(pointer.id)}"]`);
  if (node) {
    node.style.setProperty("--node-x", point.x + "px");
    node.style.setProperty("--node-y", point.y + "px");
  }
  const graph = relationshipFilteredGraph();
  relationshipRenderLinks(graph);
  relationshipRenderMinimap(graph);
});
function finishRelationshipPointer(event) {
  const pointer = relationshipState.pointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  if (relationshipViewport.hasPointerCapture(event.pointerId)) relationshipViewport.releasePointerCapture(event.pointerId);
  relationshipViewport.classList.remove("is-panning", "is-dragging-node");
  document.querySelector(".relationship-node.is-dragging")?.classList.remove("is-dragging");
  if (pointer.type === "node" && pointer.moved) {
    const point = relationshipState.positions.get(pointer.id);
    const graph = relationshipFilteredGraph();
    const semanticZone = relationshipLayout(graph.nodes).zones.find(zone => zone.nodeIds.has(pointer.id));
    const outsideSemanticZone = semanticZone && !relationshipPointInsideZone(point, semanticZone);
    const collides = graph.nodes.some(node => node.id !== pointer.id && relationshipPointsOverlap(point, relationshipState.positions.get(node.id)));
    if (outsideSemanticZone) {
      renderRelationship();
      toast("节点已留在所属主题分区", "ok");
    } else if (collides) {
      relationshipState.positions.set(pointer.id, { x: pointer.pointX, y: pointer.pointY });
      renderRelationship();
      toast("节点之间需要留出一点空间", "err");
    } else {
      const dropped = { x: point.x, y: point.y };
      saveRelationshipPositions();
      renderRelationship();
      const settled = relationshipState.positions.get(pointer.id);
      if (Math.abs(settled.x - dropped.x) > 1 || Math.abs(settled.y - dropped.y) > 1) toast("节点已留在所属主题分区", "ok");
    }
    relationshipState.suppressClick = true;
    setTimeout(() => { relationshipState.suppressClick = false; }, 0);
  }
  relationshipState.pointer = null;
}
relationshipViewport.addEventListener("pointerup", finishRelationshipPointer);
relationshipViewport.addEventListener("pointercancel", finishRelationshipPointer);
relationshipViewport.addEventListener("keydown", event => {
  if (["+", "="].includes(event.key)) { event.preventDefault(); setRelationshipZoom(relationshipState.zoom * 1.12); }
  else if (event.key === "-") { event.preventDefault(); setRelationshipZoom(relationshipState.zoom * 0.88); }
  else if (event.key === "0" || event.key === "Home") { event.preventDefault(); fitRelationshipView(); }
  else if (event.key === "Escape") {
    relationshipState.selectedId = null;
    renderRelationship();
  }
});
document.getElementById("relationshipZoomIn").addEventListener("click", () => setRelationshipZoom(relationshipState.zoom * 1.12));
document.getElementById("relationshipZoomOut").addEventListener("click", () => setRelationshipZoom(relationshipState.zoom * 0.88));
document.getElementById("relationshipResetView").addEventListener("click", fitRelationshipView);
let relationshipResizeTimer = null;
window.addEventListener("resize", () => {
  if (productView !== "relationship") return;
  clearTimeout(relationshipResizeTimer);
  relationshipResizeTimer = setTimeout(() => {
    setRelationshipSidebar(false, { focus: false });
    renderRelationship();
    fitRelationshipView();
  }, 120);
});

function brainstormPositions(nodes, width, height) {
  const groups = new Map();
  nodes.forEach(node => {
    if (!groups.has(node.cluster)) groups.set(node.cluster, []);
    groups.get(node.cluster).push(node);
  });
  const clusters = [...groups.values()].sort((a, b) => b.length - a.length);
  const positions = new Map();
  const centerX = width / 2, centerY = height / 2;
  const orbitX = Math.max(80, width * 0.29), orbitY = Math.max(62, height * 0.25);
  clusters.forEach((members, clusterIndex) => {
    const clusterAngle = clusters.length === 1 ? 0 : Math.PI * 2 * clusterIndex / clusters.length - Math.PI / 2;
    const cx = clusters.length === 1 ? centerX : centerX + Math.cos(clusterAngle) * orbitX;
    const cy = clusters.length === 1 ? centerY : centerY + Math.sin(clusterAngle) * orbitY;
    members.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id, "en", { numeric: true }));
    if (members.length === 1) {
      positions.set(members[0].id, { x: cx, y: cy });
      return;
    }
    members.forEach((node, memberIndex) => {
      if (memberIndex === 0) {
        positions.set(node.id, { x: cx, y: cy });
        return;
      }
      const ringIndex = Math.floor((memberIndex - 1) / 10);
      const ringStart = ringIndex * 10 + 1;
      const ringCount = Math.min(10, members.length - ringStart);
      const angle = Math.PI * 2 * (memberIndex - ringStart) / Math.max(1, ringCount) + clusterAngle;
      const radius = 38 + ringIndex * 34 + Math.min(28, members.length * 2);
      positions.set(node.id, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    });
  });
  return positions;
}

function graphTextColor(color) {
  const match = String(color || "").match(/^#([0-9a-f]{6})$/i);
  if (!match) return "#ffffff";
  const value = parseInt(match[1], 16);
  const red = value >> 16, green = value >> 8 & 255, blue = value & 255;
  return red * 0.299 + green * 0.587 + blue * 0.114 > 155 ? "#0b0b10" : "#ffffff";
}

function renderBrainstormGraph(graph) {
  const container = document.getElementById("brainstormGraph");
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];
  if (!nodes.length) {
    container.innerHTML = '<div class="brainstorm-empty">还没有可分析的事项。先新增至少两个待研究条目。</div>';
    return;
  }
  const width = 760, height = 480;
  const positions = brainstormPositions(nodes, width, height);
  const links = edges.map(edge => {
    const a = positions.get(edge.source), b = positions.get(edge.target);
    if (!a || !b) return "";
    const relationClass = (edge.types || []).includes("cross") ? " relation-cross" : (edge.types || []).includes("source") ? " relation-source" : "";
    return `<line class="brainstorm-link${relationClass}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-width="${(0.8 + edge.weight * 2.4).toFixed(1)}" opacity="${(0.2 + edge.weight * 0.55).toFixed(2)}"><title>${escapeHtml((edge.relation || "关联") + " · " + (edge.signals || []).join(" / "))}</title></line>`;
  }).join("");
  const showAllLabels = nodes.length <= 18;
  const nodeHtml = nodes.map(node => {
    const point = positions.get(node.id);
    const radius = Math.min(15, 7 + (node.degree || 0) * 1.6);
    const nodeColor = catColor(node.category);
    const textColor = graphTextColor(nodeColor);
    const label = node.title.length > 12 ? node.title.slice(0, 11) + "…" : node.title;
    const showLabel = showAllLabels || node.degree >= 3;
    return `<g class="brainstorm-node" data-brainstorm-entry="${escapeAttr(node.id)}" role="button" tabindex="0" aria-label="打开 ${escapeAttr(node.title)}">
      <title>${escapeHtml(node.id + " · " + node.title + " · " + node.category)}</title>
      <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${escapeAttr(nodeColor)}" opacity="${node.status === "done" ? "0.58" : "0.95"}"></circle>
      <text class="node-id" x="${point.x.toFixed(1)}" y="${(point.y + 2.8).toFixed(1)}" fill="${textColor}">${escapeHtml(node.id)}</text>
      ${showLabel ? `<text class="node-label" x="${point.x.toFixed(1)}" y="${(point.y + radius + 14).toFixed(1)}">${escapeHtml(label)}</text>` : ""}
    </g>`;
  }).join("");
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${nodes.length} 个事项、${edges.length} 条关联组成的知识图谱">${links}${nodeHtml}</svg>`;
}

function renderBrainstormDimensions(dimensions) {
  const container = document.getElementById("brainstormDimensions");
  const items = (dimensions || []).filter(item => item.count > 0);
  if (!items.length) {
    container.innerHTML = '<div class="brainstorm-empty">当前数据还不足以形成多维关系。</div>';
    return;
  }
  container.innerHTML = items.map(item => `
    <article class="brainstorm-dimension-card" data-dimension="${escapeAttr(item.id)}">
      <div class="dimension-top"><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.count)}</b></div>
      <p>${escapeHtml(item.description)}</p>
      <div class="brainstorm-signals">${(item.signals || []).map(signal => `<span>${escapeHtml(signal)}</span>`).join("")}</div>
      <div class="brainstorm-evidence">${(item.evidence || []).slice(0, 3).map(entry => `<button type="button" data-brainstorm-entry="${escapeAttr(entry.id)}" title="${escapeAttr(entry.title)}">${escapeHtml(entry.id)}</button>`).join("")}</div>
    </article>`).join("");
}

function renderBrainstormMatrix(matrix) {
  const container = document.getElementById("brainstormMatrix");
  if (!matrix || !matrix.length) {
    container.innerHTML = '<div class="brainstorm-empty">暂未发现跨分类碰撞；补充场景和能力标签后会自动更新。</div>';
    return;
  }
  container.innerHTML = matrix.map(item => `
    <article class="brainstorm-matrix-row">
      <div class="matrix-pair"><strong>${escapeHtml(item.source)}</strong><span>×</span><strong>${escapeHtml(item.target)}</strong></div>
      <div class="matrix-score"><span style="width:${Math.max(8, item.strength)}%"></span></div>
      <div class="matrix-meta"><span>${escapeHtml(item.count)} 条连接</span><b>${escapeHtml(item.strength)}%</b></div>
      <div class="brainstorm-signals">${(item.signals || []).map(signal => `<span>${escapeHtml(signal)}</span>`).join("")}</div>
      <div class="brainstorm-evidence">${(item.evidence || []).map(entry => `<button type="button" data-brainstorm-entry="${escapeAttr(entry.id)}" title="${escapeAttr(entry.title)}">${escapeHtml(entry.id + " · " + entry.title)}</button>`).join("")}</div>
    </article>`).join("");
}

function renderBrainstormFusion(fusion) {
  const container = document.getElementById("brainstormFusion");
  const meta = document.getElementById("brainstormFusionMeta");
  if (!fusion || !fusion.goal) {
    meta.textContent = "先输入一个实际需求，再开始能力融合";
    container.innerHTML = '<div class="brainstorm-empty">请先描述你真正想解决的问题、使用场景或偏好结果。</div>';
    return;
  }
  const plans = fusion.plans || [];
  meta.textContent = `找到 ${fusion.matches.length} 个候选项目，形成 ${plans.length} 条路径 · 点击项目查看研究档案`;
  if (!plans.length) {
    container.innerHTML = '<div class="brainstorm-empty">当前记录还不足以组成融合方案，请补充相关项目或更具体地描述需求。</div>';
    return;
  }
  const featured = plans[0];
  const contributionHtml = (item, compact = false) => (item.contributions || []).map((contribution, contributionIndex) => `
    <div class="fusion-contribution${compact ? " compact" : ""}">
      <span class="fusion-index">${String(contributionIndex + 1).padStart(2, "0")}</span>
      <div><button type="button" data-brainstorm-entry="${escapeAttr(contribution.id)}">${escapeHtml(contribution.title)}</button><strong>${escapeHtml(contribution.strength)}</strong>${compact ? "" : `<small>${escapeHtml(contribution.reason)}</small>`}</div>
    </div>`).join("");
  container.innerHTML = `
    <article class="brainstorm-fusion-card featured">
      <div class="fusion-card-top"><span>推荐方案</span><b>${escapeHtml(featured.score)} 分 · ${escapeHtml(featured.confidence)}置信度</b></div>
      <div class="fusion-featured-head">
        <div><span>融合目标</span><h3>${escapeHtml(featured.goal)}</h3></div>
        <p>${escapeHtml(featured.summary)}</p>
      </div>
      <div class="fusion-featured-grid">
        <div class="fusion-source-column"><h4>这些项目分别贡献什么</h4><div class="fusion-recipe">${contributionHtml(featured)}</div><p class="fusion-rationale">${escapeHtml(featured.rationale)}</p></div>
        <aside class="fusion-mvp"><span>最小验证路径</span><ol>${(featured.mvp || []).map(step => `<li>${escapeHtml(step)}</li>`).join("")}</ol></aside>
      </div>
    </article>
    ${plans.length > 1 ? `<div class="fusion-alternatives"><div class="fusion-alternatives-title"><strong>备选组合</strong><span>需要更多方向时再展开</span></div>${plans.slice(1).map(item => `
      <details class="brainstorm-fusion-alt">
        <summary><span><b>${escapeHtml(item.type)}</b><small>${escapeHtml((item.evidence || []).map(entry => entry.title).join(" + "))}</small></span><em>${escapeHtml(item.score)} 分</em></summary>
        <div class="fusion-alt-body"><p>${escapeHtml(item.summary)}</p><div class="fusion-recipe">${contributionHtml(item, true)}</div><strong>验证步骤</strong><ol>${(item.mvp || []).map(step => `<li>${escapeHtml(step)}</li>`).join("")}</ol></div>
      </details>`).join("")}</div>` : ""}`;
}

function updateBrainstormPanels(mode = brainstormMode) {
  const fusionMode = mode === "fusion";
  const panoramaMode = mode === "panorama";
  const suggestionMode = ["opportunities", "challenges", "roadmap"].includes(mode);
  document.getElementById("brainstormFusionPanel").hidden = !fusionMode;
  document.getElementById("brainstormDimensionsPanel").hidden = !panoramaMode;
  document.getElementById("brainstormNetworkPanel").hidden = !panoramaMode;
  const suggestionPanel = document.getElementById("brainstormSuggestionsPanel");
  suggestionPanel.hidden = !suggestionMode;
  if (suggestionMode) {
    const activeTab = document.querySelector(`[data-brainstorm-mode="${mode}"]`);
    suggestionPanel.setAttribute("aria-labelledby", `${activeTab.id} brainstormSuggestionsTitle`);
  }
  const labels = {
    opportunities: ["可验证的机会", "从组合、迁移与成果复用中选择下一步"],
    challenges: ["盲区与证据缺口", "先补齐依据，再决定是否投入"],
    roadmap: ["建议行动路线", "按价值、关联度和验证成本安排顺序"],
  };
  if (labels[mode]) {
    document.getElementById("brainstormSuggestionsTitle").textContent = labels[mode][0];
    document.querySelector("#brainstormSuggestionsPanel .brainstorm-section-head span").textContent = labels[mode][1];
  }
}

function renderBrainstormSuggestions(suggestions) {
  const container = document.getElementById("brainstormSuggestions");
  if (!suggestions || !suggestions.length) {
    container.innerHTML = '<div class="brainstorm-empty">暂时没有形成可靠建议。为条目补充标签和收藏原因后再分析。</div>';
    return;
  }
  const dimensionLabels = {
    cross: "组合碰撞", transfer: "跨域迁移", compare: "同类对照", theme: "主题经营",
    opportunity: "机会验证", challenge: "盲区挑战", roadmap: "行动路线",
    fusion: "需求融合",
  };
  container.innerHTML = suggestions.map(item => `
    <article class="brainstorm-suggestion">
      <div class="idea-top"><span class="idea-type">${escapeHtml(item.type)}</span><span class="idea-dimension">${escapeHtml(dimensionLabels[item.dimension] || "综合分析")}</span><span class="idea-confidence">置信度 ${escapeHtml(item.confidence)}</span><span class="idea-score">${escapeHtml(item.score)} 分</span></div>
      <h4>${escapeHtml(item.title)}</h4>
      <p>${escapeHtml(item.summary)}</p>
      <div class="brainstorm-signals">${(item.signals || []).map(signal => `<span>${escapeHtml(signal)}</span>`).join("")}</div>
      <p>${escapeHtml(item.rationale)}</p>
      <div class="brainstorm-evidence">${(item.evidence || []).map(entry => `<button type="button" data-brainstorm-entry="${escapeAttr(entry.id)}" title="${escapeAttr(entry.title)}">${escapeHtml(entry.id + " · " + entry.title)}</button>`).join("")}</div>
      <details><summary>查看最小验证步骤</summary><ol>${(item.mvp || []).map(step => `<li>${escapeHtml(step)}</li>`).join("")}</ol></details>
    </article>`).join("");
}

function renderBrainstorm(data) {
  const summary = data.summary || {};
  document.getElementById("brainstormSummary").innerHTML = [
    [summary.items || 0, "项目"], [summary.relations || 0, "关系"], [(summary.archiveCoverage || 0) + "%", "档案覆盖"],
  ].map(([value, label]) => `<span class="bs-stat"><b>${escapeHtml(value)}</b>${escapeHtml(label)}</span>`).join("");
  document.getElementById("brainstormInsights").innerHTML = (data.insights || []).map(item => `<span>${escapeHtml(item)}</span>`).join("");
  renderBrainstormFusion(data.fusion);
  renderBrainstormDimensions(data.dimensions);
  renderBrainstormGraph(data.graph);
  renderBrainstormMatrix(data.collisionMatrix);
  renderBrainstormSuggestions(data.suggestions);
  updateBrainstormPanels();
}

async function loadBrainstorm() {
  const sequence = ++brainstormLoadSequence;
  if (brainstormController) brainstormController.abort();
  brainstormController = new AbortController();
  const graph = document.getElementById("brainstormGraph");
  const fusion = document.getElementById("brainstormFusion");
  const dimensions = document.getElementById("brainstormDimensions");
  const matrix = document.getElementById("brainstormMatrix");
  const suggestions = document.getElementById("brainstormSuggestions");
  const button = document.getElementById("brainstormRefreshBtn");
  const saveButton = document.getElementById("brainstormSaveBtn");
  const goalButton = document.getElementById("brainstormGoalBtn");
  const goal = document.getElementById("brainstormGoal").value.trim().slice(0, 400);
  if (!goal && !state.demoMode) {
    brainstormController = null;
    brainstormLastAnalysis = null;
    document.getElementById("brainstormSummary").textContent = "先写下一个真实问题，再从收藏中寻找组合方案";
    document.getElementById("brainstormInsights").innerHTML = "";
    graph.innerHTML = '<div class="brainstorm-empty">输入需求后，这里会展示可追溯的项目关系。</div>';
    fusion.innerHTML = '<div class="brainstorm-empty brainstorm-goal-empty"><strong>先明确这次要解决的问题</strong><span>可以直接输入，也可以选择上方示例。分析只读取本机项目，不会上传 DATA.md。</span></div>';
    dimensions.innerHTML = '<div class="brainstorm-empty">完成第一次融合后可查看分析维度。</div>';
    matrix.innerHTML = '<div class="brainstorm-empty">完成第一次融合后可查看跨域碰撞。</div>';
    suggestions.innerHTML = '<div class="brainstorm-empty">机会、盲区和路线会在形成分析后出现。</div>';
    updateBrainstormPanels();
    setButtonBusy(button, false);
    setButtonBusy(goalButton, false);
    saveButton.disabled = true;
    return;
  }
  graph.innerHTML = '<div class="brainstorm-loading">正在计算事项关联…</div>';
  fusion.innerHTML = '<div class="brainstorm-loading">正在围绕实际需求抽取项目长处…</div>';
  dimensions.innerHTML = '<div class="brainstorm-loading">正在展开分析维度…</div>';
  matrix.innerHTML = '<div class="brainstorm-loading">正在计算跨域碰撞…</div>';
  suggestions.innerHTML = '<div class="brainstorm-loading">正在生成多维建议…</div>';
  brainstormLastAnalysis = null;
  setButtonBusy(button, true, "分析中…");
  setButtonBusy(goalButton, true, "融合中…");
  saveButton.disabled = true;
  try {
    try { localStorage.setItem("brainstorm_goal", goal); } catch (_) {}
    const endpoint = state.demoMode
      ? "demo-brainstorm.json"
      : "/api/brainstorm?mode=" + encodeURIComponent(brainstormMode) + "&goal=" + encodeURIComponent(goal);
    const response = state.demoMode ? await fetch(endpoint, {
      cache: "no-store",
      signal: brainstormController.signal,
    }) : await localApiFetch(endpoint, {
      cache: "no-store",
      signal: brainstormController.signal,
    });
    const data = await readJsonResponse(response);
    if (sequence !== brainstormLoadSequence) return;
    if (!data.ok) throw new Error(data.error || "分析失败");
    brainstormLastAnalysis = data;
    renderBrainstorm(data);
  } catch (error) {
    if (error.name === "AbortError" || sequence !== brainstormLoadSequence) return;
    const message = escapeHtml(error.message);
    graph.innerHTML = `<div class="brainstorm-empty brainstorm-error">知识图谱生成失败：${message}</div>`;
    fusion.innerHTML = `<div class="brainstorm-empty brainstorm-error">需求融合失败：${message}</div>`;
    dimensions.innerHTML = `<div class="brainstorm-empty brainstorm-error">分析维度生成失败：${message}</div>`;
    matrix.innerHTML = `<div class="brainstorm-empty brainstorm-error">碰撞矩阵生成失败：${message}</div>`;
    suggestions.innerHTML = `<div class="brainstorm-empty brainstorm-error">建议生成失败：${message}<br>如果刚升级，请关闭旧服务后重新运行 start.bat。</div>`;
  } finally {
    if (sequence !== brainstormLoadSequence) return;
    brainstormController = null;
    setButtonBusy(button, false);
    setButtonBusy(goalButton, false);
    goalButton.disabled = state.demoMode;
    saveButton.disabled = !state.httpMode || !brainstormLastAnalysis;
  }
}

function renderBrainstormHistory(items) {
  const container = document.getElementById("brainstormHistory");
  if (!items || !items.length) {
    container.innerHTML = '<div class="brainstorm-history-empty">保存本轮方案后，会在这里形成决策记录。</div>';
    return;
  }
  container.innerHTML = items.map(item => {
    const created = item.createdAt && !Number.isNaN(new Date(item.createdAt).getTime())
      ? new Date(item.createdAt).toLocaleString() : "未知时间";
    const url = "/api/brainstorm/report?id=" + encodeURIComponent(item.id);
    return `<a class="brainstorm-history-item" href="${escapeAttr(url)}" title="下载 Markdown 方案">
      <span><strong>${escapeHtml(item.goal)}</strong><small>${escapeHtml(created)} · ${escapeHtml(item.topPlan || "综合方案")} · ${escapeHtml(item.sourceCount || 0)} 个来源</small></span>
      <b>下载 Markdown</b>
    </a>`;
  }).join("");
}

async function loadBrainstormHistory() {
  const container = document.getElementById("brainstormHistory");
  if (state.demoMode) {
    container.innerHTML = '<div class="brainstorm-history-empty">在线 Demo 不保存方案；本地版会把每轮结果沉淀为 Markdown 决策记录。</div>';
    return;
  }
  try {
    const response = await localApiFetch("/api/brainstorm/history", { cache: "no-store" });
    const data = await readJsonResponse(response);
    renderBrainstormHistory(data.items || []);
  } catch (error) {
    container.innerHTML = `<div class="brainstorm-history-empty">保存记录读取失败：${escapeHtml(error.message)}</div>`;
  }
}

async function saveBrainstormReport() {
  if (!requireService("保存头脑风暴方案")) return;
  if (!brainstormLastAnalysis) { toast("请先完成本轮分析", "err"); return; }
  const button = document.getElementById("brainstormSaveBtn");
  setButtonBusy(button, true, "保存中…");
  try {
    const goal = String(brainstormLastAnalysis.fusion && brainstormLastAnalysis.fusion.goal || "").trim().slice(0, 400);
    const mode = brainstormLastAnalysis.mode || brainstormMode;
    const response = await localApiFetch("/api/brainstorm/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, mode }),
    });
    const data = await readJsonResponse(response);
    toast("本轮方案已保存为本地 Markdown", "ok");
    await loadBrainstormHistory();
  } catch (error) {
    toast("方案保存失败：" + error.message, "err");
  } finally {
    setButtonBusy(button, false);
    button.disabled = !state.httpMode || !brainstormLastAnalysis;
  }
}

function openBrainstorm() {
  if (!state.httpMode && !state.demoMode) { toast("请先启动本地服务", "err"); return; }
  if (!state.items.length) { toast("请先新增至少一个待研究事项", "err"); return; }
  setProductView("brainstorm");
}

document.getElementById("brainstormBtn").addEventListener("click", openBrainstorm);
document.getElementById("brainstormBridgeBtn").addEventListener("click", openBrainstorm);
document.getElementById("inspirationNav").addEventListener("click", () => setProductView("inspiration"));
document.getElementById("brainstormRefreshBtn").addEventListener("click", () => {
  if (!document.getElementById("brainstormGoal").value.trim() && !state.demoMode) {
    toast("请先写下一个实际需求", "err");
    document.getElementById("brainstormGoal").focus({ preventScroll: true });
    return;
  }
  loadBrainstorm();
});
document.getElementById("brainstormSaveBtn").addEventListener("click", saveBrainstormReport);
function activateBrainstormMode(button, options = {}) {
  if (!button) return;
  brainstormMode = button.dataset.brainstormMode;
  document.querySelectorAll("[data-brainstorm-mode]").forEach(item => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  });
  updateBrainstormPanels(brainstormMode);
  if (options.focus) button.focus({ preventScroll: true });
  if (options.load !== false) loadBrainstorm();
}
try {
  const savedBrainstormGoal = localStorage.getItem("brainstorm_goal");
  if (savedBrainstormGoal) document.getElementById("brainstormGoal").value = savedBrainstormGoal;
} catch (_) {}
document.getElementById("brainstormGoalForm").addEventListener("submit", e => {
  e.preventDefault();
  if (!document.getElementById("brainstormGoal").value.trim()) { toast("请先输入一个实际需求", "err"); return; }
  activateBrainstormMode(document.querySelector('[data-brainstorm-mode="fusion"]'));
});
document.querySelectorAll("[data-brainstorm-goal]").forEach(button => button.addEventListener("click", () => {
  document.getElementById("brainstormGoal").value = button.dataset.brainstormGoal;
  document.getElementById("brainstormGoalForm").requestSubmit();
}));
document.querySelectorAll("[data-brainstorm-mode]").forEach(button => button.addEventListener("click", () => {
  activateBrainstormMode(button);
}));
document.querySelector(".brainstorm-modes").addEventListener("keydown", e => {
  if (!e.target.matches("[data-brainstorm-mode]")) return;
  const tabs = [...e.currentTarget.querySelectorAll("[data-brainstorm-mode]")];
  const current = tabs.indexOf(e.target);
  let next = current;
  if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
  else if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = tabs.length - 1;
  else return;
  e.preventDefault();
  activateBrainstormMode(tabs[next], { focus: true });
});
document.getElementById("brainstormView").addEventListener("click", e => {
  const target = e.target.closest("[data-brainstorm-entry]");
  if (!target) return;
  setProductView("inspiration", { load: false, instant: true });
  openEntry(target.dataset.brainstormEntry, { returnView: "brainstorm" });
});
document.getElementById("brainstormView").addEventListener("keydown", e => {
  if (!e.target.matches(".brainstorm-node") || !["Enter", " "].includes(e.key)) return;
  e.preventDefault();
  e.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});

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

