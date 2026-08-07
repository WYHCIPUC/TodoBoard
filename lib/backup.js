"use strict";
const fs = require("fs");
const path = require("path");
const schema = require("./schema");
const store = require("./store");
const entries = require("./entries");
const migrate = require("./migrate");

const FORMAT = "linggan-backup";
const FORMAT_VERSION = 1;
const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;

function safeFileName(name) {
  return /^(notes\.md|content\.md|screenshots\/[0-9A-Za-z._-]+\.(png|jpe?g))$/i.test(name || "");
}

function exportBundle(options) {
  options = options || {};
  const dataText = options.dataText == null ? store.readAll() : String(options.dataText);
  const entriesDir = path.resolve(options.entriesDir || entries.ENTRIES_DIR);
  const bundle = {
    format: FORMAT,
    version: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    data: dataText,
    entries: [],
  };
  let bytes = Buffer.byteLength(dataText);

  for (const entry of schema.scanEntries(dataText)) {
    const key = entry.uid || entry.id;
    const dir = path.resolve(entriesDir, key);
    if (!dir.startsWith(entriesDir + path.sep) || !fs.existsSync(dir)) continue;
    const files = [];
    for (const name of ["notes.md", "content.md"]) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file);
      bytes += content.length;
      files.push({ name, encoding: "utf8", data: content.toString("utf-8") });
    }
    const shots = path.join(dir, "screenshots");
    if (fs.existsSync(shots)) {
      for (const name of fs.readdirSync(shots).sort()) {
        if (!/\.(png|jpe?g)$/i.test(name)) continue;
        const content = fs.readFileSync(path.join(shots, name));
        bytes += content.length;
        files.push({ name: "screenshots/" + name, encoding: "base64", data: content.toString("base64") });
      }
    }
    if (files.length) bundle.entries.push({ uid: key, id: entry.id, files });
    if (bytes > MAX_BUNDLE_BYTES) throw new Error("完整备份超过 50MB 限制");
  }
  return bundle;
}

function validateBundle(bundle) {
  if (!bundle || bundle.format !== FORMAT || bundle.version !== FORMAT_VERSION) {
    throw new Error("不是受支持的灵感来袭备份包");
  }
  if (typeof bundle.data !== "string" || !Array.isArray(bundle.entries)) {
    throw new Error("备份包结构不完整");
  }
  const migrated = schema.migrateText(bundle.data);
  const validUids = new Set(schema.scanEntries(migrated.text).map(entry => entry.uid));
  let bytes = Buffer.byteLength(migrated.text);
  for (const item of bundle.entries) {
    if (!validUids.has(item.uid) || !Array.isArray(item.files)) throw new Error("备份包包含未知条目");
    for (const file of item.files) {
      if (!safeFileName(file.name) || !["utf8", "base64"].includes(file.encoding)) {
        throw new Error("备份包包含非法文件: " + file.name);
      }
      const content = Buffer.from(String(file.data || ""), file.encoding === "base64" ? "base64" : "utf-8");
      bytes += content.length;
      if (bytes > MAX_BUNDLE_BYTES) throw new Error("备份包解压后超过 50MB 限制");
      if (/\.(png|jpe?g)$/i.test(file.name)) {
        const png = content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e && content[3] === 0x47;
        const jpg = content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
        if (!png && !jpg) throw new Error("备份包图片格式非法: " + file.name);
      }
    }
  }
  return { text: migrated.text, entryCount: validUids.size, bytes };
}

async function importBundle(bundle, options) {
  options = options || {};
  const dataFile = path.resolve(options.dataFile || store.README);
  const entriesDir = path.resolve(options.entriesDir || entries.ENTRIES_DIR);
  const checked = validateBundle(bundle);
  const backupDir = migrate.createBackup(dataFile, entriesDir);
  try {
    fs.mkdirSync(entriesDir, { recursive: true });
    for (const item of bundle.entries) {
      const dir = path.resolve(entriesDir, item.uid);
      if (!dir.startsWith(entriesDir + path.sep)) throw new Error("备份条目路径越界");
      fs.mkdirSync(dir, { recursive: true });
      for (const file of item.files) {
        const target = path.resolve(dir, file.name);
        if (!target.startsWith(dir + path.sep)) throw new Error("备份文件路径越界");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const content = Buffer.from(String(file.data || ""), file.encoding === "base64" ? "base64" : "utf-8");
        const tmp = target + ".import.tmp";
        fs.writeFileSync(tmp, content);
        fs.renameSync(tmp, target);
      }
    }
    await store.mutate(() => ({ text: checked.text, result: true }));
  } catch (error) {
    error.message += "；导入前备份位于 " + backupDir;
    throw error;
  }
  return { ok: true, entryCount: checked.entryCount, bytes: checked.bytes, backupDir };
}

module.exports = { FORMAT, FORMAT_VERSION, MAX_BUNDLE_BYTES, exportBundle, validateBundle, importBundle };
