"use strict";
const fs = require("fs");
const path = require("path");
const store = require("./store");
const entries = require("./entries");
const schema = require("./schema");

const TRASH_DIR = process.env.TRASH_DIR
  ? path.resolve(process.env.TRASH_DIR)
  : path.join(path.dirname(store.README), ".linggan", "trash");

function recordName(uid) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return stamp + "-" + uid;
}

function safeRecord(name) {
  if (!/^[0-9A-Za-z.-]+$/.test(name || "")) throw new Error("非法回收站记录");
  const root = path.resolve(TRASH_DIR);
  const target = path.resolve(root, name);
  if (!target.startsWith(root + path.sep)) throw new Error("回收站路径越界");
  return target;
}

function extractRecord(text, id) {
  const lines = text.split(/\r?\n/);
  let category = "其他";
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const section = lines[i].match(/^##\s+\d+\.\s+(.+)$/);
    if (section) category = store.categoryOf(section[1]);
    const head = lines[i].match(schema.ENTRY_HEAD_RE);
    if (head && head[2] === id) {
      start = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (schema.ENTRY_HEAD_RE.test(lines[j]) || /^##\s/.test(lines[j]) || /^---\s*$/.test(lines[j])) {
          end = j;
          break;
        }
      }
      break;
    }
  }
  if (start < 0) return null;
  return { category, block: lines.slice(start, end).join("\n").trim() };
}

function copyEntryData(id, target) {
  const source = entries.safePath(id);
  if (!fs.existsSync(source)) return [];
  const files = [];
  const visit = (current, relative) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const from = path.join(current, item.name);
      const child = path.join(relative, item.name);
      if (item.isDirectory()) visit(from, child);
      else if (item.isFile()) files.push({ file: path.join(target, child), bytes: fs.readFileSync(from) });
      else throw new Error("回收站拒绝特殊文件");
    }
  };
  visit(source, "");
  return files;
}

async function archiveEntry(id) {
  return store.mutate(text => {
    const entry = schema.findEntry(text, id);
    const extracted = extractRecord(text, id);
    if (!entry || !extracted) return { write: false, result: null };
    const updated = store.deleteEntry(text, id);
    if (updated === null) return { write: false, result: null };

    const name = recordName(entry.uid || id.replace(".", "-"));
    const dir = safeRecord(name);
    const meta = {
      version: 1,
      archivedAt: new Date().toISOString(),
      id: entry.id,
      uid: entry.uid || "",
      title: entry.title,
      category: extracted.category,
    };
    const files = [
      { file: path.join(dir, "meta.json"), bytes: Buffer.from(JSON.stringify(meta, null, 2)) },
      { file: path.join(dir, "entry.md"), bytes: Buffer.from(extracted.block + "\n") },
      ...copyEntryData(id, path.join(dir, "data")),
    ];
    return { text: updated, files, operation: { action: "trash.archive" }, result: Object.assign({ record: name }, meta) };
  });
}

function listEntries() {
  if (!fs.existsSync(TRASH_DIR)) return [];
  const result = [];
  for (const name of fs.readdirSync(TRASH_DIR).sort().reverse()) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(safeRecord(name), "meta.json"), "utf-8"));
      if (meta.restoredAt) continue;
      result.push(Object.assign({ record: name }, meta));
    } catch (_) {}
  }
  return result;
}

async function restoreEntry(name) {
  const dir = safeRecord(name);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf-8"));
  let block = fs.readFileSync(path.join(dir, "entry.md"), "utf-8").trim();
  const result = await store.mutate(text => {
    if (meta.uid && schema.findEntry(text, meta.uid)) {
      return { write: false, result: { alreadyRestored: true, id: meta.id, uid: meta.uid } };
    }
    let id = meta.id;
    if (schema.findEntry(text, id)) {
      id = store.nextIdIn(text, meta.category);
      block = block.replace(schema.ENTRY_HEAD_RE, (_all, status, _oldId, title) => `### ${status} ${id} ${title}`);
    }
    const targetRoot = path.join(entries.ENTRIES_DIR, meta.uid || id.replace(".", "-"));
    const files = [];
    const data = path.join(dir, "data");
    if (fs.existsSync(data)) {
      const collect = (current, relative) => {
        for (const item of fs.readdirSync(current, { withFileTypes: true })) {
          const from = path.join(current, item.name);
          const child = path.join(relative, item.name);
          if (item.isDirectory()) collect(from, child);
          else if (item.isFile()) {
            const target = path.join(targetRoot, child);
            const bytes = fs.readFileSync(from);
            if (fs.existsSync(target) && !fs.readFileSync(target).equals(bytes)) throw Object.assign(new Error("恢复目标档案发生冲突"), { code: "trash_restore_collision" });
            files.push({ file: target, bytes });
          } else throw new Error("回收站记录包含特殊文件");
        }
      };
      collect(data, "");
    }
    const restoredMeta = Object.assign({}, meta, { restoredAt: new Date().toISOString(), restoredId: id });
    files.push({ file: path.join(dir, "meta.json"), bytes: Buffer.from(JSON.stringify(restoredMeta, null, 2)) });
    return {
      text: store.insertSnippet(text, meta.category, block),
      files,
      operation: { action: "trash.restore" },
      result: { alreadyRestored: false, id, uid: meta.uid || "" },
    };
  });
  return result;
}

module.exports = { TRASH_DIR, archiveEntry, restoreEntry, listEntries, extractRecord };
