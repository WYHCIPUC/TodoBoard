"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { isCanonicalUtc, sha256 } = require("./backup-format");
const { createArchiveService } = require("./archive");
const { readCanonicalContent } = require("./archive-content");
const { validateArchiveDirectory } = require("./archive-integrity");
const { assessCandidate } = require("./archive-quality");
const migrate = require("./migrate");
const schema = require("./schema");
const store = require("./store");

/*
 * 迁移合同版本，不是产品版本。
 * 它同时决定 app-migrations marker 文件名与升级快照 manifest 的 appVersion；
 * 旧快照的校验要求完全相等，因此这里必须冻结，不能从 package.json 派生。
 * 只有新增/变更迁移步骤并同时提供旧快照兼容路径时才可提升。
 */
const MIGRATION_CONTRACT_VERSION = "2.2.0";
/* 兼容既有调用方；内部一律使用 MIGRATION_CONTRACT_VERSION。 */
const APP_VERSION = MIGRATION_CONTRACT_VERSION;
const STEP_NAMES = Object.freeze(["dataSchema", "manualDrafts", "canonicalContent", "lifecycle"]);
const SCOPES = Object.freeze(["data", "entries", "brainstorms", "trash", "orphans"]);

class UpgradeError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "UpgradeError";
    this.code = code;
    this.details = details || null;
  }
}

function utcName(value) { return value.replace(/[:.]/g, "-"); }
function compareUtf8(left, right) { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }

function resolvePaths(options = {}) {
  const dataFile = path.resolve(options.dataFile || store.README);
  const controlDir = path.resolve(options.controlDir || path.join(path.dirname(dataFile), ".linggan"));
  return {
    dataFile,
    entriesDir: path.resolve(options.entriesDir || process.env.ENTRIES_DIR || path.join(path.dirname(dataFile), "docs", "entries")),
    brainstormsDir: path.resolve(options.brainstormsDir || process.env.BRAINSTORM_DIR || path.join(controlDir, "brainstorms")),
    trashDir: path.resolve(options.trashDir || process.env.TRASH_DIR || path.join(controlDir, "trash")),
    orphansDir: path.resolve(options.orphansDir || process.env.RECOVERED_ORPHANS_DIR || path.join(controlDir, "recovered-orphans")),
    queueFile: path.resolve(options.queueFile || path.join(controlDir, "archive-jobs.json")),
    controlDir,
    snapshotsDir: path.resolve(options.snapshotsDir || path.join(controlDir, "upgrade-snapshots")),
    markerFile: path.resolve(options.markerFile || path.join(controlDir, "app-migrations", MIGRATION_CONTRACT_VERSION + ".json")),
  };
}

function targetInventory(scope, target) {
  if (scope === "data") {
    if (!fs.existsSync(target)) return { scope, rootType: "file", existed: false, bytes: 0, sha256: null };
    const stat = fs.lstatSync(target);
    if (!stat.isFile()) throw new UpgradeError("invalid_storage_topology", "DATA 不是普通文件");
    const bytes = fs.readFileSync(target);
    return { scope, rootType: "file", existed: true, bytes: bytes.length, sha256: sha256(bytes) };
  }
  const inventory = migrate.inventoryDirectory(target);
  return {
    scope,
    rootType: "directory",
    existed: fs.existsSync(target),
    fileCount: inventory.files.length,
    totalBytes: inventory.files.reduce((sum, item) => sum + item.bytes.length, 0),
    files: inventory.files.map(item => ({ path: item.relative.replace(/\\/g, "/"), bytes: item.bytes.length, sha256: sha256(item.bytes) })).sort((a, b) => compareUtf8(a.path, b.path)),
  };
}

function canonicalSnapshotManifest(value) {
  return JSON.stringify({
    version: value.version,
    kind: value.kind,
    restorable: value.restorable,
    appVersion: value.appVersion,
    createdAt: value.createdAt,
    targets: value.targets.map(target => target.rootType === "file" ? {
      scope: target.scope, rootType: "file", existed: target.existed, bytes: target.bytes, sha256: target.sha256,
    } : {
      scope: target.scope, rootType: "directory", existed: target.existed, fileCount: target.fileCount, totalBytes: target.totalBytes,
      files: target.files.map(file => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
    }),
    runtime: { files: value.runtime.files.map(file => ({ name: file.name, existed: file.existed, bytes: file.bytes, sha256: file.sha256 })) },
  });
}

function snapshotChanges(snapshotDir, paths, manifest) {
  const changes = [];
  if (manifest.targets[0].existed) changes.push({ file: path.join(snapshotDir, "targets", "data", "DATA.md"), bytes: fs.readFileSync(paths.dataFile) });
  const sourceByScope = { entries: paths.entriesDir, brainstorms: paths.brainstormsDir, trash: paths.trashDir, orphans: paths.orphansDir };
  for (const target of manifest.targets.filter(item => item.rootType === "directory")) {
    for (const file of target.files) changes.push({ file: path.join(snapshotDir, "targets", target.scope, ...file.path.split("/")), bytes: fs.readFileSync(path.join(sourceByScope[target.scope], ...file.path.split("/"))) });
  }
  for (const item of manifest.runtime.files) if (item.existed) {
    const source = item.name === "archive-jobs.json" ? paths.queueFile : paths.queueFile + ".previous";
    changes.push({ file: path.join(snapshotDir, "runtime", item.name), bytes: fs.readFileSync(source) });
  }
  changes.push({ file: path.join(snapshotDir, "manifest.json"), bytes: Buffer.from(canonicalSnapshotManifest(manifest)) });
  return changes;
}

function createUpgradeSnapshot(options = {}) {
  const paths = resolvePaths(options);
  const createdAt = new Date(options.now === undefined ? Date.now() : options.now).toISOString();
  const kind = options.kind || "pre_upgrade_full";
  const restorable = kind === "pre_upgrade_full";
  const targets = SCOPES.map(scope => targetInventory(scope, scope === "data" ? paths.dataFile : paths[scope + "Dir"]));
  const runtimeFiles = ["archive-jobs.json", "archive-jobs.json.previous"].map(name => {
    const file = name.endsWith(".previous") ? paths.queueFile + ".previous" : paths.queueFile;
    if (!fs.existsSync(file)) return { name, existed: false, bytes: 0, sha256: null };
    const bytes = fs.readFileSync(file);
    return { name, existed: true, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const manifest = { version: 1, kind, restorable, appVersion: MIGRATION_CONTRACT_VERSION, createdAt, targets, runtime: { files: runtimeFiles } };
  const prefix = options.namePrefix || (kind === "pre_upgrade_full" ? "pre-" + MIGRATION_CONTRACT_VERSION + "-" : "post-downgrade-");
  let name = prefix + utcName(createdAt);
  let index = 1;
  while (fs.existsSync(path.join(paths.snapshotsDir, name))) name = prefix + utcName(createdAt) + "-" + index++;
  const snapshotDir = path.join(paths.snapshotsDir, name);
  store.trustedWriteSet(snapshotChanges(snapshotDir, paths, manifest), { action: "upgrade.snapshot", controlDir: paths.controlDir, coordinator: options.coordinator, leaseToken: options.leaseToken });
  const verified = verifyUpgradeSnapshot(snapshotDir, { paths });
  if (!verified.valid) throw new UpgradeError("manual_recovery_required", "升级快照写后验证失败", verified);
  return { name, path: snapshotDir, manifest, manifestSha256: verified.manifestSha256 };
}

function verifyUpgradeSnapshot(snapshotDir, options = {}) {
  const manifestFile = path.join(path.resolve(snapshotDir), "manifest.json");
  try {
    const bytes = fs.readFileSync(manifestFile);
    const manifest = JSON.parse(bytes.toString("utf8"));
    if (canonicalSnapshotManifest(manifest) !== bytes.toString("utf8") || manifest.version !== 1 || manifest.appVersion !== MIGRATION_CONTRACT_VERSION || !isCanonicalUtc(manifest.createdAt)) return { valid: false, reason: "invalid_manifest" };
    if (manifest.kind === "pre_upgrade_full" && (!manifest.restorable || manifest.targets.map(item => item.scope).join("|") !== SCOPES.join("|"))) return { valid: false, reason: "snapshot_not_restorable" };
    for (const target of manifest.targets) {
      if (!target.existed) continue;
      if (target.rootType === "file") {
        const file = path.join(snapshotDir, "targets", "data", "DATA.md");
        const value = fs.readFileSync(file);
        if (value.length !== target.bytes || sha256(value) !== target.sha256) return { valid: false, reason: "checksum_mismatch" };
      } else for (const record of target.files) {
        const value = fs.readFileSync(path.join(snapshotDir, "targets", target.scope, ...record.path.split("/")));
        if (value.length !== record.bytes || sha256(value) !== record.sha256) return { valid: false, reason: "checksum_mismatch" };
      }
    }
    for (const record of manifest.runtime.files) if (record.existed) {
      const value = fs.readFileSync(path.join(snapshotDir, "runtime", record.name));
      if (value.length !== record.bytes || sha256(value) !== record.sha256) return { valid: false, reason: "checksum_mismatch" };
    }
    return { valid: true, manifest, manifestSha256: sha256(bytes) };
  } catch (error) { return { valid: false, reason: "unreadable", error: error.message }; }
}

function freshMarker() {
  return {
    version: 1, appVersion: MIGRATION_CONTRACT_VERSION, freshInstall: true, snapshotPath: null, snapshotManifestSha256: null,
    steps: Object.fromEntries(STEP_NAMES.map(name => [name, "pending"])),
    compatibilitySweep: { lastRunAt: null, resultHash: null }, completedAt: null,
  };
}

function validateMarker(marker, paths) {
  if (!marker || marker.version !== 1 || marker.appVersion !== MIGRATION_CONTRACT_VERSION || typeof marker.freshInstall !== "boolean") throw new UpgradeError("manual_recovery_required", "应用迁移 marker 损坏");
  if (Object.keys(marker.steps || {}).join("|") !== STEP_NAMES.join("|") || STEP_NAMES.some(name => !["pending", "completed"].includes(marker.steps[name]))) throw new UpgradeError("manual_recovery_required", "应用迁移步骤非法");
  let pendingSeen = false;
  for (const name of STEP_NAMES) {
    if (marker.steps[name] === "pending") pendingSeen = true;
    else if (pendingSeen) throw new UpgradeError("manual_recovery_required", "应用迁移步骤倒退");
  }
  if (!marker.freshInstall) {
    if (!marker.snapshotPath || !marker.snapshotManifestSha256) throw new UpgradeError("manual_recovery_required", "非 fresh marker 缺少升级快照");
    const checked = verifyUpgradeSnapshot(path.resolve(paths.snapshotsDir, marker.snapshotPath));
    if (!checked.valid || checked.manifestSha256 !== marker.snapshotManifestSha256) throw new UpgradeError("manual_recovery_required", "marker 引用的升级快照无效");
  }
  return marker;
}

function saveMarker(paths, marker, options) {
  store.trustedWriteFile(paths.markerFile, Buffer.from(JSON.stringify(marker)), { action: "upgrade.marker", controlDir: paths.controlDir, coordinator: options.coordinator, leaseToken: options.leaseToken });
}

function extractManualDrafts(paths, options) {
  if (!fs.existsSync(paths.queueFile)) return { extracted: 0, hash: sha256(Buffer.from("none")) };
  let queue;
  try { queue = JSON.parse(fs.readFileSync(paths.queueFile, "utf8")); } catch (error) { throw new UpgradeError("manual_recovery_required", "旧归档队列不可读", { cause: error.message }); }
  const jobs = Array.isArray(queue) ? queue : queue.jobs;
  if (!Array.isArray(jobs)) throw new UpgradeError("manual_recovery_required", "旧归档队列 schema 非法");
  const data = schema.scanEntries(fs.readFileSync(paths.dataFile, "utf8"));
  const known = new Map(data.flatMap(entry => [[entry.id, entry], [entry.uid, entry]]));
  let extracted = 0;
  for (const job of jobs) if (job && typeof job.manualContent === "string" && job.manualContent.trim()) {
    const entry = known.get(job.uid) || known.get(job.id);
    if (entry?.uid) {
      const result = require("./archive-content").writeManualDraft({ entriesDir: paths.entriesDir, runtimeDir: paths.controlDir, uid: entry.uid, content: job.manualContent, origin: "legacy_recovery", coordinator: options.coordinator, leaseToken: options.leaseToken });
      job.manualDraftHash = result.draftHash;
    } else {
      const digest = sha256(Buffer.from(job.manualContent));
      const orphan = path.join(paths.orphansDir, "legacy-manual-drafts", digest + ".md");
      store.trustedWriteFile(orphan, Buffer.from(job.manualContent), { action: "upgrade.orphan-draft", controlDir: paths.controlDir, coordinator: options.coordinator, leaseToken: options.leaseToken });
    }
    delete job.manualContent;
    extracted++;
  }
  const normalized = Array.isArray(queue) ? queue : { version: 1, jobs };
  if (extracted) store.trustedWriteFile(paths.queueFile, Buffer.from(JSON.stringify(normalized, null, 2) + "\n"), { action: "upgrade.queue-drafts", controlDir: paths.controlDir, coordinator: options.coordinator, leaseToken: options.leaseToken });
  return { extracted, hash: sha256(Buffer.from(JSON.stringify(normalized))) };
}

async function migrateCanonicalContent(paths, options) {
  const data = schema.validateData(fs.readFileSync(paths.dataFile, "utf8")).entries;
  const service = options.archiveService || createArchiveService({ paths: { entriesDir: paths.entriesDir, runtimeDir: paths.controlDir }, useQueue: false, coordinator: options.coordinator });
  let converted = 0;
  let conflicts = 0;
  for (const entry of data) {
    const dir = path.join(paths.entriesDir, entry.uid);
    const rootFile = path.join(dir, "content.md");
    const archiveDir = path.join(dir, "archive");
    let active = fs.existsSync(path.join(archiveDir, "manifest.json")) ? validateArchiveDirectory(archiveDir, { uid: entry.uid }) : null;
    if (active?.valid) await service.protectExisting(entry.uid);
    else if (fs.existsSync(path.join(archiveDir, "content.md"))) {
      const legacy = fs.readFileSync(path.join(archiveDir, "content.md"), "utf8");
      const result = await service.archiveTask({ id: entry.id, uid: entry.uid, url: entry.url, entry, migrationContent: legacy });
      if (!result.snapshotId) throw new UpgradeError("manual_recovery_required", "旧活动正文无法 canonicalize", { uid: entry.uid, reason: result.reasonCode });
      converted++;
      active = validateArchiveDirectory(archiveDir, { uid: entry.uid });
    }
    if (!fs.existsSync(rootFile)) continue;
    const rootBytes = fs.readFileSync(rootFile);
    const rootText = rootBytes.toString("utf8");
    const activeText = active?.valid ? readCanonicalContent(paths.entriesDir, entry.uid) : null;
    if (!activeText) {
      const assessed = assessCandidate({ content: rootText, title: entry.title, authority: "legacy_unknown", captureState: "succeeded" });
      if (assessed.usable) {
        const result = await service.archiveTask({ id: entry.id, uid: entry.uid, url: entry.url, entry, migrationContent: rootText });
        if (!result.snapshotId) throw new UpgradeError("manual_recovery_required", "根级正文迁移失败", { uid: entry.uid });
        converted++;
      } else {
        const digest = sha256(rootBytes).slice(0, 12);
        store.trustedWriteFile(path.join(dir, "attachments", "legacy-content-" + digest + ".md"), rootBytes, { action: "upgrade.legacy-content", controlDir: paths.controlDir, coordinator: options.coordinator, leaseToken: options.leaseToken });
      }
    } else if (!Buffer.from(activeText).equals(rootBytes)) {
      const digest = sha256(rootBytes).slice(0, 12);
      store.trustedWriteFile(path.join(dir, "attachments", "legacy-content-" + digest + ".md"), rootBytes, { action: "upgrade.legacy-conflict", controlDir: paths.controlDir, coordinator: options.coordinator, leaseToken: options.leaseToken });
      await service.addMigrationWarning(entry.uid, "legacy_content_conflict");
      conflicts++;
    }
    store.trustedWriteFile(rootFile, null, { action: "upgrade.root-content-remove", controlDir: paths.controlDir, coordinator: options.coordinator, leaseToken: options.leaseToken });
  }
  return { converted, conflicts };
}

function protectedState(paths, entry) {
  const currentFile = path.join(paths.entriesDir, entry.uid, "protected-generations", "current.json");
  if (!fs.existsSync(currentFile)) return { current: null, valid: false };
  try {
    const current = JSON.parse(fs.readFileSync(currentFile, "utf8"));
    const checked = validateArchiveDirectory(path.join(paths.entriesDir, entry.uid, "protected-generations", current.snapshotId, "archive"), { uid: entry.uid, snapshotId: current.snapshotId });
    return { current, valid: checked.valid && checked.manifestHash === current.manifestSha256, checked };
  } catch (_) { return { current: null, valid: false }; }
}

async function compatibilitySweep(paths, options) {
  const entries = schema.validateData(fs.readFileSync(paths.dataFile, "utf8")).entries;
  let queueManual = false;
  try {
    const queue = JSON.parse(fs.readFileSync(paths.queueFile, "utf8"));
    const jobs = Array.isArray(queue) ? queue : queue.jobs;
    queueManual = Array.isArray(jobs) && jobs.some(job => typeof job?.manualContent === "string" && job.manualContent.trim());
  } catch (_) {}
  const states = entries.map(entry => {
    const dir = path.join(paths.entriesDir, entry.uid);
    const root = fs.existsSync(path.join(dir, "content.md"));
    const active = validateArchiveDirectory(path.join(dir, "archive"), { uid: entry.uid });
    const protectedGeneration = protectedState(paths, entry);
    const mismatch = active.valid && protectedGeneration.valid && (active.snapshotId !== protectedGeneration.current.snapshotId || active.manifestHash !== protectedGeneration.current.manifestSha256);
    const hasArchiveEvidence = fs.existsSync(path.join(dir, "archive")) || fs.existsSync(path.join(dir, "protected-generations"));
    return { entry, dir, root, active, protectedGeneration, mismatch, hasArchiveEvidence };
  });
  if (!queueManual && !states.some(item => item.root || item.mismatch || item.active.valid !== item.protectedGeneration.valid || item.hasArchiveEvidence && !item.active.valid && !item.protectedGeneration.valid)) {
    return { changed: false, resultHash: sha256(Buffer.from("healthy")) };
  }
  const snapshot = createUpgradeSnapshot({ ...options, ...paths, kind: "post_downgrade_incremental" });
  const service = options.archiveService || createArchiveService({ paths: { entriesDir: paths.entriesDir, runtimeDir: paths.controlDir }, useQueue: false, coordinator: options.coordinator });
  if (queueManual) extractManualDrafts(paths, options);
  for (const item of states) {
    if (item.active.valid && !item.protectedGeneration.valid) {
      await service.addMigrationWarning(item.entry.uid, "downgrade_archive_rewritten");
      continue;
    }
    if ((!item.active.valid || item.mismatch) && item.protectedGeneration.valid) {
      if (fs.existsSync(path.join(item.dir, "archive"))) {
        const inventory = migrate.inventoryDirectory(path.join(item.dir, "archive"));
        const inventoryHash = sha256(Buffer.from(JSON.stringify(inventory.files.map(file => [file.relative.replace(/\\/g, "/"), sha256(file.bytes)]))));
        const changes = inventory.files.map(file => ({ file: path.join(paths.orphansDir, "downgrade-candidate", item.entry.uid, inventoryHash, file.relative), bytes: file.bytes }));
        const content = inventory.files.find(file => file.relative.replace(/\\/g, "/") === "content.md");
        if (content) changes.push({ file: path.join(item.dir, "attachments", "post-downgrade-content-" + sha256(content.bytes).slice(0, 12) + ".md"), bytes: content.bytes });
        if (changes.length) store.trustedWriteSet(changes, { action: "upgrade.downgrade-preserve", controlDir: paths.controlDir, coordinator: options.coordinator, leaseToken: options.leaseToken });
      }
      await service.restoreProtected(item.entry.uid, item.protectedGeneration.current);
    } else if (!item.active.valid && !item.protectedGeneration.valid && fs.existsSync(item.dir)) {
      if (item.hasArchiveEvidence) throw new UpgradeError("manual_recovery_required", "活动归档与保护代均不可验证", { uid: item.entry.uid });
    }
  }
  const canonical = await migrateCanonicalContent(paths, options);
  const result = { changed: true, snapshotName: snapshot.name, canonical };
  result.resultHash = sha256(Buffer.from(JSON.stringify(result)));
  return result;
}

async function runUpgrade(options = {}) {
  const paths = resolvePaths(options);
  let marker;
  if (fs.existsSync(paths.markerFile)) marker = validateMarker(JSON.parse(fs.readFileSync(paths.markerFile, "utf8")), paths);
  else if (options.freshInstall) {
    marker = freshMarker();
    saveMarker(paths, marker, options);
  } else {
    const snapshot = createUpgradeSnapshot({ ...options, ...paths, kind: "pre_upgrade_full" });
    marker = freshMarker();
    marker.freshInstall = false;
    marker.snapshotPath = snapshot.name;
    marker.snapshotManifestSha256 = snapshot.manifestSha256;
    saveMarker(paths, marker, options);
  }
  const results = {};
  if (marker.completedAt && STEP_NAMES.every(name => marker.steps[name] === "completed")) {
    const sweep = await compatibilitySweep(paths, options);
    marker.compatibilitySweep.lastRunAt = new Date(options.now === undefined ? Date.now() : options.now).toISOString();
    marker.compatibilitySweep.resultHash = sweep.resultHash;
    saveMarker(paths, marker, options);
    return { state: "completed", marker, results: { compatibilitySweep: sweep } };
  }
  for (const step of STEP_NAMES) {
    if (marker.steps[step] === "completed") continue;
    if (step === "dataSchema") results.dataSchema = migrate.migrateData({ dataFile: paths.dataFile, entriesDir: paths.entriesDir, uidFactory: options.uidFactory, now: options.now === undefined ? undefined : new Date(options.now) });
    else if (step === "manualDrafts") results.manualDrafts = extractManualDrafts(paths, options);
    else if (step === "canonicalContent") results.canonicalContent = await migrateCanonicalContent(paths, options);
    else schema.validateData(fs.readFileSync(paths.dataFile, "utf8"));
    marker.steps[step] = "completed";
    saveMarker(paths, marker, options);
    options.fault?.("upgrade:" + step, marker);
  }
  marker.completedAt = marker.completedAt || new Date(options.now === undefined ? Date.now() : options.now).toISOString();
  marker.compatibilitySweep.lastRunAt = marker.completedAt;
  const sweep = await compatibilitySweep(paths, options);
  results.compatibilitySweep = sweep;
  marker.compatibilitySweep.resultHash = sweep.resultHash;
  saveMarker(paths, marker, options);
  return { state: "completed", marker, results };
}

function listUpgradeSnapshots(options = {}) {
  const paths = resolvePaths(options);
  if (!fs.existsSync(paths.snapshotsDir)) return [];
  return fs.readdirSync(paths.snapshotsDir, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => {
    const checked = verifyUpgradeSnapshot(path.join(paths.snapshotsDir, item.name));
    return { name: item.name, kind: checked.manifest?.kind || null, restorable: Boolean(checked.valid && checked.manifest.restorable), manifestSha256: checked.manifestSha256 || null, createdAt: checked.manifest?.createdAt || null, valid: checked.valid };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function prepareSnapshotRestore(name, expectedHash, options = {}) {
  const paths = resolvePaths(options);
  if (!/^[0-9A-Za-z._-]+$/.test(name || "")) throw new UpgradeError("snapshot_not_found", "升级快照名称非法");
  const checked = verifyUpgradeSnapshot(path.join(paths.snapshotsDir, name));
  if (!checked.valid || checked.manifest.kind !== "pre_upgrade_full" || !checked.manifest.restorable || checked.manifestSha256 !== expectedHash) throw new UpgradeError("snapshot_not_restorable", "升级快照不可恢复");
  return { recoveryPrepareId: crypto.randomUUID(), snapshotName: name, snapshotManifestSha256: checked.manifestSha256, summary: { targets: checked.manifest.targets.length, runtimeFiles: checked.manifest.runtime.files.length } };
}

async function remigrateUpgrade(options = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(options.recoveryPrepareId || "")) throw new UpgradeError("invalid_request", "remigrate 需要 recoveryPrepareId");
  const paths = resolvePaths(options);
  const snapshot = createUpgradeSnapshot({
    ...options,
    ...paths,
    kind: "pre_upgrade_full",
    namePrefix: "pre-remigrate-" + MIGRATION_CONTRACT_VERSION + "-" + options.recoveryPrepareId + "-",
  });
  const marker = freshMarker();
  marker.freshInstall = false;
  marker.snapshotPath = snapshot.name;
  marker.snapshotManifestSha256 = snapshot.manifestSha256;
  saveMarker(paths, marker, options);
  const result = await runUpgrade({ ...options, ...paths });
  return { ...result, remigrate: { sourceState: options.sourceState || "ready_for_2_1", snapshotName: snapshot.name, snapshotManifestSha256: snapshot.manifestSha256, state: "verified" } };
}

module.exports = {
  APP_VERSION,
  MIGRATION_CONTRACT_VERSION,
  SCOPES,
  STEP_NAMES,
  UpgradeError,
  canonicalSnapshotManifest,
  createUpgradeSnapshot,
  extractManualDrafts,
  freshMarker,
  listUpgradeSnapshots,
  migrateCanonicalContent,
  compatibilitySweep,
  prepareSnapshotRestore,
  remigrateUpgrade,
  resolvePaths,
  runUpgrade,
  targetInventory,
  validateMarker,
  verifyUpgradeSnapshot,
};
