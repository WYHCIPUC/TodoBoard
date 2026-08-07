"use strict";
const crypto = require("crypto");

const DATA_VERSION = 2;
const VERSION_RE = /^<!--\s*linggan:data-version=(\d+)\s*-->$/;
const UID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UID_LINE_RE = /^<!--\s*linggan:uid=([^\s]+)\s*-->$/;
const ENTRY_HEAD_RE = /^###\s+([⏳🔄✅])\s*(\d+\.\d+)\s+(.+)$/u;

function newUid() {
  return crypto.randomUUID();
}

function getDataVersion(text) {
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(VERSION_RE);
    if (match) return Number(match[1]);
  }
  return 1;
}

function scanEntries(text) {
  const lines = String(text || "").split(/\r?\n/);
  const entries = [];
  let current = null;

  for (const line of lines) {
    const head = line.match(ENTRY_HEAD_RE);
    if (head) {
      current = {
        id: head[2],
        uid: "",
        status: head[1],
        title: head[3].trim(),
        url: "",
        fields: {},
      };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    if (/^##\s/.test(line) || /^---\s*$/.test(line)) {
      current = null;
      continue;
    }
    const uidLine = line.match(UID_LINE_RE);
    if (uidLine) current.uid = uidLine[1];
    const field = line.match(/^-\s+\*\*([^*]+)\*\*[：:]\s*(.*)$/);
    if (field) current.fields[field[1].trim()] = field[2].trim();
    if (!current.url && /\*\*作者\s*\/\s*来源\*\*/.test(line)) {
      const link = line.match(/\]\((https?:\/\/[^)]+)\)/i);
      if (link) current.url = link[1];
    }
  }

  return entries;
}

function validateEntries(entries, requireUid) {
  const ids = new Set();
  const uids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error("条目编号重复: " + entry.id);
    ids.add(entry.id);
    if (!entry.uid) {
      if (requireUid) throw new Error("条目缺少稳定 UID: " + entry.id);
      continue;
    }
    if (!UID_RE.test(entry.uid)) throw new Error("条目 UID 非法: " + entry.id);
    if (uids.has(entry.uid)) throw new Error("条目 UID 重复: " + entry.uid);
    uids.add(entry.uid);
  }
  return true;
}

function migrateText(text, uidFactory) {
  text = String(text || "");
  const currentVersion = getDataVersion(text);
  if (currentVersion > DATA_VERSION) {
    throw new Error("数据格式版本过新，当前程序无法读取: " + currentVersion);
  }

  const makeUid = uidFactory || newUid;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const source = text.split(/\r?\n/)
    .filter(line => !VERSION_RE.test(line));
  const output = [];
  const seen = new Set();
  const mapping = [];

  for (let i = 0; i < source.length; i++) {
    const line = source[i];
    const head = line.match(ENTRY_HEAD_RE);
    output.push(line);
    if (!head) continue;

    let uid = "";
    for (let j = i + 1; j < source.length; j++) {
      if (ENTRY_HEAD_RE.test(source[j]) || /^##\s/.test(source[j]) || /^---\s*$/.test(source[j])) break;
      const uidLine = source[j].match(UID_LINE_RE);
      if (uidLine) {
        uid = uidLine[1];
        break;
      }
      if (/^<!--\s*linggan:uid=/.test(source[j])) {
        throw new Error("条目 UID 标记格式错误: " + head[2]);
      }
    }

    const created = !uid;
    if (!uid) uid = String(makeUid({ id: head[2], title: head[3].trim() }));
    if (!UID_RE.test(uid)) throw new Error("条目 UID 非法: " + head[2]);
    if (seen.has(uid)) throw new Error("条目 UID 重复: " + uid);
    seen.add(uid);
    if (created) output.push("<!-- linggan:uid=" + uid + " -->");
    mapping.push({ id: head[2], uid, title: head[3].trim(), created });
  }

  const marker = "<!-- linggan:data-version=" + DATA_VERSION + " -->";
  const titleIndex = output.findIndex(line => /^#\s+/.test(line));
  const insertAt = titleIndex >= 0 ? titleIndex + 1 : 0;
  output.splice(insertAt, 0, marker);

  const migrated = output.join(newline);
  const entries = scanEntries(migrated);
  validateEntries(entries, true);
  return {
    changed: migrated !== text,
    text: migrated,
    fromVersion: currentVersion,
    toVersion: DATA_VERSION,
    mapping,
  };
}

function findEntry(text, ref) {
  ref = String(ref || "");
  return scanEntries(text).find(entry => entry.id === ref || entry.uid === ref) || null;
}

function storageKey(text, ref) {
  const entry = findEntry(text, ref);
  return entry && entry.uid ? entry.uid : String(ref || "");
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    if (url.pathname === "/") url.pathname = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function findDuplicateUrl(text, value) {
  const wanted = normalizeUrl(value);
  if (!wanted) return null;
  return scanEntries(text).find(entry => normalizeUrl(entry.url) === wanted) || null;
}

module.exports = {
  DATA_VERSION,
  UID_RE,
  ENTRY_HEAD_RE,
  newUid,
  getDataVersion,
  scanEntries,
  validateEntries,
  migrateText,
  findEntry,
  storageKey,
  normalizeUrl,
  findDuplicateUrl,
};
