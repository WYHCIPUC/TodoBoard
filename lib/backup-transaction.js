"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  BackupError,
  SCOPES,
  UUID_RE,
  compareUtf8,
  isCanonicalUtc,
  parseBundle,
  sha256,
} = require("./backup-format");
const { atomicJson, syncDirectory, writeFileDurable } = require("./idempotency");
const { defaultCoordinator } = require("./maintenance");
const { acquireVolumeLocks } = require("./volume-lock");

const DAY_MS = 86_400_000;
const RENAME_DELAYS = [0, 50, 100, 200, 400, 800];

class TransactionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "TransactionError";
    this.code = code;
    this.details = details || null;
  }
}

function transactionFail(code, message, details) {
  throw new TransactionError(code, message, details);
}

function sleepSync(milliseconds) {
  if (!milliseconds) return;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, milliseconds);
}

function renameWithRetry(source, destination, operation = fs.renameSync) {
  let last;
  for (const delay of RENAME_DELAYS) {
    sleepSync(delay);
    try {
      operation(source, destination);
      return;
    } catch (error) {
      last = error;
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
    }
  }
  throw last;
}

function lstatKind(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      transactionFail("invalid_storage_topology", "目标包含链接或特殊文件", { pathHash: sha256(file) });
    }
    return stat.isFile() ? "file" : "directory";
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function readStableFile(file) {
  const descriptor = fs.openSync(file, "r");
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) transactionFail("invalid_storage_topology", "只允许普通文件");
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs) {
      transactionFail("state_changed", "读取期间文件发生变化");
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function listDirectoryFiles(root, current = root, output = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => compareUtf8(a.name, b.name))) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/").normalize("NFC");
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      transactionFail("invalid_storage_topology", "目录包含链接或特殊文件", { pathHash: sha256(relative) });
    }
    if (stat.isDirectory()) listDirectoryFiles(root, absolute, output);
    else output.push({ path: relative, data: readStableFile(absolute) });
  }
  return output;
}

function targetManifest(targetPath, rootType, transactionId, scope) {
  const kind = lstatKind(targetPath);
  if (kind && kind !== rootType) transactionFail("invalid_storage_topology", "目标类型与配置不一致", { scope });
  if (rootType === "file") {
    if (!kind) return { version: 1, transactionId, scope, rootType: "file", existed: false, bytes: 0, sha256: null };
    const bytes = readStableFile(targetPath);
    return { version: 1, transactionId, scope, rootType: "file", existed: true, bytes: bytes.length, sha256: sha256(bytes) };
  }
  if (!kind) return { version: 1, transactionId, scope, rootType: "directory", existed: false, fileCount: 0, totalBytes: 0, files: [] };
  const files = listDirectoryFiles(targetPath).sort((a, b) => compareUtf8(a.path, b.path)).map(file => ({
    path: file.path,
    bytes: file.data.length,
    sha256: sha256(file.data),
  }));
  return {
    version: 1,
    transactionId,
    scope,
    rootType: "directory",
    existed: true,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
}

function manifestHash(manifest) {
  return sha256(Buffer.from(JSON.stringify(manifest)));
}

function manifestMatches(targetPath, manifest) {
  try {
    const current = targetManifest(targetPath, manifest.rootType, manifest.transactionId, manifest.scope);
    return JSON.stringify(current) === JSON.stringify(manifest);
  } catch (_) {
    return false;
  }
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: false });
  for (const file of listDirectoryFiles(source)) {
    const target = path.join(destination, ...file.path.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeFileDurable(target, file.data);
  }
  syncTree(destination);
}

function syncTree(root) {
  if (!fs.existsSync(root)) return;
  const directories = [];
  function visit(current) {
    directories.push(current);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(path.join(current, entry.name));
    }
  }
  visit(root);
  for (const directory of directories.reverse()) syncDirectory(directory);
}

function removeOwned(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: false });
  syncDirectory(path.dirname(target));
}

function isInside(left, right) {
  const relative = path.relative(left, right);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function canonicalTargets(paths, controlDir) {
  const targets = [
    { scope: "data", live: path.resolve(paths.data), rootType: "file" },
    { scope: "entries", live: path.resolve(paths.entries), rootType: "directory" },
    { scope: "brainstorms", live: path.resolve(paths.brainstorms), rootType: "directory" },
    { scope: "trash", live: path.resolve(paths.trash), rootType: "directory" },
    { scope: "orphans", live: path.resolve(paths.orphans), rootType: "directory" },
  ];
  const control = path.resolve(controlDir);
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    if (isInside(control, target.live) || isInside(target.live, control)) {
      transactionFail("invalid_storage_topology", "活动目标与控制目录重叠", { scope: target.scope });
    }
    for (let other = index + 1; other < targets.length; other++) {
      if (isInside(target.live, targets[other].live) || isInside(targets[other].live, target.live)) {
        transactionFail("invalid_storage_topology", "活动目标互相重叠", { scopes: [target.scope, targets[other].scope] });
      }
    }
  }
  return targets;
}

function fingerprintTargets(targets) {
  const lines = [];
  for (const target of targets) {
    const manifest = targetManifest(target.live, target.rootType, "00000000-0000-4000-8000-000000000000", target.scope);
    if (target.rootType === "file") {
      if (manifest.existed) lines.push(target.scope + "\0" + manifest.bytes + "\0" + manifest.sha256 + "\n");
    } else {
      for (const file of manifest.files) lines.push(target.scope + "/" + file.path + "\0" + file.bytes + "\0" + file.sha256 + "\n");
    }
  }
  return sha256(Buffer.from(lines.sort((a, b) => compareUtf8(a, b)).join("")));
}

function volumeIdFor(target, provider) {
  if (provider) return String(provider(target));
  let cursor = path.resolve(target);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) transactionFail("invalid_storage_topology", "无法确定目标卷");
    cursor = parent;
  }
  const stat = fs.statSync(cursor, { bigint: true });
  return process.platform === "win32" ? path.parse(cursor).root.toUpperCase() + ":" + stat.dev : String(stat.dev);
}

function requiredSpace(stageBytes, currentBytes) {
  return stageBytes + Math.max(64 * 1024 * 1024, Math.ceil((stageBytes + currentBytes) * 0.1));
}

class BackupTransactionManager {
  constructor(options) {
    this.controlDir = path.resolve(options.controlDir);
    this.transactionsDir = path.join(this.controlDir, "import-transactions");
    this.paths = options.paths;
    this.coordinator = options.coordinator || defaultCoordinator;
    this.now = options.now || (() => new Date());
    this.volumeIdProvider = options.volumeIdProvider;
    this.statfs = options.statfs || fs.statfsSync;
    this.fault = options.fault || (() => {});
    this.lockFactory = options.lockFactory || acquireVolumeLocks;
    this.lockOptions = {
      controlDir: this.controlDir,
      nativeBinding: options.nativeBinding,
      bindingPath: options.bindingPath,
    };
    this.externalVolumeLock = null;
    this.mutex = Promise.resolve();
  }

  serialize(work) {
    const next = this.mutex.then(work, work);
    this.mutex = next.catch(() => {});
    return next;
  }

  targets() {
    return canonicalTargets(this.paths, this.controlDir);
  }

  async withVolumeLocks(work) {
    if (this.externalVolumeLock) return work(this.externalVolumeLock);
    const resources = [...this.targets().map(target => target.live), this.controlDir];
    const session = this.lockFactory(resources, this.lockOptions);
    try {
      return await work(session);
    } finally {
      if (session && typeof session.release === "function") session.release();
    }
  }

  async withExternalVolumeLock(session, work) {
    if (!session || typeof session.release !== "function" || this.externalVolumeLock) {
      transactionFail("invalid_request", "外部 volume lock session 非法");
    }
    this.externalVolumeLock = session;
    try {
      return await work();
    } finally {
      this.externalVolumeLock = null;
    }
  }

  journalFile(id) {
    return path.join(this.transactionsDir, id, "transaction.json");
  }

  load(id) {
    if (!UUID_RE.test(id || "")) transactionFail("invalid_request", "事务 ID 必须是 UUID");
    const file = this.journalFile(id);
    if (!fs.existsSync(file)) transactionFail("transaction_not_found", "事务不存在");
    let journal;
    try { journal = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { transactionFail("manual_recovery_required", "事务 journal 损坏"); }
    return journal;
  }

  save(journal) {
    atomicJson(this.journalFile(journal.id), journal);
    this.fault("journal:" + journal.state, journal);
  }

  findByRequestId(requestId) {
    if (!fs.existsSync(this.transactionsDir)) return null;
    for (const name of fs.readdirSync(this.transactionsDir).sort()) {
      const file = this.journalFile(name);
      if (!fs.existsSync(file)) continue;
      const journal = this.load(name);
      if (journal.requestId === requestId) return journal;
    }
    return null;
  }

  pathsFor(target, id) {
    const basename = path.basename(target.live);
    const parent = path.dirname(target.live);
    return {
      stage: path.join(parent, basename + ".import-" + id + ".stage"),
      old: path.join(parent, basename + ".import-" + id + ".old"),
      sidecar: path.join(parent, basename + ".import-" + id + ".txn"),
      failedNew: path.join(parent, basename + ".import-" + id + ".failed-new"),
    };
  }

  writeSidecar(target, journal, stageManifest, oldManifest, state) {
    fs.mkdirSync(target.sidecar, { recursive: true });
    const descriptor = {
      version: 1,
      id: journal.id,
      kind: journal.kind,
      bundleSha256: journal.bundleSha256,
      targets: journal.targets.map(item => ({
        scope: item.scope,
        live: item.live,
        rootType: item.rootType,
        stage: item.stage,
        old: item.old,
      })).sort((a, b) => a.scope.localeCompare(b.scope)),
    };
    atomicJson(path.join(target.sidecar, "descriptor.json"), descriptor);
    if (stageManifest) atomicJson(path.join(target.sidecar, "stage.manifest.json"), stageManifest);
    if (oldManifest) atomicJson(path.join(target.sidecar, "old.manifest.json"), oldManifest);
    const marker = {
      version: 1,
      transactionId: journal.id,
      descriptorSha256: sha256(Buffer.from(JSON.stringify(descriptor))),
      scope: target.scope,
      live: target.live,
      stage: target.stage,
      old: target.old,
      hadLive: target.hadLive,
      stageManifestSha256: target.stageManifestSha256,
      oldManifestSha256: target.oldManifestSha256,
      state,
      updatedAt: this.now().toISOString(),
    };
    atomicJson(path.join(target.sidecar, "marker.json"), marker);
    target.markerSha256 = sha256(Buffer.from(JSON.stringify(marker)));
    target.state = state;
    return marker;
  }

  stageTarget(target, files, legacyContext = null) {
    if (fs.existsSync(target.stage) || fs.existsSync(target.old) || fs.existsSync(target.sidecar)) {
      transactionFail("transaction_busy", "事务路径已存在", { scope: target.scope });
    }
    fs.mkdirSync(path.dirname(target.live), { recursive: true });
    if (target.rootType === "file") {
      if (files.length !== 1 || files[0].path !== "DATA.md") transactionFail("invalid_bundle", "data scope 必须恰好包含 DATA.md");
      writeFileDurable(target.stage, files[0].bytes);
      syncDirectory(path.dirname(target.stage));
      return;
    }
    if (legacyContext && fs.existsSync(target.live)) copyDirectory(target.live, target.stage);
    else fs.mkdirSync(target.stage);
    if (legacyContext && target.scope === "entries") {
      for (const entry of fs.readdirSync(target.stage)) {
        if (legacyContext.entryUids.has(entry.toLowerCase())) continue;
        const entryRoot = path.join(target.stage, entry);
        const kind = lstatKind(entryRoot);
        if (kind === "directory") {
          for (const file of listDirectoryFiles(entryRoot)) {
            legacyContext.removed.push({
              path: "orphans/" + legacyContext.transactionId + "/removed-entries/" + entry + "/" + file.path,
              bytes: file.data,
            });
          }
        } else if (kind === "file") {
          legacyContext.removed.push({
            path: "orphans/" + legacyContext.transactionId + "/removed-entries/" + entry,
            bytes: readStableFile(entryRoot),
          });
        }
        removeOwned(entryRoot);
      }
    }
    const writes = target.scope === "orphans" && legacyContext ? [...files, ...legacyContext.removed] : files;
    for (const file of writes) {
      const prefix = target.scope + "/";
      const relative = file.path.slice(prefix.length);
      const destination = path.join(target.stage, ...relative.split("/"));
      if (!isInside(target.stage, destination) || destination === target.stage) transactionFail("invalid_path", "stage 路径越界");
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (fs.existsSync(destination)) fs.unlinkSync(destination);
      writeFileDurable(destination, file.bytes);
    }
    syncTree(target.stage);
  }

  async prepare(bundleInput, options = {}) {
    return this.serialize(() => {
      const parsed = parseBundle(bundleInput, { createdAt: this.now().toISOString() });
      const id = options.transactionId || crypto.randomUUID();
      const requestId = options.requestId || crypto.randomUUID();
      if (!UUID_RE.test(id) || !UUID_RE.test(requestId)) transactionFail("invalid_request", "事务 ID 必须是 UUID");
      return this.withVolumeLocks(() => this.coordinator.withMaintenance(async () => {
      const prior = this.findByRequestId(requestId);
      if (prior) {
        if (prior.bundleSha256 !== parsed.hash || (options.transactionId && prior.id !== id)) {
          transactionFail("idempotency_conflict", "requestId 已绑定其他备份事务");
        }
        if (prior.prepareResult && ["prepared", "committing", "committed", "completed"].includes(prior.state)) {
          return prior.prepareResult;
        }
        if (prior.state === "expired") transactionFail("transaction_expired", "重复备份事务已过期");
        transactionFail("transaction_busy", "重复备份事务尚未收敛", { state: prior.state });
      }
      if (fs.existsSync(this.journalFile(id))) transactionFail("transaction_busy", "事务 ID 已存在");
      const targets = this.targets().map(target => ({ ...target, ...this.pathsFor(target, id) }));
      const liveFingerprint = fingerprintTargets(targets);
      const now = this.now();
      const journal = {
        version: 1,
        id,
        requestId,
        kind: parsed.legacy ? "import-v1" : "import-v2",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + DAY_MS).toISOString(),
        state: "preparing",
        liveFingerprint,
        bundleSha256: parsed.hash,
        targets: targets.map(target => ({
          scope: target.scope,
          live: target.live,
          rootType: target.rootType,
          stage: target.stage,
          old: target.old,
          sidecar: target.sidecar,
          failedNew: target.failedNew,
          volumeId: volumeIdFor(target.live, this.volumeIdProvider),
          hadLive: null,
          oldManifestSha256: null,
          stageManifestSha256: null,
          markerSha256: null,
          state: "preparing",
        })),
        terminalResult: null,
        prepareResult: null,
      };
      fs.mkdirSync(path.dirname(this.journalFile(id)), { recursive: true });
      this.save(journal);
      try {
        const legacyContext = parsed.legacy ? {
          entryUids: parsed.entryUids,
          removed: [],
          transactionId: id,
        } : null;
        for (const target of journal.targets) {
          const files = parsed.decoded.filter(file => target.scope === "data" ? file.path === "DATA.md" : file.path.startsWith(target.scope + "/"));
          this.stageTarget(target, files, legacyContext);
          const stageManifest = targetManifest(target.stage, target.rootType, id, target.scope);
          target.stageManifestSha256 = manifestHash(stageManifest);
          this.writeSidecar(target, journal, stageManifest, null, "stage_ready");
          this.save(journal);
          this.fault("stage:" + target.scope, journal);
        }
        const byVolume = new Map();
        for (const target of journal.targets) {
          const stageManifest = JSON.parse(fs.readFileSync(path.join(target.sidecar, "stage.manifest.json"), "utf8"));
          const currentManifest = targetManifest(target.live, target.rootType, id, target.scope);
          const stageBytes = stageManifest.rootType === "file" ? stageManifest.bytes : stageManifest.totalBytes;
          const currentBytes = currentManifest.rootType === "file" ? currentManifest.bytes : currentManifest.totalBytes;
          if (volumeIdFor(target.stage, this.volumeIdProvider) !== target.volumeId || volumeIdFor(target.old, this.volumeIdProvider) !== target.volumeId) {
            transactionFail("invalid_storage_topology", "stage/old 与 live 不在同一卷", { scope: target.scope });
          }
          const aggregate = byVolume.get(target.volumeId) || { stageBytes: 0, currentBytes: 0, parent: path.dirname(target.live), scopes: [] };
          aggregate.stageBytes += stageBytes;
          aggregate.currentBytes += currentBytes;
          aggregate.scopes.push(target.scope);
          byVolume.set(target.volumeId, aggregate);
        }
        const requirements = [];
        for (const [volumeId, aggregate] of [...byVolume.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          const stats = this.statfs(aggregate.parent, { bigint: true });
          const available = Number(stats.bavail * stats.bsize);
          const needed = requiredSpace(aggregate.stageBytes, aggregate.currentBytes);
          requirements.push({ volumeId, stageBytes: aggregate.stageBytes, safetyMarginBytes: needed - aggregate.stageBytes, availableBytes: available });
          if (available < needed) transactionFail("insufficient_space", "目标卷空间不足", { scopes: aggregate.scopes, needed, available });
        }
        journal.state = "prepared";
        journal.prepareResult = {
          transactionId: id,
          liveFingerprint,
          bundleHash: parsed.hash,
          warnings: parsed.warnings,
          requiredByVolume: requirements,
          expiresAt: journal.expiresAt,
        };
        this.save(journal);
        return journal.prepareResult;
      } catch (error) {
        if (!error.simulatedCrash) {
          journal.state = "expired";
          journal.terminalResult = "prepare_failed";
          try { this.save(journal); } catch (_) {}
        }
        throw error;
      }
      }));
    });
  }

  async commit(id) {
    return this.serialize(() => this.withVolumeLocks(() => this.coordinator.withMaintenance(async () => {
      const journal = this.load(id);
      if (journal.state === "completed") return { committed: journal.terminalResult === "committed", rolledBack: journal.terminalResult === "rolled_back" };
      if (journal.state === "cancelled") transactionFail("transaction_busy", "事务已取消");
      if (journal.state === "expired" || Date.parse(journal.expiresAt) <= this.now().getTime()) {
        if (journal.state === "prepared") await this.expire(journal);
        transactionFail("transaction_expired", "事务已过期");
      }
      if (journal.state !== "prepared") transactionFail("transaction_busy", "事务当前不可提交", { state: journal.state });
      if (fingerprintTargets(journal.targets) !== journal.liveFingerprint) transactionFail("state_changed", "prepare 后活动数据发生变化");
      for (const target of journal.targets) {
        if (fs.existsSync(target.old)) transactionFail("transaction_busy", "old 路径碰撞", { scope: target.scope });
        let stageManifest;
        try { stageManifest = JSON.parse(fs.readFileSync(path.join(target.sidecar, "stage.manifest.json"), "utf8")); } catch (_) {
          transactionFail("manual_recovery_required", "stage manifest 损坏", { scope: target.scope });
        }
        if (manifestHash(stageManifest) !== target.stageManifestSha256 || !manifestMatches(target.stage, stageManifest)) {
          transactionFail("state_changed", "prepared stage 已变化", { scope: target.scope });
        }
        const oldManifest = targetManifest(target.live, target.rootType, id, target.scope);
        target.hadLive = oldManifest.existed;
        target.oldManifestSha256 = manifestHash(oldManifest);
        this.writeSidecar(target, journal, stageManifest, oldManifest, "stage_ready");
        this.save(journal);
      }
      try {
        journal.state = "committing";
        this.save(journal);
        for (const target of journal.targets) {
          const stageManifest = JSON.parse(fs.readFileSync(path.join(target.sidecar, "stage.manifest.json"), "utf8"));
          const oldManifest = JSON.parse(fs.readFileSync(path.join(target.sidecar, "old.manifest.json"), "utf8"));
          if (target.hadLive) {
            renameWithRetry(target.live, target.old);
            syncDirectory(path.dirname(target.live));
          }
          this.writeSidecar(target, journal, stageManifest, oldManifest, "old_ready");
          this.save(journal);
          this.fault("old_ready:" + target.scope, journal);
          renameWithRetry(target.stage, target.live);
          syncDirectory(path.dirname(target.live));
          this.writeSidecar(target, journal, stageManifest, oldManifest, "live_ready");
          this.save(journal);
          this.fault("live_ready:" + target.scope, journal);
          if (!manifestMatches(target.live, stageManifest)) throw new Error("post-write verification mismatch");
          this.writeSidecar(target, journal, stageManifest, oldManifest, "verified");
          this.save(journal);
        }
        journal.state = "committed";
        journal.terminalResult = "committed";
        this.save(journal);
        this.fault("committed", journal);
        journal.state = "completed";
        this.save(journal);
        return { committed: true, rolledBack: false };
      } catch (error) {
        if (error.simulatedCrash) throw error;
        journal.state = "rolling_back";
        this.save(journal);
        try {
          this.rollback(journal);
          journal.state = "rolled_back";
          journal.terminalResult = "rolled_back";
          this.save(journal);
          journal.state = "completed";
          this.save(journal);
        } catch (rollbackError) {
          journal.state = "manual_recovery";
          journal.terminalResult = null;
          this.save(journal);
          throw new TransactionError("manual_recovery_required", "提交失败且无法确定性回滚", { cause: rollbackError.message });
        }
        throw new TransactionError("commit_failed_rolled_back", "提交失败，已恢复旧态", { cause: error.message });
      }
    })));
  }

  rollback(journal) {
    for (const target of [...journal.targets].reverse()) {
      const stageManifest = JSON.parse(fs.readFileSync(path.join(target.sidecar, "stage.manifest.json"), "utf8"));
      const oldManifest = JSON.parse(fs.readFileSync(path.join(target.sidecar, "old.manifest.json"), "utf8"));
      this.writeSidecar(target, journal, stageManifest, oldManifest, "rollback_ready");
      this.save(journal);
      if (target.hadLive) {
        if (manifestMatches(target.live, oldManifest) && !fs.existsSync(target.old)) {
          // The old generation is already restored.
        } else {
          if (!manifestMatches(target.old, oldManifest)) transactionFail("manual_recovery_required", "old generation 无法验证", { scope: target.scope });
          if (fs.existsSync(target.live)) {
            if (fs.existsSync(target.failedNew)) transactionFail("manual_recovery_required", "failed-new 路径碰撞", { scope: target.scope });
            renameWithRetry(target.live, target.failedNew);
          }
          renameWithRetry(target.old, target.live);
          syncDirectory(path.dirname(target.live));
        }
        this.writeSidecar(target, journal, stageManifest, oldManifest, "old_restored");
        this.save(journal);
        if (!manifestMatches(target.live, oldManifest)) transactionFail("manual_recovery_required", "恢复后的旧态校验失败", { scope: target.scope });
      } else {
        if (fs.existsSync(target.live)) {
          if (fs.existsSync(target.failedNew)) transactionFail("manual_recovery_required", "failed-new 路径碰撞", { scope: target.scope });
          renameWithRetry(target.live, target.failedNew);
          syncDirectory(path.dirname(target.live));
        }
        if (fs.existsSync(target.old)) transactionFail("manual_recovery_required", "原本不存在的目标出现 old", { scope: target.scope });
      }
      this.writeSidecar(target, journal, stageManifest, oldManifest, "old_verified");
      this.save(journal);
      this.fault("old_verified:" + target.scope, journal);
    }
  }

  async cancel(id) {
    return this.serialize(() => this.withVolumeLocks(() => this.coordinator.withMaintenance(async () => {
      const journal = this.load(id);
      if (journal.state === "cancelled") return { cancelled: true };
      if (journal.state === "expired") transactionFail("transaction_expired", "事务已过期");
      if (journal.state !== "prepared") transactionFail("transaction_busy", "事务当前不可取消", { state: journal.state });
      for (const target of journal.targets) removeOwned(target.stage);
      journal.state = "cancelled";
      journal.terminalResult = "cancelled";
      this.save(journal);
      return { cancelled: true };
    })));
  }

  async expire(journal) {
    for (const target of journal.targets) removeOwned(target.stage);
    journal.state = "expired";
    journal.terminalResult = "expired";
    this.save(journal);
  }

  async recover(id) {
    return this.serialize(() => this.withVolumeLocks(() => this.coordinator.withMaintenance(async () => {
      const journal = this.load(id);
      if (["completed", "cancelled", "expired"].includes(journal.state)) return { state: journal.state, terminalResult: journal.terminalResult };
      if (journal.state === "prepared") {
        if (Date.parse(journal.expiresAt) <= this.now().getTime()) await this.expire(journal);
        return { state: journal.state, terminalResult: journal.terminalResult };
      }
      if (journal.state === "preparing") {
        await this.expire(journal);
        return { state: journal.state, terminalResult: journal.terminalResult };
      }
      if (journal.state === "committed") {
        const valid = journal.targets.every(target => {
          const manifest = JSON.parse(fs.readFileSync(path.join(target.sidecar, "stage.manifest.json"), "utf8"));
          return manifestMatches(target.live, manifest);
        });
        if (valid) {
          journal.state = "completed";
          this.save(journal);
          return { state: "completed", terminalResult: "committed" };
        }
      }
      if (["committing", "committed", "rolling_back", "rolled_back", "manual_recovery"].includes(journal.state)) {
        journal.state = "rolling_back";
        this.save(journal);
        try {
          this.rollback(journal);
          journal.state = "rolled_back";
          journal.terminalResult = "rolled_back";
          this.save(journal);
          journal.state = "completed";
          this.save(journal);
          return { state: "completed", terminalResult: "rolled_back" };
        } catch (error) {
          journal.state = "manual_recovery";
          this.save(journal);
          transactionFail("manual_recovery_required", "事务无法自动收敛", { cause: error.message });
        }
      }
      transactionFail("manual_recovery_required", "未知事务状态", { state: journal.state });
    })));
  }

  async restoreOld(id) {
    return this.serialize(() => this.withVolumeLocks(() => this.coordinator.withMaintenance(async () => {
      const journal = this.load(id);
      const alreadyRestored = journal.state === "completed" && journal.terminalResult === "restored_old";
      if (alreadyRestored) return { committed: false, rolledBack: true, modified: false, terminalResult: "restored_old" };
      if (!["committing", "committed", "rolling_back", "rolled_back", "manual_recovery", "completed"].includes(journal.state)) {
        transactionFail("transaction_busy", "事务当前没有可恢复的 verified old", { state: journal.state });
      }
      journal.state = "rolling_back";
      this.save(journal);
      try {
        this.rollback(journal);
      } catch (error) {
        journal.state = "manual_recovery";
        journal.terminalResult = null;
        this.save(journal);
        transactionFail("manual_recovery_required", "verified old 恢复失败", { cause: error.message });
      }
      journal.state = "completed";
      journal.terminalResult = "restored_old";
      this.save(journal);
      return { committed: false, rolledBack: true, modified: true, terminalResult: "restored_old" };
    })));
  }

  inspect(id) {
    const journal = this.load(id);
    return {
      id: journal.id,
      state: journal.state,
      terminalResult: journal.terminalResult,
      targets: journal.targets.map(target => {
        const read = name => {
          const manifestFile = path.join(target.sidecar, name + ".manifest.json");
          if (!fs.existsSync(manifestFile)) return { present: fs.existsSync(target[name]), valid: false, manifestHash: null };
          const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
          return { present: fs.existsSync(target[name]), valid: manifestMatches(target[name], manifest), manifestHash: manifestHash(manifest) };
        };
        return { scope: target.scope, live: read(target.state === "verified" ? "stage" : "old"), stage: read("stage"), old: read("old") };
      }),
    };
  }
}

module.exports = {
  BackupTransactionManager,
  DAY_MS,
  RENAME_DELAYS,
  TransactionError,
  canonicalTargets,
  fingerprintTargets,
  manifestHash,
  manifestMatches,
  readStableFile,
  renameWithRetry,
  requiredSpace,
  targetManifest,
  volumeIdFor,
};
