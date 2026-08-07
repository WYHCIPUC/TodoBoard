"use strict";
const fs = require("fs");
const path = require("path");
const schema = require("./schema");
const entries = require("./entries");

function readLimited(file, limit) {
  if (!fs.existsSync(file)) return "";
  const stat = fs.statSync(file);
  if (!stat.isFile()) return "";
  const buffer = fs.readFileSync(file);
  return buffer.slice(0, limit || 1024 * 1024).toString("utf-8");
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
  const results = [];

  for (const entry of schema.scanEntries(dataText)) {
    const metadata = [entry.id, entry.title, entry.url]
      .concat(Object.entries(entry.fields || {}).flat())
      .join("\n");
    const key = entry.uid || entry.id;
    const dir = path.resolve(root, key);
    const insideRoot = dir.startsWith(root + path.sep);
    const notes = insideRoot ? readLimited(path.join(dir, "notes.md")) : "";
    const content = insideRoot ? readLimited(path.join(dir, "content.md")) : "";
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

module.exports = { searchData, excerpt };
