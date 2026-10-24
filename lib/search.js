"use strict";
const fs = require("fs");
const path = require("path");
const schema = require("./schema");
const entries = require("./entries");
const archiveContent = require("./archive-content");

const DEFAULT_READ_LIMIT = 1024 * 1024;
const DEFAULT_CACHE_ENTRIES = 512;
const DEFAULT_CACHE_CHARS = 32 * 1024 * 1024;

/**
 * 有界的文件文本缓存。
 *
 * 深度搜索会在每次查询时读取所有条目的 notes.md 与归档正文；这些文件在两次
 * 查询之间通常没有变化。缓存以绝对路径、读取上限和截断策略为键，并在命中前
 * 重新 stat，比对 mtimeMs/ctimeMs/size；文件被替换、删除或改变大小都会自然失效。
 */
function createReadCache(options) {
  options = options || {};
  const maxEntries = Math.max(1, Number(options.maxEntries) || DEFAULT_CACHE_ENTRIES);
  const maxChars = Math.max(1024, Number(options.maxChars) || DEFAULT_CACHE_CHARS);
  const records = new Map();
  let chars = 0;
  let hits = 0;
  let misses = 0;

  function evict() {
    while (records.size > maxEntries || chars > maxChars) {
      const oldest = records.keys().next();
      if (oldest.done) break;
      const record = records.get(oldest.value);
      chars -= record.text.length;
      records.delete(oldest.value);
    }
  }

  function read(file, readOptions) {
    readOptions = readOptions || {};
    const limit = Math.max(1, Number(readOptions.limit) || DEFAULT_READ_LIMIT);
    const truncate = readOptions.truncate !== false;
    let stat;
    try { stat = fs.statSync(file); } catch (_) { return null; }
    if (!stat.isFile()) return null;
    if (!truncate && stat.size > limit) return null;
    const stamp = stat.mtimeMs + ":" + stat.ctimeMs + ":" + stat.size;
    const key = file + "\u0000" + limit + "\u0000" + (truncate ? "truncate" : "skip");
    const record = records.get(key);
    if (record && record.stamp === stamp) {
      hits++;
      records.delete(key);
      records.set(key, record);
      return record.text;
    }
    let text;
    try {
      const buffer = fs.readFileSync(file);
      text = buffer.subarray(0, Math.min(limit, buffer.length)).toString("utf8");
    } catch (_) { return null; }
    misses++;
    if (record) {
      chars -= record.text.length;
      records.delete(key);
    }
    records.set(key, { stamp, text });
    chars += text.length;
    evict();
    return text;
  }

  return {
    read,
    clear() { records.clear(); chars = 0; hits = 0; misses = 0; },
    stats() {
      return { entries: records.size, chars, hits, misses, maxEntries, maxChars };
    },
  };
}

const defaultReadCache = createReadCache();

function readNotes(notesPath, cache) {
  const text = cache.read(notesPath, { truncate: true });
  return text === null ? "" : text;
}

function readArchiveText(root, key, cache) {
  let file;
  try { file = archiveContent.contentPath(root, key); }
  catch (_) { return ""; }
  const text = cache.read(file, { limit: DEFAULT_READ_LIMIT, truncate: false });
  return text === null ? "" : text;
}

function excerpt(text, terms) {
  const plain = String(text || "").replace(/<!--[^>]*-->/g, " ").replace(/\s+/g, " ").trim();
  const lower = plain.toLowerCase();
  let index = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) return plain.slice(0, 160);
  const start = Math.max(0, index - 50);
  return (start ? "…" : "") + plain.slice(start, start + 180) + (start + 180 < plain.length ? "…" : "");
}

function searchData(dataText, query, options) {
  options = options || {};
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const root = path.resolve(options.entriesDir || entries.ENTRIES_DIR);
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 100));
  const cache = options.cache || defaultReadCache;
  const results = [];

  for (const entry of schema.scanEntries(dataText)) {
    const metadata = [entry.id, entry.title, entry.url]
      .concat(Object.entries(entry.fields || {}).flat())
      .join("\n");
    const key = entry.uid || entry.id;
    const dir = path.resolve(root, key);
    const insideRoot = dir.startsWith(root + path.sep);
    const notes = insideRoot ? readNotes(path.join(dir, "notes.md"), cache) : "";
    const content = insideRoot ? readArchiveText(root, key, cache) : "";
    const full = (metadata + "\n" + notes + "\n" + content).toLowerCase();
    if (!terms.every(term => full.includes(term))) continue;
    const matches = [];
    if (terms.some(term => metadata.toLowerCase().includes(term))) matches.push("metadata");
    if (terms.some(term => notes.toLowerCase().includes(term))) matches.push("notes");
    if (terms.some(term => content.toLowerCase().includes(term))) matches.push("content");
    results.push({
      id: entry.id,
      uid: entry.uid,
      title: entry.title,
      matches,
      excerpt: excerpt([metadata, notes, content].join("\n"), terms),
    });
    if (results.length >= limit) break;
  }
  return results;
}

module.exports = { createReadCache, searchData, excerpt };
