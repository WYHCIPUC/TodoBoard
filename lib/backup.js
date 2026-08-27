"use strict";

const fs = require("fs");
const path = require("path");
const {
  BackupError,
  FORMAT,
  FORMAT_VERSION,
  LIMITS,
  SCOPES,
  createBundle,
  parseBundle,
  serializeBundle,
  sha256,
} = require("./backup-format");
const { BackupTransactionManager, readStableFile } = require("./backup-transaction");
const { defaultCoordinator } = require("./maintenance");

const MAX_BUNDLE_BYTES = LIMITS.decodedBundle;
const ALLOWED_ENTRY_FILE = /^(?:[^/]+\/(?:notes\.md|screenshots\/[^/]+\.(?:png|jpe?g)|archive\/(?:manifest\.json|metadata\.json|content\.md|raw\.html\.gz|images\/[^/]+\.(?:png|jpe?g|gif|webp))|attachments\/.+|drafts\/manual-[0-9a-f]{64}\.(?:md|json)|protected-generations\/(?:current\.json|[0-9a-f-]+\/archive\/.+)))$/i;

function defaultPaths(options = {}) {
  const data = path.resolve(options.dataFile || process.env.README_FILE || path.join(__dirname, "..", "DATA.md"));
  const dataRoot = path.dirname(data);
  const controlDir = path.resolve(options.controlDir || process.env.CONTROL_DIR || path.join(dataRoot, ".linggan"));
  return {
    data,
    entries: path.resolve(options.entriesDir || process.env.ENTRIES_DIR || path.join(__dirname, "..", "docs", "entries")),
    brainstorms: path.resolve(options.brainstormDir || process.env.BRAINSTORM_DIR || path.join(controlDir, "brainstorms")),
    trash: path.resolve(options.trashDir || process.env.TRASH_DIR || path.join(controlDir, "trash")),
    orphans: path.resolve(options.orphansDir || process.env.RECOVERED_ORPHANS_DIR || path.join(controlDir, "recovered-orphans")),
    controlDir,
  };
}

function walkOrdinary(root, current = root, output = []) {
  if (!fs.existsSync(current)) return output;
  const stat = fs.lstatSync(current);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
    throw new BackupError("export_failed", "导出范围包含链接或特殊文件", { pathHash: sha256(path.relative(root, current)) });
  }
  if (stat.isFile()) {
    output.push({ path: path.relative(root, current).split(path.sep).join("/").normalize("NFC"), data: readStableFile(current) });
    return output;
  }
  for (const name of fs.readdirSync(current).sort()) walkOrdinary(root, path.join(current, name), output);
  return output;
}

function orphanRecord(sourceScope, sourcePath, data, now, reason = "unclassified") {
  const sourcePathHash = sha256(Buffer.from(sourcePath));
  const contentHash = sha256(data);
  const base = "orphans/unclassified/" + sourceScope + "/" + sourcePathHash + "/" + contentHash + "/";
  const extension = path.posix.extname(sourcePath).toLowerCase();
  const metadata = {
    version: 1,
    sourceScope,
    sourcePath,
    sourcePathSha256: sourcePathHash,
    contentSha256: contentHash,
    originalExtension: extension,
    bytes: data.length,
    reasons: [reason],
    firstSeenAt: now,
    lastSeenAt: now,
  };
  return [
    { path: base + "metadata.json", data: Buffer.from(JSON.stringify(metadata)) },
    { path: base + "payload.bin", data },
  ];
}

function collectExportFiles(paths, options = {}) {
  if (!fs.existsSync(paths.data) || !fs.lstatSync(paths.data).isFile()) {
    throw new BackupError("data_missing", "DATA.md 不存在");
  }
  const now = options.createdAt || new Date().toISOString();
  const files = [{ path: "DATA.md", data: readStableFile(paths.data) }];
  const warnings = [];
  const roots = [
    ["entries", paths.entries],
    ["brainstorms", paths.brainstorms],
    ["trash", paths.trash],
    ["orphans", paths.orphans],
  ];
  for (const [scope, root] of roots) {
    for (const file of walkOrdinary(root)) {
      const virtual = scope + "/" + file.path;
      if (scope === "entries" && !ALLOWED_ENTRY_FILE.test(file.path)) {
        files.push(...orphanRecord(scope, virtual, file.data, now));
        warnings.push({ code: "unclassified", scope, pathHash: sha256(Buffer.from(virtual)) });
      } else {
        files.push({ path: virtual, data: file.data });
      }
    }
  }
  return { files, warnings };
}

function exportBundle(options = {}) {
  const paths = defaultPaths(options);
  const collected = collectExportFiles(paths, options);
  const bundle = createBundle(collected.files, {
    createdAt: options.createdAt,
    appVersion: options.appVersion === undefined ? "2.2.0" : options.appVersion,
  });
  Object.defineProperty(bundle, "warnings", { value: collected.warnings, enumerable: false });
  return bundle;
}

async function exportBundleAsync(options = {}) {
  const coordinator = options.coordinator || defaultCoordinator;
  return coordinator.withMaintenance(async () => exportBundle(options), { timeoutMs: options.timeoutMs });
}

function validateBundle(bundle, options) {
  const parsed = parseBundle(bundle, options);
  const data = parsed.decoded.find(file => file.path === "DATA.md");
  const entryUids = new Set(parsed.decoded.map(file => /^entries\/([^/]+)\//.exec(file.path)).filter(Boolean).map(match => match[1]));
  return {
    bundle: parsed.bundle,
    bytes: parsed.bundle.manifest.totalBytes,
    entryCount: entryUids.size,
    fileCount: parsed.bundle.manifest.fileCount,
    hash: parsed.hash,
    legacy: Boolean(parsed.legacy),
    text: data.bytes.toString("utf8"),
    warnings: parsed.warnings,
  };
}

function summary(bundle) {
  const checked = validateBundle(bundle);
  return {
    formatVersion: checked.bundle.version,
    dataVersion: checked.bundle.source.dataVersion,
    entryCount: checked.entryCount,
    fileCount: checked.fileCount,
    totalBytes: checked.bytes,
    scopes: [...SCOPES],
  };
}

function createManager(options = {}) {
  const paths = defaultPaths(options);
  return new BackupTransactionManager({
    controlDir: paths.controlDir,
    paths,
    coordinator: options.coordinator,
    now: options.now,
    volumeIdProvider: options.volumeIdProvider,
    statfs: options.statfs,
    fault: options.fault,
    lockFactory: options.lockFactory,
    nativeBinding: options.nativeBinding,
    bindingPath: options.bindingPath,
  });
}

async function importBundle(bundle, options = {}) {
  const manager = options.manager || createManager(options);
  const prepared = await manager.prepare(bundle, { requestId: options.requestId, transactionId: options.transactionId });
  const result = await manager.commit(prepared.transactionId);
  const checked = validateBundle(bundle, { createdAt: options.now && options.now().toISOString() });
  return {
    ok: result.committed,
    committed: result.committed,
    rolledBack: result.rolledBack,
    transactionId: prepared.transactionId,
    entryCount: checked.entryCount,
    bytes: checked.bytes,
    backupDir: manager.journalFile(prepared.transactionId),
  };
}

module.exports = {
  FORMAT,
  FORMAT_VERSION,
  MAX_BUNDLE_BYTES,
  collectExportFiles,
  createManager,
  defaultPaths,
  exportBundle,
  exportBundleAsync,
  importBundle,
  serializeBundle,
  summary,
  validateBundle,
};
