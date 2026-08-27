"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { UUID_RE, sha256 } = require("./backup-format");
const { defaultCoordinator } = require("./maintenance");
const { IdempotencyStore, atomicJson, syncDirectory, writeFileDurable } = require("./idempotency");

const MAX_CONTENT_BYTES = 20 * 1024 * 1024;

function safeUid(value) {
  const uid = String(value || "");
  if (!/^[0-9a-zA-Z._-]+$/.test(uid) || uid === "." || uid === "..") throw new Error("非法条目 UID");
  return uid;
}

function entryDirectory(entriesDir, uid) {
  const root = path.resolve(entriesDir);
  const directory = path.resolve(root, safeUid(uid));
  if (!directory.startsWith(root + path.sep)) throw new Error("条目路径越界");
  return directory;
}

function contentPath(entriesDir, uid) {
  return path.join(entryDirectory(entriesDir, uid), "archive", "content.md");
}

function readCanonicalContent(entriesDir, uid, options = {}) {
  const file = contentPath(entriesDir, uid);
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw Object.assign(new Error("canonical 正文不是普通文件"), { code: "unsupported_file_type" });
  if (stat.size > (options.limit || MAX_CONTENT_BYTES)) throw Object.assign(new Error("canonical 正文超过 20MiB"), { code: "bundle_too_large" });
  return fs.readFileSync(file, "utf8");
}

function receiptStore(runtimeDir, now) {
  return new IdempotencyStore(path.join(path.resolve(runtimeDir), "idempotency"), { now });
}

function writeManualDraft(options) {
  const bytes = Buffer.from(String(options.content || ""));
  if (!bytes.length) throw new Error("手动正文不能为空");
  if (bytes.length > MAX_CONTENT_BYTES) throw new Error("手动正文超过 20MiB");
  const uid = safeUid(options.uid);
  const digest = sha256(bytes);
  const requestId = String(options.requestId || crypto.randomUUID()).toLowerCase();
  if (!UUID_RE.test(requestId)) throw new Error("requestId 必须是 UUID");
  const coordinator = options.coordinator || defaultCoordinator;
  const token = coordinator.acquireMutation(options.leaseToken);
  try {
    const now = options.now || (() => new Date());
    const store = options.idempotency || receiptStore(options.runtimeDir, now);
    const draftDir = path.join(entryDirectory(options.entriesDir, uid), "drafts");
    const markdownFile = path.join(draftDir, "manual-" + digest + ".md");
    const metadataFile = path.join(draftDir, "manual-" + digest + ".json");
    const before = fs.existsSync(markdownFile) ? sha256(fs.readFileSync(markdownFile)) : null;
    const begun = store.begin({
      requestId,
      action: "archive.manual",
      values: { entryRef: uid, contentSha256: digest },
      beforeFingerprint: before,
      afterFingerprint: digest,
      domainRef: "draft:" + uid + ":" + digest,
    });
    if (begun.replay) return begun.receipt.response;
    fs.mkdirSync(draftDir, { recursive: true });
    if (fs.existsSync(markdownFile)) {
      if (sha256(fs.readFileSync(markdownFile)) !== digest) throw new Error("同名手动草稿 hash 冲突");
    } else {
      writeFileDurable(markdownFile, bytes);
      syncDirectory(draftDir);
    }
    const metadata = {
      version: 1,
      uid,
      sha256: digest,
      createdAt: begun.receipt.fixedNow,
      origin: options.origin || "manual",
    };
    if (!fs.existsSync(metadataFile)) atomicJson(metadataFile, metadata, { exclusive: true });
    const reread = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
    if (reread.uid !== uid || reread.sha256 !== digest || sha256(fs.readFileSync(markdownFile)) !== digest) {
      throw new Error("手动草稿写后验证失败");
    }
    const response = { accepted: true, uid, draftHash: digest, operationId: requestId };
    store.commit(requestId, 200, response);
    return response;
  } finally {
    coordinator.releaseMutation(token);
  }
}

module.exports = {
  MAX_CONTENT_BYTES,
  contentPath,
  entryDirectory,
  readCanonicalContent,
  safeUid,
  writeManualDraft,
};
