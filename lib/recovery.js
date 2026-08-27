"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { IdempotencyStore, atomicJson, canonicalRequestHash, syncDirectory } = require("./idempotency");
const { manifestHash, manifestMatches, targetManifest, TransactionError } = require("./backup-transaction");
const { UUID_RE, parseBundle, sha256 } = require("./backup-format");

const TOKEN_TTL_MS = 10 * 60 * 1000;

class RecoveryError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "RecoveryError";
    this.code = code;
    this.details = details || null;
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; }
}

function candidateFingerprint(candidate) {
  return sha256(Buffer.from(JSON.stringify({
    transactionId: candidate.transactionId,
    name: candidate.name,
    kind: candidate.kind,
    manifests: candidate.manifests,
  })));
}

function inspectGeneration(journal, kind) {
  const targets = [];
  let valid = journal.targets.length > 0;
  for (const target of journal.targets) {
    const manifestFile = path.join(target.sidecar, kind + ".manifest.json");
    const manifest = readJson(manifestFile);
    let present;
    let matches;
    if (!manifest) {
      present = fs.existsSync(target[kind]);
      matches = false;
    } else if (!manifest.existed) {
      present = fs.existsSync(target[kind]);
      matches = !present && (kind !== "old" || !fs.existsSync(target.live));
    } else {
      present = fs.existsSync(target[kind]);
      matches = manifestMatches(target[kind], manifest);
      if (!matches && kind === "old" && manifestMatches(target.live, manifest)) matches = true;
      if (!matches && kind === "stage" && manifestMatches(target.live, manifest)) matches = true;
    }
    targets.push({ scope: target.scope, present, valid: matches, manifestHash: manifest ? manifestHash(manifest) : null });
    if (!matches) valid = false;
  }
  return { valid, targets };
}

function discoverCandidates(journal) {
  const candidates = [];
  const old = inspectGeneration(journal, "old");
  const stage = inspectGeneration(journal, "stage");
  if (old.valid) {
    const candidate = {
      transactionId: journal.id,
      name: "verified-old",
      kind: "old",
      completeScopes: journal.targets.map(target => target.scope),
      valid: true,
      manifestEvidence: true,
      rank: 1,
      manifests: old.targets.map(target => target.manifestHash),
    };
    candidate.fingerprint = candidateFingerprint(candidate);
    candidates.push(candidate);
  }
  if (stage.valid) {
    const candidate = {
      transactionId: journal.id,
      name: "verified-stage",
      kind: "stage",
      completeScopes: journal.targets.map(target => target.scope),
      valid: true,
      manifestEvidence: true,
      rank: 2,
      manifests: stage.targets.map(target => target.manifestHash),
    };
    candidate.fingerprint = candidateFingerprint(candidate);
    candidates.push(candidate);
  }
  return candidates.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

function rankCandidates(candidates) {
  const valid = candidates.filter(candidate => candidate.valid && candidate.manifestEvidence && Number.isInteger(candidate.rank));
  if (!valid.length) return { result: "none", candidate: null };
  const rank = Math.min(...valid.map(candidate => candidate.rank));
  const best = valid.filter(candidate => candidate.rank === rank);
  const generations = new Set(best.map(candidate => JSON.stringify(candidate.manifests)));
  if (generations.size > 1) return { result: "ambiguous", candidate: null, candidates: best };
  return { result: "selected", candidate: best[0] };
}

class ConfirmationTokens {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.tokens = new Map();
  }

  currentTime() {
    const value = this.now();
    return value instanceof Date ? value.getTime() : Number(value);
  }

  issue(action, targetKey, stateFingerprint) {
    const token = crypto.randomBytes(16).toString("base64url");
    const record = { action, targetKey, stateFingerprint, expiresAt: this.currentTime() + TOKEN_TTL_MS };
    this.tokens.set(token, record);
    return { token, expiresAt: new Date(record.expiresAt).toISOString() };
  }

  consume(token, action, targetKey, stateFingerprint) {
    const record = this.tokens.get(token);
    this.tokens.delete(token);
    if (!record || record.expiresAt <= this.currentTime() || record.action !== action || record.targetKey !== targetKey || record.stateFingerprint !== stateFingerprint) {
      throw new RecoveryError("state_changed", "确认 token 已过期、已使用或与当前状态不匹配");
    }
    return true;
  }
}

class RecoveryService {
  constructor(manager, options = {}) {
    this.manager = manager;
    this.controlDir = manager.controlDir;
    this.recoveryDir = path.join(this.controlDir, "recovery-imports");
    this.tokens = options.tokens || new ConfirmationTokens(options);
    this.now = options.now || (() => new Date());
    this.idempotency = options.idempotency || new IdempotencyStore(path.join(this.controlDir, "idempotency"), { now: this.now });
  }

  transactionIds() {
    if (!fs.existsSync(this.manager.transactionsDir)) return [];
    return fs.readdirSync(this.manager.transactionsDir).filter(name => fs.existsSync(this.manager.journalFile(name))).sort();
  }

  inspect(transactionId) {
    const journal = this.manager.load(transactionId);
    const candidates = discoverCandidates(journal);
    const ranking = rankCandidates(candidates);
    return {
      transactionId,
      state: journal.state,
      candidates,
      selection: ranking.result,
      suggestedCandidate: ranking.candidate ? ranking.candidate.name : null,
      requiresConfirmation: Boolean(ranking.candidate),
      modified: false,
    };
  }

  status() {
    const transactions = this.transactionIds().map(id => this.inspect(id));
    const activeFile = path.join(this.recoveryDir, "active.json");
    const activeValue = readJson(activeFile);
    const active = fs.existsSync(activeFile) && !activeValue ? { state: "corrupt", code: "manual_recovery_required" } : activeValue;
    const selections = transactions.filter(item => item.selection === "selected");
    const selection = transactions.some(item => item.selection === "ambiguous") || selections.length > 1 ? "ambiguous" :
      selections.length === 1 ? "selected" : "none";
    return {
      state: active || transactions.some(item => item.state === "manual_recovery") ? "recovery_required" : "normal",
      selection,
      suggestedTransaction: selection === "selected" ? selections[0].transactionId : null,
      transactions,
      activeRecoveryImport: active,
    };
  }

  issueRestoreToken(transactionId, candidateName) {
    const inspection = this.inspect(transactionId);
    const candidate = inspection.candidates.find(item => item.name === candidateName && item.kind === "old");
    if (!candidate) throw new RecoveryError("invalid_request", "只能确认完整 verified-old 候选");
    return this.tokens.issue("restore-old", transactionId, candidate.fingerprint);
  }

  replay(requestId, action, values) {
    if (!requestId) return null;
    const receipt = this.idempotency.get(requestId);
    if (!receipt) return null;
    if (receipt.action !== action || receipt.requestHash !== canonicalRequestHash(action, values)) {
      throw new RecoveryError("idempotency_conflict", "requestId 已绑定其他恢复操作");
    }
    return receipt.state === "committed" ? receipt.response : null;
  }

  async restoreOld(transactionId, candidateName, token, options = {}) {
    if (!options.locked && !this.manager.externalVolumeLock) {
      return this.manager.withVolumeLocks(session => this.manager.withExternalVolumeLock(session,
        () => this.restoreOld(transactionId, candidateName, token, { ...options, locked: true })));
    }
    const requestId = options.requestId || crypto.randomUUID();
    const replayed = this.replay(requestId, "recovery.restore-old", { transactionId });
    if (replayed) return replayed;
    const inspection = this.inspect(transactionId);
    const candidate = inspection.candidates.find(item => item.name === candidateName && item.kind === "old");
    if (!candidate) throw new RecoveryError("state_changed", "old 候选不再完整");
    this.tokens.consume(token, "restore-old", transactionId, candidate.fingerprint);
    this.idempotency.begin({
      requestId,
      action: "recovery.restore-old",
      values: { transactionId },
      beforeFingerprint: candidate.fingerprint,
      afterFingerprint: candidate.fingerprint,
      domainRef: transactionId,
    });
    try {
      const result = await this.manager.restoreOld(transactionId);
      const verified = this.inspect(transactionId).candidates.find(item => item.name === candidateName && item.kind === "old");
      if (!verified || verified.fingerprint !== candidate.fingerprint) {
        throw new RecoveryError("manual_recovery_required", "恢复后 verified old 复验失败");
      }
      const response = { ...result, operationId: requestId, receipt: "committed" };
      this.idempotency.commit(requestId, 200, response);
      return response;
    } catch (error) {
      if (error instanceof TransactionError) throw new RecoveryError(error.code, error.message, error.details);
      throw error;
    }
  }

  recoveryFile(id) {
    if (!UUID_RE.test(id || "")) throw new RecoveryError("invalid_request", "recoveryPrepareId 必须是 UUID");
    return path.join(this.recoveryDir, id, "transaction.json");
  }

  findRecoveryByRequestId(requestId) {
    if (!requestId || !fs.existsSync(this.recoveryDir)) return null;
    for (const name of fs.readdirSync(this.recoveryDir).sort()) {
      if (!UUID_RE.test(name)) continue;
      const file = this.recoveryFile(name);
      if (!fs.existsSync(file)) continue;
      const journal = readJson(file);
      if (!journal) throw new RecoveryError("manual_recovery_required", "recovery journal 损坏");
      if (journal.requestId === requestId) return journal;
    }
    return null;
  }

  saveRecovery(journal) {
    const activeFile = path.join(this.recoveryDir, "active.json");
    if (fs.existsSync(activeFile)) {
      const active = readJson(activeFile);
      if (!active || active.activeRecoveryImportId !== journal.recoveryPrepareId) {
        throw new RecoveryError("manual_recovery_required", "拒绝覆盖不匹配的 active recovery pointer");
      }
    }
    atomicJson(this.recoveryFile(journal.recoveryPrepareId), journal);
    atomicJson(activeFile, {
      version: 1,
      activeRecoveryImportId: journal.recoveryPrepareId,
      kind: journal.kind,
      originRecoveryState: journal.originRecoveryState,
      originalTransactionId: journal.originalTransactionId,
      descriptorSha256: journal.descriptorSha256,
      state: journal.state,
      terminalResult: journal.terminalResult,
      updatedAt: journal.updatedAt,
    });
  }

  finalizeActive(journal) {
    const active = path.join(this.recoveryDir, "active.json");
    const current = readJson(active);
    if (!current || current.activeRecoveryImportId !== journal.recoveryPrepareId) {
      throw new RecoveryError("manual_recovery_required", "active recovery pointer 与事务不一致");
    }
    const destination = path.join(this.recoveryDir, journal.recoveryPrepareId, "active.final.json");
    if (fs.existsSync(destination)) {
      const final = readJson(destination);
      if (!final || final.activeRecoveryImportId !== journal.recoveryPrepareId) {
        throw new RecoveryError("manual_recovery_required", "final recovery pointer 冲突");
      }
      if (fs.existsSync(active)) fs.unlinkSync(active);
    } else {
      fs.renameSync(active, destination);
    }
    syncDirectory(this.recoveryDir);
    syncDirectory(path.dirname(destination));
  }

  async prepareImport(bundle, options = {}) {
    if (!options.locked && !this.manager.externalVolumeLock) {
      return this.manager.withVolumeLocks(session => this.manager.withExternalVolumeLock(session,
        () => this.prepareImport(bundle, { ...options, locked: true })));
    }
    for (const value of [options.recoveryPrepareId, options.underlyingTransactionId, options.requestId]) {
      if (value !== undefined && !UUID_RE.test(value || "")) throw new RecoveryError("invalid_request", "recovery/transaction/request ID 必须是 UUID");
    }
    const activeFile = path.join(this.recoveryDir, "active.json");
    if (fs.existsSync(activeFile)) {
      const active = readJson(activeFile);
      const existing = active && active.activeRecoveryImportId ? readJson(this.recoveryFile(active.activeRecoveryImportId)) : null;
      if (existing && options.requestId && existing.requestId === options.requestId && existing.prepareResult) {
        const parsed = parseBundle(bundle, { createdAt: this.now().toISOString() });
        if (parsed.hash !== existing.bundleSha256) throw new RecoveryError("idempotency_conflict", "requestId 已绑定其他 recovery bundle");
        return existing.prepareResult;
      }
      throw new RecoveryError("transaction_busy", "已有 recovery import");
    }
    const prior = this.findRecoveryByRequestId(options.requestId);
    if (prior && prior.prepareResult) {
      const parsed = parseBundle(bundle, { createdAt: this.now().toISOString() });
      if (parsed.hash !== prior.bundleSha256) throw new RecoveryError("idempotency_conflict", "requestId 已绑定其他 recovery bundle");
      return prior.prepareResult;
    }
    const recoveryPrepareId = options.recoveryPrepareId || crypto.randomUUID();
    const underlyingTransactionId = options.underlyingTransactionId || crypto.randomUUID();
    const requestId = options.requestId || crypto.randomUUID();
    const prepared = await this.manager.prepare(bundle, { transactionId: underlyingTransactionId, requestId });
    const descriptor = {
      version: 1,
      recoveryPrepareId,
      kind: "restore_backup",
      originRecoveryState: options.originRecoveryState || "normal",
      originalTransactionId: options.originalTransactionId || null,
      bundleSha256: prepared.bundleHash,
      underlyingTransactionId,
      requestId,
    };
    const journal = {
      ...descriptor,
      descriptorSha256: sha256(Buffer.from(JSON.stringify(descriptor))),
      state: "prepared",
      expiresAt: prepared.expiresAt,
      terminalResult: null,
      createdAt: this.now().toISOString(),
      updatedAt: this.now().toISOString(),
    };
    journal.prepareResult = { recoveryPrepareId, bundleHash: prepared.bundleHash, expiresAt: prepared.expiresAt, transactionId: underlyingTransactionId };
    this.saveRecovery(journal);
    return journal.prepareResult;
  }

  issueImportToken(recoveryPrepareId) {
    const journal = readJson(this.recoveryFile(recoveryPrepareId));
    if (!journal || journal.state !== "prepared") throw new RecoveryError("transaction_not_found", "recovery import 不可确认");
    const transaction = this.manager.load(journal.underlyingTransactionId);
    const fingerprint = sha256(Buffer.from(JSON.stringify({ descriptorSha256: journal.descriptorSha256, state: journal.state, liveFingerprint: transaction.liveFingerprint })));
    return this.tokens.issue("recovery/import", recoveryPrepareId, fingerprint);
  }

  async commitImport(recoveryPrepareId, token, options = {}) {
    if (!options.locked && !this.manager.externalVolumeLock) {
      return this.manager.withVolumeLocks(session => this.manager.withExternalVolumeLock(session,
        () => this.commitImport(recoveryPrepareId, token, { ...options, locked: true })));
    }
    const journal = readJson(this.recoveryFile(recoveryPrepareId));
    if (!journal) throw new RecoveryError("transaction_not_found", "recovery import 不存在或状态非法");
    const requestId = options.requestId || crypto.randomUUID();
    const replayed = this.replay(requestId, "recovery.import", { recoveryPrepareId });
    if (replayed) return replayed;
    if (journal.state === "completed" && journal.result) return journal.result;
    if (journal.state !== "prepared") throw new RecoveryError("transaction_busy", "recovery import 需要先收敛", { state: journal.state });
    const transaction = this.manager.load(journal.underlyingTransactionId);
    const fingerprint = sha256(Buffer.from(JSON.stringify({ descriptorSha256: journal.descriptorSha256, state: journal.state, liveFingerprint: transaction.liveFingerprint })));
    this.tokens.consume(token, "recovery/import", recoveryPrepareId, fingerprint);
    this.idempotency.begin({
      requestId,
      action: "recovery.import",
      values: { recoveryPrepareId },
      beforeFingerprint: transaction.liveFingerprint,
      afterFingerprint: journal.bundleSha256,
      domainRef: recoveryPrepareId,
    });
    journal.state = "rescue_importing";
    journal.expiresAt = null;
    journal.operationId = requestId;
    journal.updatedAt = this.now().toISOString();
    this.saveRecovery(journal);
    try {
      const result = await this.manager.commit(journal.underlyingTransactionId);
      journal.state = "completed";
      journal.terminalResult = "backup_restored";
      journal.updatedAt = this.now().toISOString();
      journal.result = { ...result, recoveryPrepareId, terminalResult: journal.terminalResult, operationId: requestId, receipt: "committed" };
      this.saveRecovery(journal);
      this.finalizeActive(journal);
      this.idempotency.commit(requestId, 200, journal.result);
      return journal.result;
    } catch (error) {
      const underlying = this.manager.load(journal.underlyingTransactionId);
      if (underlying.state === "completed" && underlying.terminalResult === "rolled_back") {
        journal.state = "rescue_rolled_back";
        journal.terminalResult = "rescue_restored";
        journal.updatedAt = this.now().toISOString();
        this.saveRecovery(journal);
        this.finalizeActive(journal);
        this.idempotency.commit(requestId, 500, {
          ok: false,
          code: error.code || "commit_failed_rolled_back",
          recoveryPrepareId,
          terminalResult: journal.terminalResult,
          operationId: requestId,
          receipt: "committed",
        });
      }
      throw error;
    }
  }

  async recoverImport(recoveryPrepareId, options = {}) {
    if (!options.locked && !this.manager.externalVolumeLock) {
      return this.manager.withVolumeLocks(session => this.manager.withExternalVolumeLock(session,
        () => this.recoverImport(recoveryPrepareId, { locked: true })));
    }
    const journal = readJson(this.recoveryFile(recoveryPrepareId));
    if (!journal) throw new RecoveryError("transaction_not_found", "recovery import 不存在");
    if (["completed", "rescue_rolled_back"].includes(journal.state)) {
      if (fs.existsSync(path.join(this.recoveryDir, "active.json"))) this.finalizeActive(journal);
      return journal.result || { state: journal.state, terminalResult: journal.terminalResult };
    }
    if (journal.state !== "rescue_importing") throw new RecoveryError("transaction_busy", "recovery import 当前不可收敛", { state: journal.state });
    const underlying = this.manager.load(journal.underlyingTransactionId);
    const result = underlying.state === "prepared" ?
      await this.manager.commit(journal.underlyingTransactionId) :
      await this.manager.recover(journal.underlyingTransactionId);
    if (result.committed || result.terminalResult === "committed") {
      journal.state = "completed";
      journal.terminalResult = "backup_restored";
      journal.result = { ...result, recoveryPrepareId, terminalResult: journal.terminalResult, modified: false, operationId: journal.operationId || null, receipt: "committed" };
    } else {
      journal.state = "rescue_rolled_back";
      journal.terminalResult = "rescue_restored";
      journal.result = { ...result, recoveryPrepareId, terminalResult: journal.terminalResult, modified: false, operationId: journal.operationId || null, receipt: "committed" };
    }
    journal.updatedAt = this.now().toISOString();
    this.saveRecovery(journal);
    this.finalizeActive(journal);
    if (journal.operationId && this.idempotency.get(journal.operationId)?.state === "pending") {
      this.idempotency.commit(journal.operationId, journal.state === "completed" ? 200 : 500, journal.result);
    }
    return journal.result;
  }
}

module.exports = {
  ConfirmationTokens,
  RecoveryError,
  RecoveryService,
  TOKEN_TTL_MS,
  candidateFingerprint,
  discoverCandidates,
  inspectGeneration,
  rankCandidates,
};
