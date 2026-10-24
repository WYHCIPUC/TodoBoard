"use strict";

const crypto = require("crypto");
const path = require("path");
const zlib = require("zlib");

const FORMAT = "linggan-backup";
const FORMAT_VERSION = 2;
const SCOPES = Object.freeze(["data", "entries", "brainstorms", "trash", "orphans"]);
const LIMITS = Object.freeze({
  httpBody: 80 * 1024 * 1024,
  decodedBundle: 50 * 1024 * 1024,
  files: 5000,
  screenshot: 5 * 1024 * 1024,
  archiveImage: 10 * 1024 * 1024,
  rawGzip: 20 * 1024 * 1024,
  ordinary: 20 * 1024 * 1024,
});
const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SEMVER_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SAFE_V1_NAME = /^(?:notes\.md|content\.md|screenshots\/[0-9A-Za-z._-]+\.(?:png|jpe?g)|archive\/(?:metadata\.json|content\.md|raw\.html\.gz|images\/[0-9A-Za-z._-]+\.(?:png|jpe?g|gif|webp|svg|bin)))$/i;
const V1_UTF8 = /^(?:notes\.md|content\.md|archive\/(?:metadata\.json|content\.md))$/i;
const DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const ORPHAN_REASONS = Object.freeze(["corrupt_v1_artifact", "damaged_archive", "downgrade_candidate", "failed_new_generation", "invalid_protected_generation", "orphaned_manual_draft", "removed_entry", "unclassified"]);
const ORPHAN_SCOPES = Object.freeze(["data", "entries", "brainstorms", "trash", "orphans", "runtime"]);

class BackupError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "BackupError";
    this.code = code;
    this.details = details || null;
  }
}

function fail(code, message, details) {
  throw new BackupError(code, message, details);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hasExactKeys(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every(key => allowed.has(key));
}

function hasRequiredKeys(value, required) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    required.every(key => Object.prototype.hasOwnProperty.call(value, key)));
}

function isCanonicalUtc(value) {
  if (typeof value !== "string" || !UTC_RE.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function scalarLength(value) {
  return Array.from(value).length;
}

function normalizeVirtualPath(value) {
  if (typeof value !== "string" || value !== value.normalize("NFC")) {
    fail("invalid_path", "备份路径必须是 NFC 字符串");
  }
  if (!value || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes("\\")) {
    fail("invalid_path", "备份路径必须是规范相对路径", { path: value });
  }
  if (Buffer.byteLength(value, "utf8") > 1024) fail("invalid_path", "备份路径超过 1024 字节");
  for (const segment of value.split("/")) {
    if (!segment || segment === "." || segment === ".." || scalarLength(segment) > 120 ||
        /[\u0000-\u001f\u007f<>:"|?*]/u.test(segment) || /[. ]$/.test(segment) || DEVICE_RE.test(segment)) {
      fail("invalid_path", "备份路径包含非法分段", { path: value });
    }
  }
  return value;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left.normalize("NFC")), Buffer.from(right.normalize("NFC")));
}

function strictBase64(value) {
  if (typeof value !== "string" || value.length % 4 !== 0) {
    fail("invalid_bundle", "文件数据不是规范 Base64");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const contentLength = value.length - padding;
  if ((padding === 1 && contentLength % 4 !== 3) || (padding === 2 && contentLength % 4 !== 2)) {
    fail("invalid_bundle", "文件数据不是规范 Base64");
  }
  for (let index = 0; index < contentLength; index++) {
    const code = value.charCodeAt(index);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47)) {
      fail("invalid_bundle", "文件数据不是规范 Base64");
    }
  }
  for (let index = contentLength; index < value.length; index++) {
    if (value[index] !== "=") fail("invalid_bundle", "文件数据不是规范 Base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail("invalid_bundle", "文件数据不是规范 Base64");
  return bytes;
}

function fatalUtf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    fail("invalid_bundle", "文本文件不是有效 UTF-8");
  }
}

function maxBytesFor(filePath) {
  if (/^entries\/[^/]+\/screenshots\/[^/]+\.(?:png|jpe?g)$/i.test(filePath)) return LIMITS.screenshot;
  if (/^entries\/[^/]+\/archive\/images\/[^/]+\.(?:png|jpe?g|gif|webp)$/i.test(filePath)) return LIMITS.archiveImage;
  if (/raw\.html\.gz$/i.test(filePath)) return LIMITS.rawGzip;
  return LIMITS.ordinary;
}

function validImageMagic(filePath, bytes) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (/\.jpe?g$/.test(lower)) return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (lower.endsWith(".gif")) return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  if (lower.endsWith(".webp")) return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return true;
}

function gunzipBytes(bytes) {
  try {
    const output = zlib.gunzipSync(bytes, { maxOutputLength: LIMITS.rawGzip });
    return output.length;
  } catch (_) {
    fail("invalid_bundle", "raw gzip 无效或解压后超过限制");
  }
}

function knownTextPath(filePath) {
  return filePath === "DATA.md" || /\.(?:md|json)$/i.test(filePath);
}

function validateMappedPath(filePath) {
  if (filePath === "DATA.md") return;
  if (/^entries\/[^/]+\/.+/.test(filePath) || /^(?:brainstorms|trash|orphans)\/.+/.test(filePath)) return;
  fail("invalid_path", "备份路径不属于已声明的数据范围", { path: filePath });
}

function canonicalOrphan(sourceScope, sourcePath, bytes, timestamp, reason) {
  const sourcePathHash = sha256(Buffer.from(sourcePath));
  const contentHash = sha256(bytes);
  const base = "orphans/unclassified/" + sourceScope + "/" + sourcePathHash + "/" + contentHash + "/";
  const metadata = {
    version: 1,
    sourceScope,
    sourcePath,
    sourcePathSha256: sourcePathHash,
    contentSha256: contentHash,
    originalExtension: path.posix.extname(sourcePath).toLowerCase(),
    bytes: bytes.length,
    reasons: [reason],
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
  };
  return [
    { path: base + "metadata.json", data: Buffer.from(JSON.stringify(metadata)) },
    { path: base + "payload.bin", data: bytes },
  ];
}

function legacyArtifactIsActiveSafe(name, bytes) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".svg") || lower.endsWith(".bin")) return false;
  if (/^(?:screenshots\/|archive\/images\/)/.test(lower) && !validImageMagic(name, bytes)) return false;
  if (lower === "archive/metadata.json") {
    try { JSON.parse(fatalUtf8(bytes)); } catch (_) { return false; }
  }
  if (lower === "archive/raw.html.gz") {
    try { gunzipBytes(bytes); } catch (_) { return false; }
  }
  return true;
}

function validateDataText(text) {
  if (!/(?:<!--\s*linggan:data-version=2\s*-->|<!--\s*data-version:\s*2\s*-->)/.test(text)) {
    fail("invalid_bundle", "DATA.md 必须声明 data version 2");
  }
  const uids = [];
  for (const match of text.matchAll(/<!--\s*linggan:uid=([^\s]+)\s*-->/g)) uids.push(match[1]);
  if (uids.some(uid => !UUID_RE.test(uid)) || new Set(uids.map(uid => uid.toLowerCase())).size !== uids.length) {
    fail("invalid_bundle", "DATA.md 包含非法或重复 UID");
  }
  return new Set(uids.map(uid => uid.toLowerCase()));
}

function validateOrphanContainers(decoded) {
  const containers = new Map();
  for (const file of decoded) {
    if (!file.path.startsWith("orphans/unclassified/")) continue;
    const match = /^orphans\/unclassified\/([^/]+)\/([0-9a-f]{64})\/([0-9a-f]{64})\/(metadata\.json|payload\.bin)$/.exec(file.path);
    if (!match) fail("invalid_bundle", "unclassified orphan 路径非法", { path: file.path });
    const key = match.slice(1, 4).join("/");
    if (!containers.has(key)) containers.set(key, { scope: match[1], sourceHash: match[2], contentHash: match[3] });
    containers.get(key)[match[4] === "metadata.json" ? "metadataBytes" : "payload"] = file.bytes;
  }
  for (const container of containers.values()) {
    if (!container.metadataBytes || !container.payload) fail("invalid_bundle", "unclassified orphan 必须成对保存 metadata/payload");
    let metadata;
    const text = fatalUtf8(container.metadataBytes);
    try { metadata = JSON.parse(text); } catch (_) { fail("invalid_bundle", "unclassified orphan metadata 非法"); }
    const keys = ["version", "sourceScope", "sourcePath", "sourcePathSha256", "contentSha256", "originalExtension", "bytes", "reasons", "firstSeenAt", "lastSeenAt"];
    if (!hasExactKeys(metadata, keys) || JSON.stringify(metadata) !== text || metadata.version !== 1 ||
        !ORPHAN_SCOPES.includes(metadata.sourceScope) || metadata.sourceScope !== container.scope ||
        typeof metadata.sourcePath !== "string" || metadata.sourcePathSha256 !== container.sourceHash ||
        metadata.contentSha256 !== container.contentHash || metadata.contentSha256 !== sha256(container.payload) ||
        metadata.bytes !== container.payload.length || !Number.isSafeInteger(metadata.bytes) || metadata.bytes < 0 ||
        typeof metadata.originalExtension !== "string" || metadata.originalExtension !== path.posix.extname(metadata.sourcePath).toLowerCase() ||
        !Array.isArray(metadata.reasons) || !metadata.reasons.length || metadata.reasons.some(reason => !ORPHAN_REASONS.includes(reason)) ||
        JSON.stringify(metadata.reasons) !== JSON.stringify([...new Set(metadata.reasons)].sort()) ||
        !isCanonicalUtc(metadata.firstSeenAt) || !isCanonicalUtc(metadata.lastSeenAt) || Date.parse(metadata.firstSeenAt) > Date.parse(metadata.lastSeenAt)) {
      fail("invalid_bundle", "unclassified orphan metadata 与 payload 不一致");
    }
    const sourcePath = normalizeVirtualPath(metadata.sourcePath);
    if (sha256(Buffer.from(sourcePath)) !== metadata.sourcePathSha256) fail("invalid_bundle", "unclassified orphan source path hash 不匹配");
  }
}

function canonicalBundle(bundle) {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    createdAt: bundle.createdAt,
    source: { appVersion: bundle.source.appVersion, dataVersion: bundle.source.dataVersion },
    manifest: {
      algorithm: "sha256",
      fileCount: bundle.manifest.fileCount,
      totalBytes: bundle.manifest.totalBytes,
      scopes: [...SCOPES],
    },
    files: bundle.files.map(file => {
      const record = { path: file.path, encoding: "base64", bytes: file.bytes, sha256: file.sha256 };
      if (Object.prototype.hasOwnProperty.call(file, "uncompressedBytes")) record.uncompressedBytes = file.uncompressedBytes;
      record.data = file.data;
      return record;
    }),
  };
}

function serializeBundle(bundle) {
  return JSON.stringify(canonicalBundle(bundle));
}

function createBundle(files, options = {}) {
  const records = files.map(file => {
    const bytes = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const record = {
      path: normalizeVirtualPath(file.path),
      encoding: "base64",
      bytes: bytes.length,
      sha256: sha256(bytes),
      data: bytes.toString("base64"),
    };
    if (/raw\.html\.gz$/i.test(record.path)) record.uncompressedBytes = gunzipBytes(bytes);
    return record;
  }).sort((a, b) => compareUtf8(a.path, b.path));
  const bundle = {
    format: FORMAT,
    version: FORMAT_VERSION,
    createdAt: options.createdAt === undefined ? new Date().toISOString() : options.createdAt,
    source: { appVersion: options.appVersion === undefined ? require("../package.json").version : options.appVersion, dataVersion: 2 },
    manifest: {
      algorithm: "sha256",
      fileCount: records.length,
      totalBytes: records.reduce((sum, file) => sum + file.bytes, 0),
      scopes: [...SCOPES],
    },
    files: records,
  };
  return validateV2(bundle).bundle;
}

function validateV2(input) {
  if (!hasRequiredKeys(input, ["format", "version", "createdAt", "source", "manifest", "files"])) {
    fail("invalid_bundle", "v2 备份顶层结构非法");
  }
  if (input.format !== FORMAT) fail("invalid_bundle", "备份格式标识非法");
  if (input.version !== FORMAT_VERSION) fail("unsupported_version", "不支持的备份版本");
  if (!isCanonicalUtc(input.createdAt)) fail("invalid_timestamp", "备份时间必须是规范 UTC 毫秒格式");
  if (!hasRequiredKeys(input.source, ["appVersion", "dataVersion"]) ||
      typeof input.source.appVersion !== "string" || !SEMVER_RE.test(input.source.appVersion) || input.source.dataVersion !== 2) {
    fail("invalid_bundle", "备份 source 非法");
  }
  if (!hasRequiredKeys(input.manifest, ["algorithm", "fileCount", "totalBytes", "scopes"]) ||
      input.manifest.algorithm !== "sha256" || !Number.isSafeInteger(input.manifest.fileCount) ||
      !Number.isSafeInteger(input.manifest.totalBytes) || input.manifest.fileCount < 0 || input.manifest.totalBytes < 0 ||
      JSON.stringify(input.manifest.scopes) !== JSON.stringify(SCOPES)) {
    fail("invalid_bundle", "备份 manifest 非法");
  }
  if (!Array.isArray(input.files)) fail("invalid_bundle", "备份 files 必须是数组");
  if (input.files.length > LIMITS.files) fail("bundle_too_large", "备份文件数量超过限制");
  if (input.manifest.fileCount !== input.files.length) fail("invalid_bundle", "fileCount 与 files 不一致");

  const decoded = [];
  const collision = new Set();
  let total = 0;
  let previous = null;
  let dataText = null;
  for (const file of input.files) {
    const gzip = file && typeof file.path === "string" && /raw\.html\.gz$/i.test(file.path);
    const required = ["path", "encoding", "bytes", "sha256", "data"];
    if (!hasExactKeys(file, required, gzip ? ["uncompressedBytes"] : [])) fail("invalid_bundle", "v2 文件记录结构非法");
    const filePath = normalizeVirtualPath(file.path);
    validateMappedPath(filePath);
    const key = filePath.normalize("NFC").toLowerCase();
    if (collision.has(key)) fail("invalid_bundle", "备份路径重复", { path: filePath });
    collision.add(key);
    if (previous !== null && compareUtf8(previous, filePath) >= 0) fail("invalid_bundle", "备份文件顺序不是 canonical");
    previous = filePath;
    if (file.encoding !== "base64" || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !SHA256_RE.test(file.sha256)) {
      fail("invalid_bundle", "v2 文件记录字段非法", { path: filePath });
    }
    const bytes = strictBase64(file.data);
    if (bytes.length !== file.bytes) fail("invalid_bundle", "文件字节数不匹配", { path: filePath });
    if (sha256(bytes) !== file.sha256) fail("checksum_mismatch", "文件 checksum 不匹配", { path: filePath });
    if (bytes.length > maxBytesFor(filePath)) fail("bundle_too_large", "单文件超过容量限制", { path: filePath });
    if (gzip) {
      if (!Number.isSafeInteger(file.uncompressedBytes) || file.uncompressedBytes < 0 || gunzipBytes(bytes) !== file.uncompressedBytes) {
        fail("invalid_bundle", "raw gzip 解压字节数不匹配", { path: filePath });
      }
    }
    if (knownTextPath(filePath)) {
      const text = fatalUtf8(bytes);
      if (/\.json$/i.test(filePath)) {
        try { JSON.parse(text); } catch (_) { fail("invalid_bundle", "JSON 文件非法", { path: filePath }); }
      }
      if (filePath === "DATA.md") dataText = text;
    }
    if (/^entries\/[^/]+\/(?:screenshots|archive\/images)\//.test(filePath) && !validImageMagic(filePath, bytes)) {
      fail("invalid_bundle", "活动图片 magic 非法", { path: filePath });
    }
    total += bytes.length;
    if (total > LIMITS.decodedBundle) fail("bundle_too_large", "备份解码总量超过限制");
    decoded.push({ path: filePath, bytes });
  }
  if (input.manifest.totalBytes !== total) fail("invalid_bundle", "totalBytes 与文件总量不一致");
  const dataFiles = decoded.filter(file => file.path === "DATA.md");
  if (dataFiles.length !== 1) fail("invalid_bundle", "备份必须恰好包含一份 DATA.md");
  const uids = validateDataText(dataText);
  for (const file of decoded) {
    const match = /^entries\/([^/]+)\//.exec(file.path);
    if (match && (!UUID_RE.test(match[1]) || !uids.has(match[1].toLowerCase()))) {
      fail("invalid_bundle", "entries UID 不在 DATA.md 中", { path: file.path });
    }
  }
  validateOrphanContainers(decoded);
  const bundle = canonicalBundle(input);
  return { bundle, decoded, hash: sha256(Buffer.from(JSON.stringify(bundle))), warnings: [], entryUids: uids };
}

function validateV1(input, options = {}) {
  if (!hasRequiredKeys(input, ["format", "version", "data", "entries"]) || input.format !== FORMAT || input.version !== 1 ||
      typeof input.data !== "string" || !Array.isArray(input.entries) ||
      (Object.prototype.hasOwnProperty.call(input, "createdAt") && typeof input.createdAt !== "string")) {
    fail("invalid_bundle", "v1 备份结构非法");
  }
  const dataBytes = Buffer.from(input.data, "utf8");
  if (dataBytes.toString("utf8") !== input.data || /[\uD800-\uDFFF]/u.test(input.data)) fail("invalid_bundle", "v1 DATA 文本非法");
  const uids = validateDataText(input.data);
  const files = [{ path: "DATA.md", data: dataBytes }];
  const warnings = [];
  const seenUids = new Set();
  let count = 1;
  let total = dataBytes.length;
  for (const entry of input.entries) {
    if (!hasExactKeys(entry, ["uid", "files"], ["id"]) || typeof entry.uid !== "string" || !entry.uid ||
        (Object.prototype.hasOwnProperty.call(entry, "id") && typeof entry.id !== "string") || !Array.isArray(entry.files) ||
        !uids.has(entry.uid.toLowerCase()) || seenUids.has(entry.uid.toLowerCase())) {
      fail("invalid_bundle", "v1 条目结构或 UID 非法");
    }
    seenUids.add(entry.uid.toLowerCase());
    const paths = new Set();
    for (const file of entry.files) {
      if (!hasExactKeys(file, ["name", "encoding", "data"]) || typeof file.name !== "string" ||
          typeof file.encoding !== "string" || typeof file.data !== "string" || !SAFE_V1_NAME.test(file.name)) {
        fail("invalid_bundle", "v1 文件记录非法");
      }
      const normalized = file.name.normalize("NFC");
      const collisionKey = normalized.toLowerCase();
      if (normalized !== file.name || paths.has(collisionKey)) fail("invalid_bundle", "v1 文件路径重复或非 NFC");
      paths.add(collisionKey);
      const expectedEncoding = V1_UTF8.test(file.name) ? "utf8" : "base64";
      if (file.encoding !== expectedEncoding) fail("invalid_bundle", "v1 文件编码与路径不匹配");
      let bytes;
      if (file.encoding === "base64") bytes = strictBase64(file.data);
      else {
        if (/[\uD800-\uDFFF]/u.test(file.data)) fail("invalid_bundle", "v1 UTF-8 文本含孤立代理项");
        bytes = Buffer.from(file.data, "utf8");
      }
      count++;
      total += bytes.length;
      if (count > LIMITS.files || total > LIMITS.decodedBundle || bytes.length > maxBytesFor("entries/" + entry.uid + "/" + file.name)) {
        fail("bundle_too_large", "v1 备份超过安全限制");
      }
      const sourcePath = "entries/" + entry.uid + "/" + file.name;
      if (!legacyArtifactIsActiveSafe(file.name, bytes)) {
        files.push(...canonicalOrphan("entries", sourcePath, bytes, isCanonicalUtc(input.createdAt) ? input.createdAt : (options.createdAt || new Date().toISOString()), "corrupt_v1_artifact"));
        warnings.push({ code: "corrupt_v1_artifact", scope: "entries", pathHash: sha256(Buffer.from(sourcePath)), uid: entry.uid });
      } else {
        files.push({ path: sourcePath, data: bytes });
      }
    }
  }
  const createdAt = isCanonicalUtc(input.createdAt) ? input.createdAt : (options.createdAt === undefined ? new Date().toISOString() : options.createdAt);
  for (const entry of input.entries) {
    const rootPath = "entries/" + entry.uid + "/content.md";
    const archivePath = "entries/" + entry.uid + "/archive/content.md";
    const rootIndex = files.findIndex(file => file.path === rootPath);
    const archiveIndex = files.findIndex(file => file.path === archivePath);
    if (rootIndex < 0) continue;
    const rootFile = files[rootIndex];
    files.splice(rootIndex, 1);
    const shiftedArchive = files.findIndex(file => file.path === archivePath);
    if (shiftedArchive < 0) {
      files.push({ path: archivePath, data: rootFile.data });
    } else if (!files[shiftedArchive].data.equals(rootFile.data)) {
      files.push({ path: "entries/" + entry.uid + "/attachments/legacy-content-" + sha256(rootFile.data) + ".md", data: rootFile.data });
      warnings.push({ code: "legacy_content_conflict", scope: "entries", pathHash: sha256(Buffer.from(rootPath)), uid: entry.uid });
    }
  }
  const bundle = createBundle(files, { createdAt, appVersion: options.appVersion === undefined ? "2.1.0" : options.appVersion });
  return { ...validateV2(bundle), legacy: true, warnings: [{ code: "legacy_v1_overlay", scope: "data", pathHash: sha256("DATA.md") }, ...warnings] };
}

function parseBundle(input, options = {}) {
  let value = input;
  if (Buffer.isBuffer(input) || typeof input === "string") {
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (bytes.length > LIMITS.httpBody) fail("bundle_too_large", "备份 JSON 超过 80 MiB");
    try { value = JSON.parse(fatalUtf8(bytes)); } catch (error) {
      if (error instanceof BackupError) throw error;
      fail("invalid_bundle", "备份 JSON 无法解析");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.format !== FORMAT) fail("invalid_bundle", "不是灵感工作台备份");
  if (value.version === 1) return validateV1(value, options);
  if (value.version === 2) return validateV2(value);
  fail("unsupported_version", "不支持的备份版本");
}

module.exports = {
  BackupError,
  FORMAT,
  FORMAT_VERSION,
  LIMITS,
  ORPHAN_REASONS,
  ORPHAN_SCOPES,
  SEMVER_RE,
  SCOPES,
  UUID_RE,
  canonicalBundle,
  compareUtf8,
  createBundle,
  fatalUtf8,
  isCanonicalUtc,
  normalizeVirtualPath,
  parseBundle,
  serializeBundle,
  sha256,
  strictBase64,
  validateV1,
  validateV2,
  validateOrphanContainers,
};
