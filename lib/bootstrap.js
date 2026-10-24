"use strict";

const fs = require("fs");
const path = require("path");
const { createArchiveService, recoverArchiveTransactions } = require("./archive");
const { acquireVolumeLocks } = require("./volume-lock");
const migrate = require("./migrate");
const schema = require("./schema");
const store = require("./store");
const upgrade = require("./upgrade");

class BootstrapError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "BootstrapError";
    this.code = code;
    this.details = details || null;
  }
}

function overlaps(left, right) {
  const relative = path.relative(left, right);
  return relative === "" || !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

function validateTopology(paths) {
  const targets = [paths.dataFile, paths.entriesDir, paths.brainstormsDir, paths.trashDir, paths.orphansDir].map(value => path.resolve(value));
  for (let left = 0; left < targets.length; left++) for (let right = left + 1; right < targets.length; right++) {
    if (overlaps(targets[left], targets[right]) || overlaps(targets[right], targets[left])) throw new BootstrapError("invalid_storage_topology", "活动数据目标互相重叠");
  }
  const controls = ["import-transactions", "upgrade-snapshots", "idempotency", "t3-operations"].map(name => path.join(paths.controlDir, name));
  for (const target of targets) for (const control of controls) if (overlaps(target, control) || overlaps(control, target)) throw new BootstrapError("invalid_storage_topology", "活动数据目标与控制路径重叠");
  return targets;
}

function hasUserEvidence(paths) {
  if (fs.existsSync(paths.dataFile)) return true;
  for (const root of [paths.entriesDir, paths.brainstormsDir, paths.trashDir, paths.orphansDir]) {
    if (fs.existsSync(root) && fs.readdirSync(root).length) return true;
  }
  if (fs.existsSync(paths.controlDir)) {
    // 实例锁不是用户数据；首次启动崩溃留下的锁不应被误判为已有安装。
    const ignored = (name) => name === ".DS_Store" || name === "instance.lock" ||
      name.startsWith("instance.lock.stale-") || (name.startsWith(".linggan-owner-") && name.endsWith(".lock"));
    if (fs.readdirSync(paths.controlDir).some((name) => !ignored(name))) return true;
  }
  const runtimeRoot = path.dirname(paths.controlDir);
  for (const name of ["archive-jobs.json", "archive-jobs.json.previous"]) if (fs.existsSync(path.join(runtimeRoot, name))) return true;
  return false;
}

function inspectInstall(paths) {
  const dataExists = fs.existsSync(paths.dataFile);
  const evidence = hasUserEvidence(paths);
  if (!dataExists && evidence) return { state: "data_missing", fresh: false };
  if (!dataExists) return { state: "fresh", fresh: true };
  try {
    const text = fs.readFileSync(paths.dataFile, "utf8");
    const version = schema.getDataVersion(text);
    if (version > schema.DATA_VERSION) return { state: "downgrade_rejected", fresh: false, version };
    return { state: "existing", fresh: false, version };
  } catch (error) { return { state: "corrupt", fresh: false, error: error.message }; }
}

async function bootstrap(options = {}) {
  const paths = upgrade.resolvePaths(options);
  const resources = validateTopology(paths);
  const audit = options.auditLegacy || (async () => ({ ok: true, summary: "not-configured" }));
  const auditResult = await audit({ paths, resources });
  if (!auditResult || auditResult.ok !== true) throw new BootstrapError("legacy_instance_may_be_running", "可能仍有旧版本进程在运行", auditResult);
  const bind = options.bindBootstrapListener || (async () => ({ promote: async () => {}, close: async () => {} }));
  const listener = await bind({ paths, audit: auditResult });
  let locks = null;
  try {
    const before = inspectInstall(paths);
    const acquire = options.acquireLocks || ((items, lockOptions) => acquireVolumeLocks(items, lockOptions));
    locks = await acquire([...resources, paths.controlDir], options.lockOptions || {});
    const locked = inspectInstall(paths);
    if (locked.state !== before.state || locked.version !== before.version) throw new BootstrapError("state_changed", "取得锁前后安装证据发生变化");
    options.recoverGlobal?.({ paths });
    store.recoverTrustedWrites({ controlDir: paths.controlDir });
    recoverArchiveTransactions({ entriesDir: paths.entriesDir, runtimeDir: paths.controlDir, coordinator: options.coordinator });
    const after = inspectInstall(paths);
    if (after.state === "data_missing" || after.state === "corrupt") {
      return { state: "recovery_required", code: after.state, paths, listener, locks, release: () => releaseBootstrap(listener, locks) };
    }
    if (after.state === "downgrade_rejected") {
      return { state: "recovery_required", code: "unsupported_version", paths, listener, locks, release: () => releaseBootstrap(listener, locks) };
    }
    if (before.fresh) {
      const example = path.resolve(options.exampleFile || path.join(__dirname, "..", "DATA.example.md"));
      if (!fs.existsSync(example)) throw new BootstrapError("data_missing", "fresh 初始化缺少 DATA.example.md");
      const bytes = fs.readFileSync(example);
      store.trustedWriteFile(paths.dataFile, bytes, { action: "bootstrap.fresh-data", controlDir: paths.controlDir, coordinator: options.coordinator });
      // DATA.example.md 保留无版本头的示例格式；fresh 安装也必须经过正式迁移，
      // 否则 v2.2 启动会在写入示例后立刻被 schema 拒绝。
      migrate.migrateData({ dataFile: paths.dataFile, entriesDir: paths.entriesDir });
      schema.validateData(fs.readFileSync(paths.dataFile, "utf8"));
    }
    const runUpgrade = options.runUpgrade || upgrade.runUpgrade;
    const upgraded = await runUpgrade({ ...options, ...paths, freshInstall: before.fresh });
    const archiveFactory = options.archiveFactory || createArchiveService;
    const archive = archiveFactory({ paths: { entriesDir: paths.entriesDir, runtimeDir: paths.controlDir }, autoStart: false, coordinator: options.coordinator });
    const promote = async () => {
      await listener.promote?.();
      archive.queue?.start?.();
      return { state: "ready" };
    };
    return { state: "ready", freshInstall: before.fresh, paths, listener, locks, upgraded, archive, promote, release: () => releaseBootstrap(listener, locks, archive) };
  } catch (error) {
    await releaseBootstrap(listener, locks);
    throw error;
  }
}

async function releaseBootstrap(listener, locks, archive) {
  try { await archive?.stop?.(); } finally {
    try {
      if (locks?.release) await locks.release();
      else if (locks?.close) await locks.close();
    } finally { await listener?.close?.(); }
  }
}

module.exports = { BootstrapError, bootstrap, hasUserEvidence, inspectInstall, releaseBootstrap, validateTopology };
