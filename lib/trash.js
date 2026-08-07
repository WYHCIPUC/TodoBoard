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
  if (!fs.existsSync(source)) return false;
  fs.cpSync(source, target, { recursive: true, errorOnExist: true });
  return true;
}

async function archiveEntry(id) {
  return store.mutate(text => {
    const entry = schema.findEntry(text, id);
    const extracted = extractRecord(text, id);
    if (!entry || !extracted) return { write: false, result: null };
    const updated = store.deleteEntry(text, id);
    if (updated === null) return { write: false, result: null };

    fs.mkdirSync(TRASH_DIR, { recursive: true });
    const name = recordName(entry.uid || id.replace(".", "-"));
    const dir = safeRecord(name);
    fs.mkdirSync(dir, { recursive: true });
    const meta = {
      version: 1,
      archivedAt: new Date().toISOString(),
      id: entry.id,
      uid: entry.uid || "",
      title: entry.title,
      category: extracted.category,
    };
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
    fs.writeFileSync(path.join(dir, "entry.md"), extracted.block + "\n", "utf-8");
    copyEntryData(id, path.join(dir, "data"));
    return { text: updated, result: Object.assign({ record: name }, meta) };
  });
}

function listEntries() {
  if (!fs.existsSync(TRASH_DIR)) return [];
  const result = [];
  for (const name of fs.readdirSync(TRASH_DIR).sort().reverse()) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(safeRecord(name), "meta.json"), "utf-8"));
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
    return {
      text: store.insertSnippet(text, meta.category, block),
      result: { alreadyRestored: false, id, uid: meta.uid || "" },
    };
  });

  const data = path.join(dir, "data");
  if (fs.existsSync(data)) {
    const target = entries.safePath(result.id);
    if (!fs.existsSync(target)) fs.cpSync(data, target, { recursive: true, errorOnExist: true });
  }
  return result;
}

module.exports = { TRASH_DIR, archiveEntry, restoreEntry, listEntries, extractRecord };
