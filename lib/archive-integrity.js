"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { UUID_RE, isCanonicalUtc, normalizeVirtualPath, sha256 } = require("./backup-format");
const { assessCandidate } = require("./archive-quality");

const DAMAGE_REASONS = Object.freeze([
  "missing", "missing_manifest", "unreadable", "checksum_mismatch", "invalid_manifest", "unexpected_file", "unsupported_file_type",
]);
const PROVENANCE = new Set(["fresh", "inherited", "legacy_unverified", "manual"]);
const WARNING_CODES = new Set(["legacy_content_conflict", "legacy_content_unusable", "downgrade_archive_rewritten"]);
const CAPTURE_STATES = new Set(["succeeded", "partial", "manual"]);
const AUTHORITIES = new Set(["manual", "official_api", "official_raw", "site_scraper", "readability", "metadata", "placeholder", "legacy_unknown"]);
const QUALITY_STATES = new Set(["usable_clean", "usable_partial", "unusable"]);
const CONTENT_LIMIT = 20 * 1024 * 1024;

function isSupportedImage(relative, bytes) {
  if (/\.png$/.test(relative)) return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (/\.(?:jpg|jpeg)$/.test(relative)) return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (/\.gif$/.test(relative)) return bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  if (/\.webp$/.test(relative)) return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

function validateArtifact(relative, bytes) {
  if (["content.md", "metadata.json"].includes(relative)) return true;
  if (relative === "raw.html.gz") {
    if (bytes.length > CONTENT_LIMIT) return false;
    try { zlib.gunzipSync(bytes, { maxOutputLength: CONTENT_LIMIT }); return true; } catch (_) { return false; }
  }
  if (/^images\/[^/]+\.(?:png|jpe?g|gif|webp)$/.test(relative)) return isSupportedImage(relative, bytes);
  return false;
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function utf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function canonicalManifest(value) {
  const manifest = {
    version: value.version,
    snapshotId: value.snapshotId,
    createdAt: value.createdAt,
    quality: {
      manual: value.quality.manual,
      authority: value.quality.authority,
      state: value.quality.state,
      normalizedChars: value.quality.normalizedChars,
    },
    files: value.files.map(file => ({
      path: file.path,
      bytes: file.bytes,
      sha256: file.sha256,
      provenance: file.provenance,
    })),
  };
  return JSON.stringify(manifest);
}

function parseJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validateMetadata(metadata) {
  if (!exactKeys(metadata, ["archiveSchemaVersion", "snapshotId", "entry", "capture", "migrationWarnings"]) || metadata.archiveSchemaVersion !== 2) return false;
  if (!exactKeys(metadata.entry, ["uid", "id", "url", "title"])) return false;
  if (!exactKeys(metadata.capture, ["state", "authority", "manual", "capturedAt", "source"])) return false;
  if (!CAPTURE_STATES.has(metadata.capture.state) || !AUTHORITIES.has(metadata.capture.authority) || typeof metadata.capture.manual !== "boolean") return false;
  if (!isCanonicalUtc(metadata.capture.capturedAt) || typeof metadata.capture.source !== "string" || metadata.capture.source.length > 200) return false;
  if (!Array.isArray(metadata.migrationWarnings) || metadata.migrationWarnings.some(code => !WARNING_CODES.has(code))) return false;
  if (metadata.migrationWarnings.join("\0") !== [...metadata.migrationWarnings].sort().join("\0")) return false;
  return ["uid", "id", "url", "title"].every(key => typeof metadata.entry[key] === "string");
}

function validateManifestShape(manifest) {
  if (!exactKeys(manifest, ["version", "snapshotId", "createdAt", "quality", "files"]) || manifest.version !== 1) return false;
  if (!UUID_RE.test(manifest.snapshotId || "") || manifest.snapshotId !== manifest.snapshotId.toLowerCase() || !isCanonicalUtc(manifest.createdAt)) return false;
  if (!exactKeys(manifest.quality, ["manual", "authority", "state", "normalizedChars"])) return false;
  if (typeof manifest.quality.manual !== "boolean" || !AUTHORITIES.has(manifest.quality.authority) || !QUALITY_STATES.has(manifest.quality.state) || !Number.isSafeInteger(manifest.quality.normalizedChars) || manifest.quality.normalizedChars < 0) return false;
  if (!Array.isArray(manifest.files) || !manifest.files.length) return false;
  let previous = null;
  const seen = new Set();
  for (const file of manifest.files) {
    if (!exactKeys(file, ["path", "bytes", "sha256", "provenance"])) return false;
    let normalized;
    try { normalized = normalizeVirtualPath(file.path); } catch (_) { return false; }
    if (normalized !== file.path || file.path === "manifest.json" || seen.has(file.path)) return false;
    if (previous !== null && utf8Compare(previous, file.path) >= 0) return false;
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[0-9a-f]{64}$/.test(file.sha256) || !PROVENANCE.has(file.provenance)) return false;
    previous = file.path;
    seen.add(file.path);
  }
  return seen.has("content.md") && seen.has("metadata.json");
}

function listFiles(root, current = root, output = []) {
  for (const item of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, item.name);
    if (item.isSymbolicLink()) {
      output.push({ path: path.relative(root, full).replace(/\\/g, "/"), unsupported: true });
    } else if (item.isDirectory()) {
      listFiles(root, full, output);
    } else if (item.isFile()) {
      output.push({ path: path.relative(root, full).replace(/\\/g, "/"), file: full });
    } else {
      output.push({ path: path.relative(root, full).replace(/\\/g, "/"), unsupported: true });
    }
  }
  return output.sort((a, b) => utf8Compare(a.path, b.path));
}

function validateArchiveDirectory(directory, options = {}) {
  const root = path.resolve(directory);
  const result = { valid: false, reasonCodes: [], snapshotId: null, manifestHash: null, manifest: null, metadata: null };
  try {
    if (!fs.existsSync(root)) return { ...result, reasonCodes: ["missing"] };
    if (!fs.lstatSync(root).isDirectory()) return { ...result, reasonCodes: ["unsupported_file_type"] };
    const manifestFile = path.join(root, "manifest.json");
    if (!fs.existsSync(manifestFile)) return { ...result, reasonCodes: ["missing_manifest"] };
    if (!fs.lstatSync(manifestFile).isFile()) return { ...result, reasonCodes: ["unsupported_file_type"] };
    const manifestBytes = fs.readFileSync(manifestFile);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    result.manifest = manifest;
    result.snapshotId = manifest.snapshotId || null;
    result.manifestHash = sha256(manifestBytes);
    if (!validateManifestShape(manifest) || canonicalManifest(manifest) !== manifestBytes.toString("utf8")) return { ...result, reasonCodes: ["invalid_manifest"] };
    const actual = listFiles(root);
    if (actual.some(item => item.unsupported)) return { ...result, reasonCodes: ["unsupported_file_type"] };
    const expected = new Map(manifest.files.map(item => [item.path, item]));
    for (const item of actual) {
      if (item.path === "manifest.json") continue;
      if (!expected.has(item.path)) result.reasonCodes.push("unexpected_file");
    }
    for (const record of manifest.files) {
      const file = path.join(root, ...record.path.split("/"));
      if (!fs.existsSync(file)) {
        result.reasonCodes.push("missing");
        continue;
      }
      const stat = fs.lstatSync(file);
      if (!stat.isFile()) {
        result.reasonCodes.push("unsupported_file_type");
        continue;
      }
      let bytes;
      try { bytes = fs.readFileSync(file); } catch (_) { result.reasonCodes.push("unreadable"); continue; }
      if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) result.reasonCodes.push("checksum_mismatch");
      if (!validateArtifact(record.path, bytes)) result.reasonCodes.push("unsupported_file_type");
    }
    result.reasonCodes = [...new Set(result.reasonCodes)].sort();
    if (result.reasonCodes.length) return result;
    const contentBytes = fs.readFileSync(path.join(root, "content.md"));
    if (contentBytes.length > CONTENT_LIMIT) return { ...result, reasonCodes: ["invalid_manifest"] };
    const content = new TextDecoder("utf-8", { fatal: true }).decode(contentBytes);
    const metadata = parseJsonFile(path.join(root, "metadata.json"));
    result.metadata = metadata;
    if (!validateMetadata(metadata) || metadata.snapshotId !== manifest.snapshotId || metadata.capture.capturedAt !== manifest.createdAt) return { ...result, reasonCodes: ["invalid_manifest"] };
    if (options.uid && metadata.entry.uid !== options.uid || options.snapshotId && manifest.snapshotId !== options.snapshotId) return { ...result, reasonCodes: ["invalid_manifest"] };
    const manual = metadata.capture.authority === "manual";
    if (metadata.capture.manual !== manual || manifest.quality.manual !== manual || metadata.capture.authority !== manifest.quality.authority) return { ...result, reasonCodes: ["invalid_manifest"] };
    if (manual !== (metadata.capture.state === "manual")) return { ...result, reasonCodes: ["invalid_manifest"] };
    const quality = assessCandidate({ content, title: metadata.entry.title, authority: metadata.capture.authority, captureState: metadata.capture.state });
    if (!quality.usable || manifest.quality.state === "unusable" || quality.normalizedChars !== manifest.quality.normalizedChars || quality.state !== manifest.quality.state) return { ...result, reasonCodes: ["invalid_manifest"] };
    result.valid = true;
    return result;
  } catch (_) {
    return { ...result, reasonCodes: ["invalid_manifest"] };
  }
}

function scanArchive(entryDirectory, options = {}) {
  const archiveDir = path.join(path.resolve(entryDirectory), "archive");
  if (!fs.existsSync(archiveDir)) return { state: "not_archived", reasonCodes: [], checkedAt: null, snapshotId: null, manifestHash: null };
  const manifestFile = path.join(archiveDir, "manifest.json");
  if (!fs.existsSync(manifestFile)) {
    const expected = options.expectedV2 || fs.existsSync(path.join(archiveDir, "metadata.json")) && (() => {
      try { return parseJsonFile(path.join(archiveDir, "metadata.json")).archiveSchemaVersion === 2; } catch (_) { return false; }
    })();
    return expected
      ? { state: "damaged", reasonCodes: ["missing_manifest"], checkedAt: options.now ? new Date(options.now).toISOString() : new Date().toISOString(), snapshotId: null, manifestHash: null }
      : { state: "unverified", reasonCodes: [], checkedAt: null, snapshotId: null, manifestHash: null };
  }
  let manifest;
  let manifestHash;
  try {
    const bytes = fs.readFileSync(manifestFile);
    manifest = JSON.parse(bytes.toString("utf8"));
    manifestHash = sha256(bytes);
  } catch (_) {
    return { state: "damaged", reasonCodes: ["invalid_manifest"], checkedAt: new Date(options.now || Date.now()).toISOString(), snapshotId: null, manifestHash: null };
  }
  const cache = options.cache;
  if (!options.verify && (!cache || cache.uid !== options.uid || cache.snapshotId !== manifest.snapshotId || cache.manifestHash !== manifestHash)) {
    return { state: "unchecked", reasonCodes: [], checkedAt: null, snapshotId: manifest.snapshotId || null, manifestHash };
  }
  if (!options.verify && cache) return { state: cache.state, reasonCodes: cache.reasonCodes || [], checkedAt: cache.checkedAt, snapshotId: manifest.snapshotId, manifestHash };
  const validation = validateArchiveDirectory(archiveDir, { uid: options.uid });
  return {
    state: validation.valid ? "healthy" : "damaged",
    reasonCodes: validation.reasonCodes,
    checkedAt: new Date(options.now || Date.now()).toISOString(),
    snapshotId: validation.snapshotId,
    manifestHash: validation.manifestHash,
  };
}

module.exports = {
  CAPTURE_STATES,
  CONTENT_LIMIT,
  DAMAGE_REASONS,
  canonicalManifest,
  scanArchive,
  validateArchiveDirectory,
  validateManifestShape,
  validateMetadata,
};
