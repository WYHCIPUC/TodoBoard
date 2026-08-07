"use strict";
const fs = require("fs");
const path = require("path");
const schema = require("./schema");

function timestamp(now) {
  return (now || new Date()).toISOString().replace(/[:.]/g, "-");
}

function uniqueDir(parent, prefix) {
  let dir = path.join(parent, prefix);
  let n = 1;
  while (fs.existsSync(dir)) dir = path.join(parent, prefix + "-" + n++);
  return dir;
}

function writeAtomic(file, text) {
  const tmp = file + ".migration.tmp";
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, file);
}

function copyDir(source, target) {
  if (fs.existsSync(target)) throw new Error("迁移目标目录已存在: " + target);
  fs.mkdirSync(target, { recursive: true });
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, item.name);
    const to = path.join(target, item.name);
    if (item.isDirectory()) {
      copyDir(from, to);
    } else if (item.isFile()) {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    } else {
      throw new Error("迁移档案包含不支持的文件类型: " + from);
    }
  }
}

function createBackup(dataFile, entriesDir, now) {
  const root = path.join(path.dirname(dataFile), ".linggan", "migration-backups");
  fs.mkdirSync(root, { recursive: true });
  const backupDir = uniqueDir(root, timestamp(now));
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(dataFile, path.join(backupDir, path.basename(dataFile)));
  if (fs.existsSync(entriesDir)) copyDir(entriesDir, path.join(backupDir, "entries"));
  const manifest = {
    createdAt: (now || new Date()).toISOString(),
    dataFile: path.resolve(dataFile),
    dataName: path.basename(dataFile),
    entriesDir: path.resolve(entriesDir),
  };
  fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
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
    fs.mkdirSync(entriesDir, { recursive: true });
    for (const item of copies) {
      const legacy = path.join(entriesDir, item.id);
      const target = path.join(entriesDir, item.uid);
      copyDir(legacy, target);
    }
    if (result.changed) writeAtomic(dataFile, result.text);

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
  fs.mkdirSync(preservedRoot, { recursive: true });
  const preserved = uniqueDir(preservedRoot, timestamp(options.now));
  fs.mkdirSync(preserved, { recursive: true });
  if (fs.existsSync(dataFile)) fs.copyFileSync(dataFile, path.join(preserved, path.basename(dataFile)));
  if (fs.existsSync(entriesDir)) copyDir(entriesDir, path.join(preserved, "entries"));

  fs.copyFileSync(backupData, dataFile + ".rollback.tmp");
  fs.renameSync(dataFile + ".rollback.tmp", dataFile);
  const backupEntries = path.join(backupDir, "entries");
  if (fs.existsSync(entriesDir)) fs.rmSync(entriesDir, { recursive: true, force: true });
  if (fs.existsSync(backupEntries)) copyDir(backupEntries, entriesDir);
  return { ok: true, preservedDir: preserved };
}

module.exports = { migrateData, rollback, createBackup };
