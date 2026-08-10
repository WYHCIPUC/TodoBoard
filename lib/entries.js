"use strict";
/**
 * 研究档案子系统(lib/entries.js)
 *
 * 每条目一个独立文件夹 docs/entries/{id}/,内含 notes.md + screenshots/。
 * notes.md 是结构化 Markdown,含四块:下载安装 / 体验评价 / 界面截图 / 收藏判定。
 *
 * 设计约束:saveNotes 写出的内容必须能被 parseNotes 完整还原(round-trip)。
 * 为此单行字段统一用 `**LABEL**: VALUE` 格式,空值也合法;多行「使用感受」
 * 用 `\n## ` 作为段落边界。所有正则与渲染逻辑成对设计,杜绝漂移。
 */
const fs = require("fs");
const path = require("path");
const store = require("./store"); // store.js 导出扁平对象,内含 readAll()
const schema = require("./schema");

const ENTRIES_DIR = process.env.ENTRIES_DIR
  ? path.resolve(process.env.ENTRIES_DIR)
  : path.join(__dirname, "..", "docs", "entries");

// 条目编号格式 `数字.数字`,如 1.1 / 12.34
const ID_RE = /^\d+\.\d+$/;
const TEMPLATES = ["general", "article", "video", "project", "software"];

function assertValidId(id) {
  if (!ID_RE.test(id)) throw new Error("非法条目编号: " + id);
}

function resolveStorageKey(id) {
  assertValidId(id);
  try { return schema.storageKey(store.readAll(), id); }
  catch (_) { return id; }
}

/**
 * 拼接路径并断言结果仍在 entries 根内(二次防穿越)。
 * 先用 ID_RE 拦掉 `..` / 绝对路径,再用 startsWith 兜底。
 */
function safePath(id, ...sub) {
  assertValidId(id);
  const root = path.resolve(ENTRIES_DIR);
  const p = path.resolve(root, resolveStorageKey(id), ...sub);
  if (p !== root && !p.startsWith(root + path.sep)) {
    throw new Error("路径越界: " + p);
  }
  return p;
}

/**
 * 从 DATA.md 解析条目标题(### ⏳ 1.1 标题名)。
 * 读失败或找不到时回退到 "条目 {id}"。
 */
function entriesTitle(id) {
  assertValidId(id);
  try {
    const entry = schema.findEntry(store.readAll(), id);
    return entry ? entry.title : "条目 " + id;
  } catch (e) {
    return "条目 " + id;
  }
}

/** 从 DATA.md 解析条目的来源 URL(「作者 / 来源」字段里的链接) */
function entryUrl(id) {
  assertValidId(id);
  try {
    const entry = schema.findEntry(store.readAll(), id);
    return entry && entry.url ? entry.url : null;
  } catch (e) {
    return null;
  }
}

/**
 * 空档案模板。单行字段统一 `**LABEL**: VALUE`(冒号空格),
 * 空默认值写成 `**LABEL**:`(无尾随空格,保持整洁)。
 * 多行「使用感受」独占一行,内容从下一行开始,以 `\n## ` 结束。
 */
function emptyTemplate(id, title) {
  return `# ${title} 研究档案

<!-- linggan:template=general -->

> 本条目来自 DATA.md,编号 ${id}

## 研究结论
- **为什么收藏**:
- **关键发现**:
- **行动项**:
- **结论**:

## 下载安装
- **下载状态**: 未下载
- **安装包**:
- **安装状态**: 未安装
- **安装路径**:

## 体验评价
- **评分**: ⭐
- **是否达预期**:
- **使用感受**:

## 界面截图

## 收藏判定
- **值得收藏备用**: 否
- **推荐指数**: ⭐
- **备注**:
`;
}

/** 确保条目目录 / notes.md / screenshots/ 就绪,返回三者路径 */
function ensureEntryDir(id) {
  const dir = safePath(id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const notesPath = safePath(id, "notes.md");
  if (!fs.existsSync(notesPath)) {
    const title = entriesTitle(id);
    fs.writeFileSync(notesPath, emptyTemplate(id, title), "utf-8");
  }
  const ssDir = safePath(id, "screenshots");
  if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
  return { dir, notesPath, ssDir };
}

/**
 * 读取整条档案(不存在则用空模板初始化)。
 * 返回 { id, title, notesPath, notesContent, fields, screenshots }。
 */
function getEntry(id, options) {
  assertValidId(id);
  options = options || {};
  const { notesPath, ssDir } = ensureEntryDir(id);
  const notesContent = fs.readFileSync(notesPath, "utf-8");
  const screenshots = listScreenshots(ssDir, notesContent);
  const fields = parseNotes(notesContent);
  try {
    const source = schema.findEntry(store.readAll(), id);
    if (!fields.whySaved && source && source.fields) fields.whySaved = source.fields["为什么收藏"] || "";
  } catch (_) {}
  const result = {
    id,
    uid: resolveStorageKey(id),
    title: entriesTitle(id),
    notesPath,
    notesContent,
    fields,
    screenshots,
  };
  if (options.archive && typeof options.archive.getStatus === "function") {
    result.archive = options.archive.getStatus(id) || {
      id,
      state: "queued",
      attempt: 0,
      nextRunAt: null,
      lastError: null,
    };
  }
  return result;
}

/**
 * 列出 screenshots/ 下的图片,并从 notes.md 里的
 * `<!-- screenshot: file | caption -->` 注释解析回 caption。
 */
function listScreenshots(ssDir, notesContent) {
  const capMap = {};
  if (notesContent) {
    for (const line of notesContent.split(/\r?\n/)) {
      const m = line.match(/<!-- screenshot: (.+?) \| (.+?) -->/);
      if (m) capMap[m[1]] = m[2];
    }
  }
  if (!fs.existsSync(ssDir)) return [];
  return fs.readdirSync(ssDir)
    .filter(f => /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map(f => ({ file: f, caption: capMap[f] || "" }));
}

/* ===== saveNotes / parseNotes:严格 round-trip ===== */

/** 把 1-5 的数字限制到 [1,5] */
function clampStars(n) {
  return Math.min(5, Math.max(1, n || 1));
}

/**
 * 单行字段写入:匹配 `**LABEL**:` 到行尾(含空值),整体重写为 `**LABEL**: VAL`。
 * 用函数形式替换,避免 VAL 中的 `$` 被 String.replace 特殊解释。
 */
function setLine(text, label, val) {
  const re = new RegExp("\\*\\*" + label + "\\*\\*:[^\\r\\n]*");
  return text.replace(re, () => "**" + label + "**: " + val);
}

function normalizeTemplate(value) {
  return TEMPLATES.includes(value) ? value : "general";
}

function ensureUniversalSection(text) {
  if (/^## 研究结论\s*$/m.test(text)) return text;
  const section = `
## 研究结论
- **为什么收藏**:
- **关键发现**:
- **行动项**:
- **结论**:
`;
  const firstSection = text.search(/^## /m);
  if (firstSection < 0) return text.trimEnd() + "\n" + section;
  return text.slice(0, firstSection) + section + "\n" + text.slice(firstSection);
}

function setTemplate(text, value) {
  const marker = "<!-- linggan:template=" + normalizeTemplate(value) + " -->";
  if (/<!--\s*linggan:template=[^\s]+\s*-->/.test(text)) {
    return text.replace(/<!--\s*linggan:template=[^\s]+\s*-->/, marker);
  }
  const firstLineEnd = text.indexOf("\n");
  return firstLineEnd < 0 ? text + "\n\n" + marker + "\n" : text.slice(0, firstLineEnd + 1) + "\n" + marker + text.slice(firstLineEnd + 1);
}

/** 单行字段读取:`**LABEL**: ?` 后取行尾,trim 掉首尾空白。 */
function getLine(content, label) {
  const re = new RegExp("\\*\\*" + label + "\\*\\*: ?([^\\r\\n]*)");
  const m = content.match(re);
  return m ? m[1].trim() : "";
}

function starCount(s) {
  return (s.match(/⭐/g) || []).length;
}

/**
 * 把字段对象写回 notes.md(原子写:tmp -> rename)。
 * fields 形如 { downloadStatus, installerName, installStatus, installPath,
 *   rating, metExpectation, experience, keep, recommendLevel, keepNote }。
 */
function saveNotes(id, f) {
  f = f || {};
  const { notesPath } = ensureEntryDir(id);
  let text = fs.readFileSync(notesPath, "utf-8");
  text = setTemplate(ensureUniversalSection(text), f.template);

  text = setLine(text, "为什么收藏", f.whySaved || "");
  text = setLine(text, "关键发现", f.keyFindings || "");
  text = setLine(text, "行动项", f.actionItems || "");
  text = setLine(text, "结论", f.conclusion || "");

  // 单行字段
  text = setLine(text, "下载状态", f.downloadStatus || "未下载");
  text = setLine(text, "安装包", f.installerName || "");
  text = setLine(text, "安装状态", f.installStatus || "未安装");
  text = setLine(text, "安装路径", f.installPath || "");
  text = setLine(text, "评分", "⭐".repeat(clampStars(f.rating)));
  text = setLine(text, "是否达预期", f.metExpectation || "");
  text = setLine(text, "值得收藏备用", f.keep || "否");
  text = setLine(text, "推荐指数", "⭐".repeat(clampStars(f.recommendLevel)));
  text = setLine(text, "备注", f.keepNote || "");

  // 多行「使用感受」:段落从 `**使用感受**:\n` 到下一个 `\n## ` 为止。
  // 函数替换,避免 experience 中的 `$` 干扰。
  const experience = f.experience || "";
  text = text.replace(
    /(\*\*使用感受\*\*:\r?\n)[\s\S]*?(?=\r?\n## )/,
    (match, p1) => p1 + experience
  );

  const tmp = notesPath + ".tmp";
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, notesPath);
}

/**
 * 解析 notes.md 为字段对象。与 saveNotes 严格对偶。
 * 评分 / 推荐指数按 ⭐ 数量计,缺失或 0 时回退到 1。
 */
function parseNotes(content) {
  const experienceMatch = content.match(/\*\*使用感受\*\*:\r?\n([\s\S]*?)(?=\r?\n## )/);
  const experience = experienceMatch ? experienceMatch[1].trim() : "";
  const templateMatch = content.match(/<!--\s*linggan:template=([^\s]+)\s*-->/);
  return {
    template: normalizeTemplate(templateMatch && templateMatch[1]),
    whySaved: getLine(content, "为什么收藏"),
    keyFindings: getLine(content, "关键发现"),
    actionItems: getLine(content, "行动项"),
    conclusion: getLine(content, "结论"),
    downloadStatus: getLine(content, "下载状态"),
    installerName: getLine(content, "安装包"),
    installStatus: getLine(content, "安装状态"),
    installPath: getLine(content, "安装路径"),
    rating: starCount(getLine(content, "评分")) || 1,
    metExpectation: getLine(content, "是否达预期"),
    experience: experience,
    keep: getLine(content, "值得收藏备用"),
    recommendLevel: starCount(getLine(content, "推荐指数")) || 1,
    keepNote: getLine(content, "备注"),
  };
}

/* ===== 截图 ===== */

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

/**
 * 上传截图:校验 PNG/JPG magic number + 5MB 上限,写入 screenshots/,
 * 并在 notes.md 的「界面截图」段落末尾追加 caption 注释。
 * 返回 { file }。
 */
function uploadScreenshot(id, buffer, caption) {
  assertValidId(id);
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);

  // magic number 校验
  const PNG = [0x89, 0x50, 0x4e, 0x47];
  const JPG = [0xff, 0xd8, 0xff];
  const head = buffer.slice(0, 4);
  const isPng =
    head[0] === PNG[0] && head[1] === PNG[1] && head[2] === PNG[2] && head[3] === PNG[3];
  const isJpg = head[0] === JPG[0] && head[1] === JPG[1] && head[2] === JPG[2];
  if (!isPng && !isJpg) throw new Error("仅支持 PNG/JPG");
  if (buffer.length > 5 * 1024 * 1024) throw new Error("截图超过 5MB 限制");

  const { ssDir, notesPath } = ensureEntryDir(id);
  const ext = isPng ? "png" : "jpg";
  const d = new Date();
  const stamp =
    d.getFullYear() +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    "-" +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds());
  const file = stamp + "." + ext;
  fs.writeFileSync(path.join(ssDir, file), buffer);

  // caption 清洗:去换行、转义分隔符、截断 200 字
  const cap = String(caption || "")
    .replace(/\|/g, "/")
    .replace(/\r?\n/g, " ")
    .slice(0, 200);
  const ref = "\n<!-- screenshot: " + file + " | " + cap + " -->";

  let text = fs.readFileSync(notesPath, "utf-8");
  text = text.replace(
    /(## 界面截图\r?\n)((?:.|\r?\n)*?)(\r?\n## )/,
    (match, p1, p2, p3) => p1 + (p2 || "") + ref + p3
  );
  const tmp = notesPath + ".tmp";
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, notesPath);
  return { file };
}

/**
 * 删除截图:校验文件名格式,删磁盘文件 + notes.md 里的 caption 注释。
 */
function deleteScreenshot(id, filename) {
  assertValidId(id);
  if (!/^\d{8}-\d{6}\.(png|jpe?g)$/i.test(filename)) {
    throw new Error("非法文件名: " + filename);
  }
  const fp = safePath(id, "screenshots", filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);

  const { notesPath } = ensureEntryDir(id);
  let text = fs.readFileSync(notesPath, "utf-8");
  const escFile = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  text = text.replace(
    new RegExp("\\n?<!-- screenshot: " + escFile + " \\|[^>]*-->\\n?", "g"),
    "\n"
  );
  const tmp = notesPath + ".tmp";
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, notesPath);
  return true;
}

/** 抓取并保存正文到 content.md */
function saveContent(id, result) {
  assertValidId(id);
  const { notesPath } = ensureEntryDir(id); // 复用,确保目录存在
  const contentPath = safePath(id, "content.md");
  const header = `# ${result.title || "抓取正文"}\n\n> 来源: ${result.source || ""} · 抓取时间: ${new Date().toISOString().slice(0,19).replace("T"," ")}\n\n`;
  const body = result.ok ? result.content : `> ⚠️ ${result.warning || "抓取失败"}\n`;
  const tmp = contentPath + ".tmp";
  fs.writeFileSync(tmp, header + body + "\n", "utf-8");
  fs.renameSync(tmp, contentPath);
  return { ok: result.ok, warning: result.warning };
}

/** 读取 content.md(不存在返回 null) */
function getContent(id) {
  assertValidId(id);
  const contentPath = safePath(id, "content.md");
  if (!fs.existsSync(contentPath)) return null;
  return fs.readFileSync(contentPath, "utf-8");
}

module.exports = {
  ENTRIES_DIR,
  TEMPLATES,
  getEntry,
  ensureEntryDir,
  safePath,
  assertValidId,
  resolveStorageKey,
  entriesTitle,
  entryUrl,
  entriesTitle,
  emptyTemplate,
  saveNotes,
  parseNotes,
  uploadScreenshot,
  deleteScreenshot,
  saveContent,
  getContent,
};
