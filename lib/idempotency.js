"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { UUID_RE, isCanonicalUtc, sha256 } = require("./backup-format");

const ACTION_FIELDS = Object.freeze({
  "backup.prepare": ["bundleSha256"],
  "backup.commit": ["transactionId"],
  "backup.cancel": ["transactionId"],
  "backup.import": ["bundleSha256"],
  "lifecycle.update": ["entryRef", "lifecycleAction", "nextReviewAt"],
  "archive.manual": ["entryRef", "contentSha256"],
  "archive.refresh": ["entryRef"],
  "recovery.retry": ["transactionId"],
  "recovery.restore-old": ["transactionId"],
  "recovery.import.prepare": ["bundleSha256"],
  "recovery.import": ["recoveryPrepareId"],
  "recovery.restore-upgrade.prepare": ["snapshotName", "expectedSnapshotManifestSha256"],
  "recovery.restore-upgrade": ["recoveryPrepareId"],
  "recovery.finalize-upgrade": ["recoveryPrepareId", "mode"],
});

class IdempotencyError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "IdempotencyError";
    this.code = code;
    this.details = details || null;
  }
}

function canonicalRequest(action, values = {}) {
  const fields = ACTION_FIELDS[action];
  if (!fields) throw new IdempotencyError("invalid_request", "未知幂等动作");
  const output = { action };
  for (const field of fields) {
    let value = Object.prototype.hasOwnProperty.call(values, field) ? values[field] : null;
    if (value !== null && typeof value !== "string") throw new IdempotencyError("invalid_request", "幂等字段必须是字符串或 null");
    if (typeof value === "string") value = value.normalize("NFC");
    if (field === "nextReviewAt" && value !== null && !isCanonicalUtc(value)) {
      throw new IdempotencyError("invalid_timestamp", "nextReviewAt 必须是规范 UTC 毫秒格式");
    }
    output[field] = value;
  }
  return JSON.stringify(output);
}

function canonicalRequestHash(action, values) {
  return sha256(Buffer.from(canonicalRequest(action, values)));
}

function syncDirectory(directory, options = {}) {
  const api = options.fs || fs;
  let descriptor;
  try {
    descriptor = api.openSync(directory, "r");
    api.fsyncSync(descriptor);
    return true;
  } catch (error) {
    const unsupported = process.platform === "win32" && ["EPERM", "EACCES", "EINVAL", "ENOTSUP", "EISDIR"].includes(error.code);
    if (!unsupported || options.requireSupported) throw error;
    return false;
  } finally {
    if (descriptor !== undefined) api.closeSync(descriptor);
  }
}

function writeFileDurable(file, bytes, options = {}) {
  const api = options.fs || fs;
  const descriptor = api.openSync(file, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const written = api.writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (written <= 0) throw new Error("short write");
      offset += written;
    }
    api.fsyncSync(descriptor);
  } finally {
    api.closeSync(descriptor);
  }
}

function atomicJson(file, value, options = {}) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const bytes = Buffer.from(JSON.stringify(value));
  const temporary = file + ".tmp-" + process.pid + "-" + crypto.randomBytes(8).toString("hex");
  writeFileDurable(temporary, bytes);
  try {
    if (options.exclusive) fs.linkSync(temporary, file);
    else fs.renameSync(temporary, file);
    syncDirectory(directory);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const reread = fs.readFileSync(file);
  if (!reread.equals(bytes)) throw new Error("WAL receipt verification failed");
  return sha256(bytes);
}

function readReceipt(file) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  const required = ["version", "requestId", "action", "requestHash", "state", "fixedNow", "beforeFingerprint",
    "afterFingerprint", "domainRef", "httpStatus", "response", "createdAt", "completedAt"];
  if (!value || Object.keys(value).length !== required.length || required.some(key => !Object.prototype.hasOwnProperty.call(value, key)) ||
      value.version !== 1 || !UUID_RE.test(value.requestId) || !ACTION_FIELDS[value.action] ||
      !/^[0-9a-f]{64}$/.test(value.requestHash) || !["pending", "committed"].includes(value.state) ||
      !isCanonicalUtc(value.fixedNow) || !isCanonicalUtc(value.createdAt) ||
      ![value.beforeFingerprint, value.afterFingerprint, value.domainRef].every(item => item === null || typeof item === "string") ||
      (value.state === "pending" && (value.httpStatus !== null || value.response !== null || value.completedAt !== null)) ||
      (value.state === "committed" && (!Number.isInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599 || !isCanonicalUtc(value.completedAt)))) {
    throw new IdempotencyError("idempotency_recovery_required", "WAL receipt 损坏");
  }
  return value;
}

function assertTokenFree(value, seen = new Set()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new IdempotencyError("invalid_request", "response 不能包含循环引用");
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (["token", "confirmationToken", "content", "bundle", "cookie"].includes(key)) {
      throw new IdempotencyError("invalid_request", "WAL response 包含敏感字段");
    }
    assertTokenFree(item, seen);
  }
  seen.delete(value);
}

class IdempotencyStore {
  constructor(directory, options = {}) {
    this.directory = path.resolve(directory);
    this.now = options.now || (() => new Date());
  }

  fileFor(requestId) {
    if (!UUID_RE.test(requestId || "")) throw new IdempotencyError("invalid_request", "requestId 必须是 UUID");
    return path.join(this.directory, requestId.toLowerCase() + ".json");
  }

  get(requestId) {
    const file = this.fileFor(requestId);
    if (!fs.existsSync(file)) return null;
    return readReceipt(file);
  }

  begin(options) {
    const file = this.fileFor(options.requestId);
    const requestHash = canonicalRequestHash(options.action, options.values);
    const existing = fs.existsSync(file) ? readReceipt(file) : null;
    if (existing) {
      if (existing.action !== options.action || existing.requestHash !== requestHash) {
        throw new IdempotencyError("idempotency_conflict", "requestId 已被不同请求使用");
      }
      return { receipt: existing, replay: existing.state === "committed", created: false };
    }
    const fixedNow = (options.fixedNow || this.now()).toISOString();
    if (!isCanonicalUtc(fixedNow)) throw new IdempotencyError("invalid_timestamp", "fixedNow 非规范 UTC");
    const receipt = {
      version: 1,
      requestId: options.requestId.toLowerCase(),
      action: options.action,
      requestHash,
      state: "pending",
      fixedNow,
      beforeFingerprint: options.beforeFingerprint || null,
      afterFingerprint: options.afterFingerprint || null,
      domainRef: options.domainRef || null,
      httpStatus: null,
      response: null,
      createdAt: fixedNow,
      completedAt: null,
    };
    try {
      atomicJson(file, receipt, { exclusive: true });
      return { receipt, replay: false, created: true };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const winner = readReceipt(file);
      if (winner.action !== options.action || winner.requestHash !== requestHash) {
        throw new IdempotencyError("idempotency_conflict", "requestId 并发冲突");
      }
      return { receipt: winner, replay: winner.state === "committed", created: false };
    }
  }

  commit(requestId, httpStatus, response, completedAt) {
    assertTokenFree(response);
    const file = this.fileFor(requestId);
    const receipt = readReceipt(file);
    if (receipt.state === "committed") return receipt;
    const timestamp = (completedAt || this.now()).toISOString();
    if (!isCanonicalUtc(timestamp)) throw new IdempotencyError("invalid_timestamp", "completedAt 非规范 UTC");
    const committed = { ...receipt, state: "committed", httpStatus, response, completedAt: timestamp };
    atomicJson(file, committed);
    return readReceipt(file);
  }

  reconcile(inspect) {
    if (!fs.existsSync(this.directory)) return { committed: 0, retryable: 0, blocked: [] };
    let committed = 0;
    let retryable = 0;
    const blocked = [];
    for (const name of fs.readdirSync(this.directory).filter(name => name.endsWith(".json")).sort()) {
      const file = path.join(this.directory, name);
      const receipt = readReceipt(file);
      if (receipt.state === "committed") continue;
      const result = inspect(receipt);
      if (result.fingerprint === receipt.afterFingerprint || result.terminal) {
        this.commit(receipt.requestId, result.httpStatus, result.response, result.completedAt);
        committed++;
      } else if (result.fingerprint === receipt.beforeFingerprint) {
        retryable++;
      } else {
        blocked.push(receipt.requestId);
      }
    }
    if (blocked.length) throw new IdempotencyError("idempotency_recovery_required", "存在无法判定的 pending WAL", { requestIds: blocked });
    return { committed, retryable, blocked };
  }

  prune(options = {}) {
    if (!fs.existsSync(this.directory)) return [];
    const now = options.now === undefined ? this.now().getTime() : options.now;
    const max = options.max === undefined ? 2000 : options.max;
    const age = options.ageMs === undefined ? 7 * 86_400_000 : options.ageMs;
    const committed = fs.readdirSync(this.directory).filter(name => name.endsWith(".json")).map(name => {
      const file = path.join(this.directory, name);
      return { file, receipt: readReceipt(file) };
    }).filter(item => item.receipt.state === "committed").sort((a, b) => Date.parse(b.receipt.completedAt) - Date.parse(a.receipt.completedAt));
    const removed = [];
    for (let index = 0; index < committed.length; index++) {
      const item = committed[index];
      if (index >= max || now - Date.parse(item.receipt.completedAt) > age) {
        fs.unlinkSync(item.file);
        removed.push(item.receipt.requestId);
      }
    }
    if (removed.length) syncDirectory(this.directory);
    return removed;
  }
}

module.exports = {
  ACTION_FIELDS,
  IdempotencyError,
  IdempotencyStore,
  atomicJson,
  canonicalRequest,
  canonicalRequestHash,
  readReceipt,
  syncDirectory,
  writeFileDurable,
};
