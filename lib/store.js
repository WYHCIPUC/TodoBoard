"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { CATS } = require("./constants");
const { categoryOfSectionTitle, guessSource } = require("./classifier");
const schema = require("./schema");
const { UUID_RE, sha256 } = require("./backup-format");
const { renameWithRetry } = require("./backup-transaction");
const { defaultCoordinator } = require("./maintenance");
const { IdempotencyStore, atomicJson, syncDirectory, writeFileDurable } = require("./idempotency");

const README = process.env.README_FILE
  ? path.resolve(process.env.README_FILE)
  : path.join(__dirname, "..", "DATA.md");
const DIR = path.dirname(README);
const CONTROL_DIR = process.env.CONTROL_DIR ? path.resolve(process.env.CONTROL_DIR) : path.join(DIR, ".linggan");
const MAX_BACKUPS = 5;
let writeTail = Promise.resolve();

function fileFingerprint(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new Error("可信写入目标不是普通文件: " + file);
  return sha256(fs.readFileSync(file));
}

function operationFile(controlDir, operationId) {
  return path.join(controlDir, "t3-operations", operationId + ".json");
}

function normalizeChanges(changes, operationId) {
  const seen = new Set();
  return changes.map((change, index) => {
    const file = path.resolve(change.file);
    if (seen.has(file)) throw new Error("可信事务目标重复: " + file);
    seen.add(file);
    const bytes = change.bytes === null ? null : Buffer.isBuffer(change.bytes) ? change.bytes : Buffer.from(String(change.bytes));
    const suffix = ".linggan-t3-" + operationId + "-" + index;
    return {
      file,
      bytes,
      beforeFingerprint: fileFingerprint(file),
      afterFingerprint: bytes === null ? null : sha256(bytes),
      stage: file + suffix + ".stage",
      old: file + suffix + ".old",
      hadLive: fs.existsSync(file),
    };
  }).sort((left, right) => left.file.localeCompare(right.file));
}

function saveOperation(file, journal) {
  atomicJson(file, journal);
  const reread = JSON.parse(fs.readFileSync(file, "utf8"));
  if (reread.operationId !== journal.operationId || reread.state !== journal.state) throw new Error("T3 operation receipt verification failed");
}

function commitOperationIdempotency(journal, nowProvider) {
  const metadata = journal && journal.idempotency;
  if (!metadata || journal.state !== "completed") return false;
  const idempotency = new IdempotencyStore(metadata.directory, { now: nowProvider });
  const receipt = idempotency.get(journal.operationId);
  if (!receipt) {
    throw Object.assign(new Error("可信写入缺少对应幂等 WAL"), { code: "idempotency_recovery_required" });
  }
  if (receipt.state === "committed") return false;
  idempotency.commit(journal.operationId, metadata.httpStatus, metadata.response, new Date(journal.completedAt));
  return true;
}

function cleanupTrustedTargets(targets) {
  for (const target of targets) {
    try {
      if (fs.existsSync(target.old) && fileFingerprint(target.old) === target.beforeFingerprint) fs.unlinkSync(target.old);
      if (fs.existsSync(target.stage) && fileFingerprint(target.stage) === target.afterFingerprint) fs.unlinkSync(target.stage);
      syncDirectory(path.dirname(target.file));
    } catch (_) {
      // 已验证并已记录的 live 结果优先；残留 generation 由启动恢复再次核对。
    }
  }
}

function rollbackTrustedTargets(targets) {
  for (const target of [...targets].reverse()) {
    if (target.hadLive) {
      if (fileFingerprint(target.file) === target.beforeFingerprint) continue;
      if (!fs.existsSync(target.old) || fileFingerprint(target.old) !== target.beforeFingerprint) throw new Error("可信写入 old generation 无法验证");
      if (fs.existsSync(target.file)) fs.unlinkSync(target.file);
      renameWithRetry(target.old, target.file);
      syncDirectory(path.dirname(target.file));
      if (fileFingerprint(target.file) !== target.beforeFingerprint) throw new Error("可信写入回滚复验失败");
    } else if (fs.existsSync(target.file)) {
      if (fileFingerprint(target.file) !== target.afterFingerprint) throw new Error("可信写入出现未知新文件");
      fs.unlinkSync(target.file);
      syncDirectory(path.dirname(target.file));
    }
  }
}

function trustedWriteSet(changes, options = {}) {
  if (!Array.isArray(changes) || !changes.length) throw new Error("可信写入缺少目标");
  const operationId = String(options.operationId || options.requestId || crypto.randomUUID()).toLowerCase();
  if (!UUID_RE.test(operationId)) throw new Error("operationId 必须是 UUID");
  const controlDir = path.resolve(options.controlDir || CONTROL_DIR);
  const receiptFile = operationFile(controlDir, operationId);
  const coordinator = options.coordinator || defaultCoordinator;
  const lease = coordinator.acquireMutation(options.leaseToken);
  let idempotency = null;
  let idempotencyBegin = null;
  try {
    const targets = normalizeChanges(changes, operationId);
    const action = String(options.action || "t3.write");
    const existing = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile, "utf8")) : null;
    if (existing) {
      if (existing.action !== action || existing.targets.length !== targets.length || existing.targets.some((item, index) => item.file !== targets[index].file || item.afterFingerprint !== targets[index].afterFingerprint)) {
        throw Object.assign(new Error("operationId 已用于不同写入"), { code: "idempotency_conflict" });
      }
      if (existing.state === "completed") return { operationId, replayed: true, receipt: existing };
      throw Object.assign(new Error("operationId 对应写入尚未收敛"), { code: "idempotency_recovery_required" });
    }
    const nowProvider = options.now || (() => new Date());
    const now = nowProvider().toISOString();
    if (options.idempotency) {
      idempotency = options.idempotency.store || new IdempotencyStore(path.join(controlDir, "idempotency"), { now: nowProvider });
      idempotencyBegin = idempotency.begin({
        requestId: operationId,
        action: options.idempotency.action,
        values: options.idempotency.values,
        fixedNow: new Date(now),
        beforeFingerprint: sha256(Buffer.from(JSON.stringify(targets.map(target => target.beforeFingerprint)))),
        afterFingerprint: sha256(Buffer.from(JSON.stringify(targets.map(target => target.afterFingerprint)))),
        domainRef: "t3-operation:" + operationId,
      });
      if (idempotencyBegin.replay) return { operationId, replayed: true, response: idempotencyBegin.receipt.response };
    }
    const journal = {
      version: 1,
      operationId,
      action,
      state: "pending",
      createdAt: now,
      completedAt: null,
      idempotency: idempotency ? {
        directory: idempotency.directory,
        httpStatus: options.httpStatus || 200,
        response: options.response || { saved: true, operationId },
      } : null,
      targets: targets.map(target => ({
        file: target.file,
        stage: target.stage,
        old: target.old,
        hadLive: target.hadLive,
        beforeFingerprint: target.beforeFingerprint,
        afterFingerprint: target.afterFingerprint,
      })),
    };
    saveOperation(receiptFile, journal);
    try {
      for (const target of targets) {
        fs.mkdirSync(path.dirname(target.file), { recursive: true });
        if (fs.existsSync(target.stage) || fs.existsSync(target.old)) throw new Error("可信事务 generation 路径碰撞");
        if (target.bytes !== null) {
          writeFileDurable(target.stage, target.bytes);
          if (fileFingerprint(target.stage) !== target.afterFingerprint) throw new Error("可信写入 stage 复验失败");
        }
      }
      journal.state = "staged";
      saveOperation(receiptFile, journal);
      for (const target of targets) {
        if (target.hadLive) renameWithRetry(target.file, target.old);
        if (target.bytes !== null) renameWithRetry(target.stage, target.file);
        syncDirectory(path.dirname(target.file));
        if (fileFingerprint(target.file) !== target.afterFingerprint) throw new Error("可信写入 live 复验失败");
      }
      journal.state = "verified";
      saveOperation(receiptFile, journal);
      journal.state = "completed";
      journal.completedAt = nowProvider().toISOString();
      saveOperation(receiptFile, journal);
      const response = { saved: true, operationId };
      if (idempotency) {
        try { commitOperationIdempotency(journal, nowProvider); }
        catch (error) {
          throw Object.assign(new Error("领域写入已验证，但幂等 receipt 尚未收敛: " + error.message), { code: "idempotency_recovery_required", cause: error });
        }
      }
      cleanupTrustedTargets(targets);
      return { operationId, replayed: false, receipt: journal, response };
    } catch (error) {
      if (journal.state === "completed") throw error;
      try {
        rollbackTrustedTargets(targets);
        journal.state = "rolled_back";
        journal.completedAt = nowProvider().toISOString();
        saveOperation(receiptFile, journal);
      } catch (rollbackError) {
        journal.state = "manual_recovery";
        try { saveOperation(receiptFile, journal); } catch (_) {}
        throw Object.assign(new Error("可信写入失败且需要人工恢复: " + rollbackError.message), { code: "manual_recovery_required", cause: error });
      }
      throw error;
    }
  } finally {
    coordinator.releaseMutation(lease);
  }
}

function trustedWriteFile(file, bytes, options) {
  return trustedWriteSet([{ file, bytes }], options);
}

function recoverTrustedWrites(options = {}) {
  const controlDir = path.resolve(options.controlDir || CONTROL_DIR);
  const directory = path.join(controlDir, "t3-operations");
  if (!fs.existsSync(directory)) return { recovered: 0, blocked: [] };
  let recovered = 0;
  const blocked = [];
  for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".json")).sort()) {
    const file = path.join(directory, name);
    const journal = JSON.parse(fs.readFileSync(file, "utf8"));
    if (journal.state === "completed") {
      commitOperationIdempotency(journal, options.now || (() => new Date()));
      cleanupTrustedTargets(journal.targets);
      continue;
    }
    if (journal.state === "rolled_back") continue;
    const fingerprints = journal.targets.map(target => fileFingerprint(target.file));
    const allAfter = journal.targets.every((target, index) => fingerprints[index] === target.afterFingerprint);
    const allBefore = journal.targets.every((target, index) => fingerprints[index] === target.beforeFingerprint);
    if (allAfter) {
      journal.state = "completed";
      journal.completedAt = (options.now || (() => new Date()))().toISOString();
      saveOperation(file, journal);
      commitOperationIdempotency(journal, options.now || (() => new Date()));
      cleanupTrustedTargets(journal.targets);
      recovered++;
    } else if (allBefore) {
      journal.state = "rolled_back";
      journal.completedAt = (options.now || (() => new Date()))().toISOString();
      saveOperation(file, journal);
      recovered++;
    } else {
      blocked.push(journal.operationId);
    }
  }
  if (blocked.length) throw Object.assign(new Error("T3 写入事务无法自动判定"), { code: "idempotency_recovery_required", details: { operationIds: blocked } });
  return { recovered, blocked };
}

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
function buildSnippet({ id, name, url, author, desc, difficulty, image, site, tags, whySaved, createdAt }) {
  const lines = [`### ⏳ ${id} ${name}`, `<!-- linggan:uid=${schema.newUid()} -->`, `<!-- linggan:created-at=${createdAt || new Date().toISOString()} -->`];
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
function writeAtomic(text, options) {
  return trustedWriteFile(README, Buffer.from(text), Object.assign({ action: "store.atomic" }, options));
}

/** 写前备份 + 原子写(供新增/删除/状态/笔记等写操作调用) */
function writeWithBackup(text, options = {}) {
  let backup = "";
  const changes = Array.isArray(options.additionalChanges) ? options.additionalChanges.slice() : [];
  if (fs.existsSync(README)) {
    const parsed = path.parse(README);
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
    let suffix = "";
    let counter = 0;
    backup = path.join(DIR, `${parsed.name}.backup-${stamp}${parsed.ext || ".md"}`);
    while (fs.existsSync(backup)) {
      suffix = "-" + (++counter);
      backup = path.join(DIR, `${parsed.name}.backup-${stamp}${suffix}${parsed.ext || ".md"}`);
    }
    changes.push({ file: backup, bytes: fs.readFileSync(README) });
  }

  try {
    const parsed = path.parse(README);
    const escapedName = parsed.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedExt = (parsed.ext || ".md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const backupRe = new RegExp("^" + escapedName + "\\.backup-\\d{17}(?:-\\d+)?" + escapedExt + "$");
    const all = fs.readdirSync(DIR)
      .filter(f => backupRe.test(f))
      .map(name => ({ name, mtimeMs: fs.statSync(path.join(DIR, name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
      .map(item => item.name);
    for (const old of all.slice(Math.max(0, MAX_BACKUPS - (backup ? 1 : 0)))) {
      const p = path.join(DIR, old);
      if (fs.existsSync(p)) changes.push({ file: p, bytes: null });
    }
  } catch (error) {
    // 清理历史备份失败不影响本次已完成的安全备份。
    console.error("清理历史备份失败:", error.message);
  }
  changes.push({ file: README, bytes: Buffer.from(text) });
  return trustedWriteSet(changes, Object.assign({ action: "store.mutate" }, options));
}

/**
 * 串行执行读取-修改-写入事务。mutator 返回字符串，或
 * {text, result, write};write=false 可用于重复检测等只读事务。
 */
function mutate(mutator, options = {}) {
  const run = writeTail.then(async () => {
    const current = readAll();
    const change = await mutator(current);
    if (typeof change === "string") {
      writeWithBackup(change, options);
      return undefined;
    }
    if (!change || typeof change !== "object") throw new Error("写事务未返回有效结果");
    if (change.write !== false) {
      if (typeof change.text !== "string") throw new Error("写事务缺少 text");
      writeWithBackup(change.text, Object.assign({}, options, change.operation || {}, { additionalChanges: change.files || options.additionalChanges }));
    }
    return change.result;
  });
  writeTail = run.catch(() => undefined);
  return run;
}

module.exports = {
  README, DIR, CONTROL_DIR,
  // 纯函数
  categoryOf, nextIdIn, buildSnippet, insertSnippet, deleteEntry, updateStatus, updateNote, mergeEntryFields,
  // 文件工具
  readAll, writeAtomic, writeWithBackup, mutate,
  fileFingerprint, recoverTrustedWrites, trustedWriteFile, trustedWriteSet,
  findDuplicateUrl: schema.findDuplicateUrl,
};
