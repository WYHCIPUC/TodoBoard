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
const ARCHIVE_FILES = [
  ["archive/metadata.json", "utf8"],
  ["archive/content.md", "utf8"],
  ["archive/raw.html.gz", "base64"],
];
const ARCHIVE_IMAGE_NAME = /^[0-9A-Za-z._-]+\.(png|jpe?g|gif|webp|svg|bin)$/i;

function safeFileName(name) {
  return /^(?:notes\.md|content\.md|screenshots\/[0-9A-Za-z._-]+\.(png|jpe?g)|archive\/(?:metadata\.json|content\.md|raw\.html\.gz|images\/[0-9A-Za-z._-]+\.(png|jpe?g|gif|webp|svg|bin)))$/i.test(name || "");
}

function addFile(files, entryDir, name, encoding) {
  const file = path.join(entryDir, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return 0;
  const content = fs.readFileSync(file);
  files.push({
    name,
    encoding,
    data: encoding === "base64" ? content.toString("base64") : content.toString("utf-8"),
  });
  return content.length;
}

function collectEntryFiles(entryDir) {
  const files = [];
  let bytes = 0;
  bytes += addFile(files, entryDir, "notes.md", "utf8");
  bytes += addFile(files, entryDir, "content.md", "utf8");

  const screenshots = path.join(entryDir, "screenshots");
  if (fs.existsSync(screenshots) && fs.statSync(screenshots).isDirectory()) {
    for (const name of fs.readdirSync(screenshots).sort()) {
      if (!/^[0-9A-Za-z._-]+\.(png|jpe?g)$/i.test(name)) continue;
      bytes += addFile(files, entryDir, "screenshots/" + name, "base64");
    }
  }

  const archiveDir = path.join(entryDir, "archive");
  if (fs.existsSync(archiveDir) && fs.statSync(archiveDir).isDirectory()) {
    for (const [name, encoding] of ARCHIVE_FILES) bytes += addFile(files, entryDir, name, encoding);

    const images = path.join(archiveDir, "images");
    if (fs.existsSync(images) && fs.statSync(images).isDirectory()) {
      for (const name of fs.readdirSync(images).sort()) {
        if (!ARCHIVE_IMAGE_NAME.test(name)) continue;
        bytes += addFile(files, entryDir, "archive/images/" + name, "base64");
      }
    }
  }
  return { files, bytes };
}

function validImageContent(name, content) {
  const lower = String(name).toLowerCase();
  if (/\.png$/.test(lower)) return content.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (/\.jpe?g$/.test(lower)) return content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (/\.gif$/.test(lower)) return ["GIF87a", "GIF89a"].includes(content.subarray(0, 6).toString("ascii"));
  if (/\.webp$/.test(lower)) return content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP";
  if (/\.svg$/.test(lower)) return /^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(content.toString("utf8"));
  return true;
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
    const collected = collectEntryFiles(dir);
    bytes += collected.bytes;
    const files = collected.files;
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
      if (/^(?:screenshots\/|archive\/images\/)/.test(file.name)) {
        const valid = validImageContent(file.name, content);
        const png = valid;
        const jpg = valid;
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
