"use strict";
const fs = require("fs");
const path = require("path");
const { CATS } = require("./constants");
const { categoryOfSectionTitle, guessSource } = require("./classifier");

const README = process.env.README_FILE
  ? path.resolve(process.env.README_FILE)
  : path.join(__dirname, "..", "DATA.md");
const DIR = path.dirname(README);
const MAX_BACKUPS = 5;

/* === 纯函数:README 文本操作(从 server.js 迁移) === */

function categoryOf(t) { return categoryOfSectionTitle(t); }

/** 计算某分类章节内下一个编号 */
function nextIdIn(text, cat) {
  let curCat = null;
  let curCatNo = null;
  let targetCatNo = null;
  let maxSub = 0;
  for (const line of text.split(/\r?\n/)) {
    const sec = line.match(/^##\s+(\d+)\.\s+(.+)$/);
    if (sec) { curCat = categoryOfSectionTitle(sec[2]); curCatNo = parseInt(sec[1], 10); continue; }
    const head = line.match(/^###\s+[⏳🔄✅]\s*(\d+)\.(\d+)\s+/u);
    if (head && curCat === cat) {
      const sub = parseInt(head[2], 10);
      if (sub > maxSub) maxSub = sub;
      if (targetCatNo === null) targetCatNo = curCatNo;
    }
  }
  const catNo = targetCatNo !== null ? targetCatNo : Math.max(1, CATS.indexOf(cat) + 1);
  return catNo + "." + (maxSub + 1);
}

/** 生成规范 Markdown 片段（与看板解析器严格兼容） */
function buildSnippet({ id, name, url, author, desc, difficulty, image, site }) {
  const lines = [`### ⏳ ${id} ${name}`];
  if (desc) lines.push(`- **简介**：${desc}`);
  if (author) lines.push(`- **作者**：${author}`);
  lines.push(`- **作者 / 来源**：[${site || guessSource(url)}](${url})`);
  if (image) lines.push(`- **封面**：${image}`);
  lines.push(`- **难度**：${"⭐".repeat(difficulty || 1)}`);
  lines.push(`- **研究要点**：（待补充）`);
  return lines.join("\n");
}

/** 把片段插入目标分类章节内最后一个条目之后 */
function insertSnippet(text, cat, snippet) {
  const lines = text.split(/\r?\n/);
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const sec = lines[i].match(/^##\s+(\d+)\.\s+(.+)$/);
    if (sec && categoryOfSectionTitle(sec[2]) === cat && start < 0) { start = i; }
    else if (sec && start >= 0) { end = i; break; }
  }
  if (start < 0) {
    const catNo = Math.max(1, CATS.indexOf(cat) + 1);
    return text.trimEnd() + "\n\n## " + catNo + ". " + cat + "\n\n" + snippet + "\n";
  }
  let lastHead = start;
  for (let i = start; i < end; i++) {
    if (/^###\s/.test(lines[i])) lastHead = i;
  }
  const out = lines.slice();
  out.splice(lastHead + 1, 0, snippet, "");
  return out.join("\n");
}

/** 删除指定编号的条目块（到下一个条目/章节/分隔线为止） */
function deleteEntry(text, id) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let deleting = false;
  let removed = false;
  for (const line of lines) {
    const head = line.match(/^###\s+[⏳🔄✅]\s*(\d+\.\d+)\s+/u);
    if (head) {
      if (head[1] === id) { deleting = true; removed = true; continue; }
      deleting = false;
    }
    if (deleting) {
      if (/^##\s/.test(line) || /^---\s*$/.test(line)) { deleting = false; out.push(line); }
      continue;
    }
    out.push(line);
  }
  if (!removed) return null;
  // 清理连续空行
  const res = [];
  let prevBlank = false;
  for (const l of out) {
    const blank = l.trim() === "";
    if (blank && prevBlank) continue;
    res.push(l);
    prevBlank = blank;
  }
  return res.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** 更新条目状态符号（⏳/🔄/✅） */
function updateStatus(text, id, st) {
  const lines = text.split(/\r?\n/);
  let found = false;
  const out = [];
  for (const line of lines) {
    const head = line.match(/^###\s+([⏳🔄✅])\s*(\d+\.\d+)\s+(.+)$/u);
    if (head && head[2] === id) {
      out.push(`### ${st} ${head[2]} ${head[3]}`);
      found = true;
    } else {
      out.push(line);
    }
  }
  return found ? out.join("\n") : null;
}

/** 更新条目的「研究要点」字段 */
function updateNote(text, id, note) {
  const lines = text.split(/\r?\n/);
  let inTarget = false;
  let found = false;
  let updated = false;
  const out = [];
  for (const line of lines) {
    const head = line.match(/^###\s+[⏳🔄✅]\s*(\d+\.\d+)\s+/u);
    if (head) {
      if (head[1] === id) { inTarget = true; found = true; }
      else if (inTarget) { inTarget = false; }
    }
    if (inTarget) {
      const nf = line.match(/^-\s+\*\*研究要点\*\*：\s*(.*)$/);
      if (nf) { out.push(`- **研究要点**：${note}`); updated = true; continue; }
    }
    out.push(line);
  }
  if (!found) return null;
  return updated ? out.join("\n") : text;
}

/* === 文件读写工具(路由层调用) === */

function readAll() {
  return fs.readFileSync(README, "utf-8");
}

/** 原子写:tmp → rename;rename 失败则原文件不动 */
function writeAtomic(text) {
  const tmp = README + ".tmp";
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, README);
}

/** 写前备份 + 原子写(供新增/删除/状态/笔记等写操作调用) */
function writeWithBackup(text) {
  try {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const backup = path.join(DIR, `README.backup-${stamp}.md`);
    if (fs.existsSync(README)) fs.copyFileSync(README, backup);
    // 清理超额备份:只匹配 README.backup-YYYYMMDD.md,绝不碰 README.md
    const all = fs.readdirSync(DIR)
      .filter(f => /^README\.backup-\d{8}\.md$/.test(f))
      .sort().reverse();
    for (const old of all.slice(MAX_BACKUPS)) {
      const p = path.join(DIR, old);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (e) { console.error("备份失败:", e.message); }
  writeAtomic(text);
}

module.exports = {
  README, DIR,
  // 纯函数
  categoryOf, nextIdIn, buildSnippet, insertSnippet, deleteEntry, updateStatus, updateNote,
  // 文件工具
  readAll, writeAtomic, writeWithBackup,
};
