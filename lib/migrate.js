"use strict";
const fs = require("fs");
const path = require("path");
const schema = require("./schema");
const store = require("./store");

function timestamp(now) {
  return (now || new Date()).toISOString().replace(/[:.]/g, "-");
}

function uniqueDir(parent, prefix) {
  let dir = path.join(parent, prefix);
  let n = 1;
  while (fs.existsSync(dir)) dir = path.join(parent, prefix + "-" + n++);
  return dir;
}

function inventoryDirectory(root) {
  const files = [];
  const directories = [];
  if (!fs.existsSync(root)) return { files, directories };
  const visit = (current, relative) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      const child = path.join(relative, item.name);
      if (item.isDirectory()) {
        directories.push(child);
        visit(full, child);
      } else if (item.isFile()) {
        files.push({ relative: child, bytes: fs.readFileSync(full) });
      } else throw new Error("迁移档案包含不支持的文件类型: " + full);
    }
  };
  visit(root, "");
  return { files, directories };
}

function createBackup(dataFile, entriesDir, now) {
  const root = path.join(path.dirname(dataFile), ".linggan", "migration-backups");
  const backupDir = uniqueDir(root, timestamp(now));
  const inventory = inventoryDirectory(entriesDir);
  const manifest = {
    createdAt: (now || new Date()).toISOString(),
    dataFile: path.resolve(dataFile),
    dataName: path.basename(dataFile),
    entriesDir: path.resolve(entriesDir),
    directories: inventory.directories.map(value => value.replace(/\\/g, "/")),
  };
  const changes = [
    { file: path.join(backupDir, path.basename(dataFile)), bytes: fs.readFileSync(dataFile) },
    { file: path.join(backupDir, "manifest.json"), bytes: Buffer.from(JSON.stringify(manifest, null, 2)) },
    ...inventory.files.map(item => ({ file: path.join(backupDir, "entries", item.relative), bytes: item.bytes })),
  ];
  store.trustedWriteSet(changes, { action: "migrate.backup", controlDir: path.join(path.dirname(dataFile), ".linggan") });
  return backupDir;
}

function migrateData(options) {
  const dataFile = path.resolve(options.dataFile);
  const entriesDir = path.resolve(options.entriesDir);
  if (!fs.existsSync(dataFile)) throw new Error("数据文件不存在: " + dataFile);

  const original = fs.readFileSync(dataFile, "utf-8");
  const result = schema.migrateText(original, options.uidFactory);
  const copies = result.mapping.filter(item => {
    const legacy = path.join(entriesDir, item.id);
    const target = path.join(entriesDir, item.uid);
    return fs.existsSync(legacy) && !fs.existsSync(target);
  });

  if (!result.changed && !copies.length) {
    return Object.assign({}, result, { backupDir: "", copiedEntries: 0 });
  }

  const backupDir = createBackup(dataFile, entriesDir, options.now);
  try {
    const changes = [];
    const emptyDirectories = [];
    for (const item of copies) {
      const legacy = path.join(entriesDir, item.id);
      const target = path.join(entriesDir, item.uid);
      const inventory = inventoryDirectory(legacy);
      for (const file of inventory.files) changes.push({ file: path.join(target, file.relative), bytes: file.bytes });
      for (const directory of inventory.directories) emptyDirectories.push(path.join(target, directory));
    }
    if (result.changed) changes.push({ file: dataFile, bytes: Buffer.from(result.text) });
    store.trustedWriteSet(changes, { action: "migrate.data", controlDir: path.join(path.dirname(dataFile), ".linggan") });
    for (const directory of emptyDirectories) fs.mkdirSync(directory, { recursive: true });

    const written = fs.readFileSync(dataFile, "utf-8");
    schema.validateEntries(schema.scanEntries(written), true);
    for (const item of copies) {
      if (!fs.existsSync(path.join(entriesDir, item.uid))) {
        throw new Error("研究档案迁移校验失败: " + item.id);
      }
    }
  } catch (error) {
    error.message += "；迁移前备份位于 " + backupDir;
    throw error;
  }

  return Object.assign({}, result, {
    backupDir,
    copiedEntries: copies.length,
  });
}

function rollback(backupDir, options) {
  backupDir = path.resolve(backupDir);
  const manifestPath = path.join(backupDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("迁移备份缺少 manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const dataFile = path.resolve(options.dataFile);
  const entriesDir = path.resolve(options.entriesDir);
  if (manifest.dataFile !== dataFile || manifest.entriesDir !== entriesDir) {
    throw new Error("迁移备份与当前数据路径不匹配");
  }

  const backupData = path.join(backupDir, manifest.dataName);
  if (!fs.existsSync(backupData)) throw new Error("迁移备份缺少数据文件");

  const preservedRoot = path.join(path.dirname(dataFile), ".linggan", "rollback-preserved");
  const preserved = uniqueDir(preservedRoot, timestamp(options.now));
  const currentInventory = inventoryDirectory(entriesDir);
  const preservedManifest = { createdAt: (options.now || new Date()).toISOString(), dataFile, entriesDir, directories: currentInventory.directories.map(value => value.replace(/\\/g, "/")) };
  const changes = [
    { file: path.join(preserved, path.basename(dataFile)), bytes: fs.readFileSync(dataFile) },
    { file: path.join(preserved, "manifest.json"), bytes: Buffer.from(JSON.stringify(preservedManifest, null, 2)) },
    ...currentInventory.files.map(item => ({ file: path.join(preserved, "entries", item.relative), bytes: item.bytes })),
    { file: dataFile, bytes: fs.readFileSync(backupData) },
    ...currentInventory.files.map(item => ({ file: path.join(entriesDir, item.relative), bytes: null })),
  ];
  const backupEntries = path.join(backupDir, "entries");
  const backupInventory = inventoryDirectory(backupEntries);
  changes.push(...backupInventory.files.map(item => ({ file: path.join(entriesDir, item.relative), bytes: item.bytes })));
  const byTarget = new Map();
  for (const change of changes) byTarget.set(path.resolve(change.file), change);
  store.trustedWriteSet([...byTarget.values()], { action: "migrate.rollback", controlDir: path.join(path.dirname(dataFile), ".linggan") });
  if (fs.existsSync(entriesDir)) {
    const clean = directory => {
      for (const item of fs.readdirSync(directory, { withFileTypes: true })) if (item.isDirectory()) clean(path.join(directory, item.name));
      if (directory !== entriesDir && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
    };
    clean(entriesDir);
  }
  for (const directory of backupInventory.directories) fs.mkdirSync(path.join(entriesDir, directory), { recursive: true });
  return { ok: true, preservedDir: preserved };
}

module.exports = { migrateData, rollback, createBackup, inventoryDirectory };
