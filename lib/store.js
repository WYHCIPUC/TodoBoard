"use strict";
const fs = require("fs");
const path = require("path");
const { CATS } = require("./constants");
const { categoryOfSectionTitle, guessSource } = require("./classifier");
const schema = require("./schema");

const README = process.env.README_FILE
  ? path.resolve(process.env.README_FILE)
  : path.join(__dirname, "..", "DATA.md");
const DIR = path.dirname(README);
const MAX_BACKUPS = 5;
let writeTail = Promise.resolve();

/* === 纯函数:README 文本操作(从 server.js 迁移) === */

function categoryOf(t) { return categoryOfSectionTitle(t); }

/** 计算某分类章节内下一个编号 */
function nextIdIn(text, cat) {
  let curCat = null;
  let curCatNo = null;
  let targetCatNo = null;
  let maxSub = 0;
  let maxCatNo = 0;
  for (const line of text.split(/\r?\n/)) {
    const sec = line.match(/^##\s+(\d+)\.\s+(.+)$/);
    if (sec) {
      curCat = categoryOfSectionTitle(sec[2]);
      curCatNo = parseInt(sec[1], 10);
      maxCatNo = Math.max(maxCatNo, curCatNo);
      if (curCat === cat) targetCatNo = curCatNo;
      continue;
    }
    const head = line.match(/^###\s+[⏳🔄✅]\s*(\d+)\.(\d+)\s+/u);
    if (head && curCat === cat) {
      const sub = parseInt(head[2], 10);
      if (sub > maxSub) maxSub = sub;
    }
  }
  const knownNo = CATS.indexOf(cat) + 1;
  const catNo = targetCatNo !== null ? targetCatNo : (knownNo > 0 ? knownNo : maxCatNo + 1);
  return catNo + "." + (maxSub + 1);
}

/** 生成规范 Markdown 片段（与看板解析器严格兼容） */
function buildSnippet({ id, name, url, author, desc, difficulty, image, site, tags, whySaved }) {
  const lines = [`### ⏳ ${id} ${name}`, `<!-- linggan:uid=${schema.newUid()} -->`];
  if (desc) lines.push(`- **简介**：${desc}`);
  if (author) lines.push(`- **作者**：${author}`);
  lines.push(`- **作者 / 来源**：[${site || guessSource(url)}](${url})`);
  if (image) lines.push(`- **封面**：${image}`);
  if (tags) lines.push(`- **标签**：${tags}`);
  if (whySaved) lines.push(`- **为什么收藏**：${whySaved}`);
  lines.push(`- **难度**：${"⭐".repeat(difficulty || 1)}`);
  lines.push(`- **研究要点**：（待补充）`);
  return lines.join("\n");
}

/** 把片段插入目标分类章节末尾，不能切断上一条目的字段块 */
function insertSnippet(text, cat, snippet) {
  const lines = text.split(/\r?\n/);
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const sec = lines[i].match(/^##\s+(\d+)\.\s+(.+)$/);
    if (sec && categoryOfSectionTitle(sec[2]) === cat && start < 0) { start = i; }
    else if (sec && start >= 0) { end = i; break; }
  }
  if (start < 0) {
    let maxCatNo = 0;
    for (const line of lines) {
      const sec = line.match(/^##\s+(\d+)\.\s+/);
      if (sec) maxCatNo = Math.max(maxCatNo, parseInt(sec[1], 10));
    }
    const knownNo = CATS.indexOf(cat) + 1;
    const catNo = knownNo > 0 ? knownNo : maxCatNo + 1;
    return text.trimEnd() + "\n\n## " + catNo + ". " + cat + "\n\n" + snippet + "\n";
  }
  const out = lines.slice();
  while (end > start && out[end - 1].trim() === "") end--;
  out.splice(end, 0, "", snippet);
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

/** 合并重复条目的低风险元数据：标签取并集，收藏原因追加且不覆盖已有内容。 */
function mergeEntryFields(text, id, fields) {
  const lines = text.split(/\r?\n/);
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^###\s+[⏳🔄✅]\s*(\d+\.\d+)\s+/u);
    if (head && head[1] === id) { start = i; continue; }
    if (start >= 0 && (head || /^##\s+\d+\.\s+/.test(lines[i]))) { end = i; break; }
  }
  if (start < 0) return null;

  const clean = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const incomingTags = clean(fields && fields.tags, 300).split(/[,，]/).map(value => value.trim()).filter(Boolean);
  const incomingWhy = clean(fields && fields.whySaved, 300);

  function fieldIndex(label) {
    for (let i = start + 1; i < end; i++) {
      if (lines[i].startsWith("- **" + label + "**：")) return i;
    }
    return -1;
  }

  function insertField(label, value) {
    if (!value) return;
    const index = fieldIndex(label);
    if (index >= 0) {
      lines[index] = "- **" + label + "**：" + value;
      return;
    }
    let insertAt = end;
    for (let i = start + 1; i < end; i++) {
      if (/^- \*\*(难度|研究要点)\*\*：/.test(lines[i])) { insertAt = i; break; }
    }
    lines.splice(insertAt, 0, "- **" + label + "**：" + value);
    end++;
  }

  if (incomingTags.length) {
    const index = fieldIndex("标签");
    const existing = index >= 0
      ? lines[index].replace(/^- \*\*标签\*\*：/, "").split(/[,，]/).map(value => value.trim()).filter(Boolean)
      : [];
    insertField("标签", [...new Set(existing.concat(incomingTags))].join(", ").slice(0, 300));
  }
  if (incomingWhy) {
    const index = fieldIndex("为什么收藏");
    const existing = index >= 0 ? lines[index].replace(/^- \*\*为什么收藏\*\*：/, "").trim() : "";
    const merged = !existing ? incomingWhy : (existing.includes(incomingWhy) ? existing : existing + "；" + incomingWhy);
    insertField("为什么收藏", merged.slice(0, 600));
  }
  return lines.join("\n");
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
    const parsed = path.parse(README);
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
    let suffix = "";
    let counter = 0;
    let backup = path.join(DIR, `${parsed.name}.backup-${stamp}${parsed.ext || ".md"}`);
    while (fs.existsSync(backup)) {
      suffix = "-" + (++counter);
      backup = path.join(DIR, `${parsed.name}.backup-${stamp}${suffix}${parsed.ext || ".md"}`);
    }
    if (fs.existsSync(README)) fs.copyFileSync(README, backup);
    const escapedName = parsed.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedExt = (parsed.ext || ".md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const backupRe = new RegExp("^" + escapedName + "\\.backup-\\d{17}(?:-\\d+)?" + escapedExt + "$");
    const all = fs.readdirSync(DIR)
      .filter(f => backupRe.test(f))
      .map(name => ({ name, mtimeMs: fs.statSync(path.join(DIR, name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
      .map(item => item.name);
    for (const old of all.slice(MAX_BACKUPS)) {
      const p = path.join(DIR, old);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (e) { console.error("备份失败:", e.message); }
  writeAtomic(text);
}

/**
 * 串行执行读取-修改-写入事务。mutator 返回字符串，或
 * {text, result, write};write=false 可用于重复检测等只读事务。
 */
function mutate(mutator) {
  const run = writeTail.then(async () => {
    const current = readAll();
    const change = await mutator(current);
    if (typeof change === "string") {
      writeWithBackup(change);
      return undefined;
    }
    if (!change || typeof change !== "object") throw new Error("写事务未返回有效结果");
    if (change.write !== false) {
      if (typeof change.text !== "string") throw new Error("写事务缺少 text");
      writeWithBackup(change.text);
    }
    return change.result;
  });
  writeTail = run.catch(() => undefined);
  return run;
}

module.exports = {
  README, DIR,
  // 纯函数
  categoryOf, nextIdIn, buildSnippet, insertSnippet, deleteEntry, updateStatus, updateNote, mergeEntryFields,
  // 文件工具
  readAll, writeAtomic, writeWithBackup, mutate,
  findDuplicateUrl: schema.findDuplicateUrl,
};
