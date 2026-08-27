"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { BackupTransactionManager } = require("./backup-transaction");
const { canonicalRequestHash } = require("./idempotency");
const {
  ConfirmationTokens,
  RecoveryService,
  discoverCandidates,
  rankCandidates,
} = require("./recovery");
const { bundle, cleanup, managerOptions: fixtureManagerOptions, REQUEST_ID, workspace } = require("./fixtures/recovery/helpers");

function managerOptions(context, overrides = {}) {
  return { ...fixtureManagerOptions(context, overrides), lockFactory: () => ({ release() {} }) };
}

(async () => {
  const missingRecoveryId = "00000000-0000-4000-8000-000000000000";
  const context = workspace("recovery-old-");
  try {
    let crashed = false;
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const manager = new BackupTransactionManager(managerOptions(context, { fault: point => {
      if (!crashed && point === "old_ready:data") {
        crashed = true;
        const error = new Error("crash");
        error.simulatedCrash = true;
        throw error;
      }
    } }));
    await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: id });
    await assert.rejects(manager.commit(id), /crash/);
    const recoveryManager = new BackupTransactionManager(managerOptions(context));
    const service = new RecoveryService(recoveryManager, { now: () => new Date("2026-08-14T02:00:00.000Z") });
    const inspection = service.inspect(id);
    assert.strictEqual(inspection.selection, "selected");
    assert.strictEqual(inspection.suggestedCandidate, "verified-old");
    assert.strictEqual(inspection.modified, false);
    const issued = service.issueRestoreToken(id, "verified-old");
    assert.throws(() => service.issueRestoreToken(id, "missing"), error => error.code === "invalid_request");
    const recoveryRequestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const result = await service.restoreOld(id, "verified-old", issued.token, { requestId: recoveryRequestId });
    assert.strictEqual(result.terminalResult, "restored_old");
    assert.strictEqual(result.receipt, "committed");
    assert.ok(fs.readFileSync(context.paths.data, "utf8").includes("Original"));
    assert.deepStrictEqual(await service.restoreOld(id, "verified-old", "already-consumed", { requestId: recoveryRequestId }), result);
    await assert.rejects(service.restoreOld(id, "verified-old", issued.token), error => error.code === "state_changed" || error.code === "invalid_request");
    assert.ok(service.status().transactions.length);
    const damagedActive = path.join(context.controlDir, "recovery-imports", "active.json");
    fs.mkdirSync(path.dirname(damagedActive), { recursive: true });
    fs.writeFileSync(damagedActive, "{");
    assert.deepStrictEqual(service.status().activeRecoveryImport, { state: "corrupt", code: "manual_recovery_required" });
    assert.strictEqual(service.status().state, "recovery_required");
  } finally { cleanup(context); }

  const importContext = workspace("recovery-import-");
  try {
    const manager = new BackupTransactionManager(managerOptions(importContext));
    const service = new RecoveryService(manager, { now: () => new Date("2026-08-14T03:00:00.000Z") });
    const prepared = await service.prepareImport(bundle("Recovery import"), {
      recoveryPrepareId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      underlyingTransactionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      requestId: REQUEST_ID,
      originRecoveryState: "data_missing",
    });
    assert.strictEqual(prepared.recoveryPrepareId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    assert.deepStrictEqual(await service.prepareImport(bundle("Recovery import"), { requestId: REQUEST_ID }), prepared);
    await assert.rejects(service.prepareImport(bundle("Different recovery"), { requestId: REQUEST_ID }), error => error.code === "idempotency_conflict");
    assert.strictEqual(service.status().activeRecoveryImport.state, "prepared");
    await assert.rejects(service.prepareImport(bundle()), error => error.code === "transaction_busy");
    const token = service.issueImportToken(prepared.recoveryPrepareId);
    const importRequestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const result = await service.commitImport(prepared.recoveryPrepareId, token.token, { requestId: importRequestId });
    assert.strictEqual(result.terminalResult, "backup_restored");
    assert.deepStrictEqual(await service.commitImport(prepared.recoveryPrepareId, "already-consumed", { requestId: importRequestId }), result);
    assert.ok(fs.readFileSync(importContext.paths.data, "utf8").includes("Recovery import"));
    assert.strictEqual(fs.existsSync(path.join(importContext.controlDir, "recovery-imports", "active.json")), false);
    assert.strictEqual(fs.existsSync(path.join(importContext.controlDir, "recovery-imports", prepared.recoveryPrepareId, "active.final.json")), true);
    assert.deepStrictEqual(await service.commitImport(prepared.recoveryPrepareId, "unused", { requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }), result);
    const finalPointer = path.join(importContext.controlDir, "recovery-imports", prepared.recoveryPrepareId, "active.final.json");
    fs.copyFileSync(finalPointer, path.join(importContext.controlDir, "recovery-imports", "active.json"));
    await service.recoverImport(prepared.recoveryPrepareId);
    assert.strictEqual(fs.existsSync(path.join(importContext.controlDir, "recovery-imports", "active.json")), false);
    assert.deepStrictEqual(await service.prepareImport(bundle("Recovery import"), { requestId: REQUEST_ID }), prepared);
    await assert.rejects(service.prepareImport(bundle("Different after completion"), { requestId: REQUEST_ID }), error => error.code === "idempotency_conflict");
  } finally { cleanup(importContext); }

  const candidates = [
    { name: "a", valid: true, manifestEvidence: true, rank: 1, manifests: ["1"] },
    { name: "b", valid: true, manifestEvidence: true, rank: 1, manifests: ["2"] },
  ];
  assert.strictEqual(rankCandidates([]).result, "none");
  assert.strictEqual(rankCandidates(candidates).result, "ambiguous");
  assert.strictEqual(rankCandidates([{ ...candidates[0] }]).candidate.name, "a");
  assert.strictEqual(rankCandidates([{ ...candidates[0] }, { ...candidates[0], name: "z" }]).result, "selected");
  assert.deepStrictEqual(discoverCandidates({ id: "x", targets: [] }), []);

  const failedImport = workspace("recovery-import-failed-");
  try {
    const manager = new BackupTransactionManager(managerOptions(failedImport));
    const service = new RecoveryService(manager, { now: () => new Date("2026-08-14T04:00:00.000Z") });
    const prepared = await service.prepareImport(bundle(), {
      recoveryPrepareId: "18181818-1818-4818-8818-181818181818",
      underlyingTransactionId: "19191919-1919-4919-8919-191919191919",
      requestId: REQUEST_ID,
    });
    const token = service.issueImportToken(prepared.recoveryPrepareId);
    const commit = manager.commit.bind(manager);
    manager.commit = async () => { throw new Error("injected commit failure"); };
    await assert.rejects(service.commitImport(prepared.recoveryPrepareId, token.token), /injected/);
    const journal = JSON.parse(fs.readFileSync(service.recoveryFile(prepared.recoveryPrepareId), "utf8"));
    assert.strictEqual(journal.state, "rescue_importing");
    await assert.rejects(service.commitImport(prepared.recoveryPrepareId, "unused"), error => error.code === "transaction_busy");
    manager.commit = commit;
    const recovered = await service.recoverImport(prepared.recoveryPrepareId);
    assert.strictEqual(recovered.terminalResult, "backup_restored");
    assert.strictEqual((await service.recoverImport(prepared.recoveryPrepareId)).terminalResult, "backup_restored");
  } finally { cleanup(failedImport); }

  const rolledBackImport = workspace("recovery-import-rolled-back-");
  try {
    const manager = new BackupTransactionManager(managerOptions(rolledBackImport, { fault: point => {
      if (point === "live_ready:data") fs.appendFileSync(rolledBackImport.paths.data, "corrupt");
    } }));
    const service = new RecoveryService(manager, { now: () => new Date("2026-08-14T05:00:00.000Z") });
    const prepared = await service.prepareImport(bundle("Will roll back"), {
      recoveryPrepareId: "26262626-2626-4626-8626-262626262626",
      underlyingTransactionId: "27272727-2727-4727-8727-272727272727",
      requestId: "28282828-2828-4828-8828-282828282828",
    });
    const token = service.issueImportToken(prepared.recoveryPrepareId);
    await assert.rejects(service.commitImport(prepared.recoveryPrepareId, token.token, {
      requestId: "29292929-2929-4929-8929-292929292929",
    }), error => error.code === "commit_failed_rolled_back");
    const journal = JSON.parse(fs.readFileSync(service.recoveryFile(prepared.recoveryPrepareId), "utf8"));
    assert.strictEqual(journal.state, "rescue_rolled_back");
    assert.strictEqual(fs.existsSync(path.join(rolledBackImport.controlDir, "recovery-imports", "active.json")), false);
  } finally { cleanup(rolledBackImport); }

  const statusManager = { controlDir: "x", transactionsDir: "missing" };
  const statusService = new RecoveryService(statusManager);
  statusService.transactionIds = () => ["a", "b"];
  statusService.inspect = id => ({ transactionId: id, state: "manual_recovery", selection: "selected" });
  assert.strictEqual(statusService.status().selection, "ambiguous");
  statusService.transactionIds = () => ["a"];
  assert.strictEqual(statusService.status().selection, "selected");
  statusService.transactionIds = () => [];
  assert.strictEqual(statusService.status().selection, "none");
  assert.strictEqual(statusService.replay(null, "recovery.retry", {}), null);
  statusService.idempotency = { get: () => ({ action: "other", requestHash: "bad" }) };
  assert.throws(() => statusService.replay(REQUEST_ID, "recovery.retry", { transactionId: null }), error => error.code === "idempotency_conflict");
  statusService.idempotency = { get: () => ({
    action: "recovery.retry",
    requestHash: canonicalRequestHash("recovery.retry", { transactionId: null }),
    state: "pending",
    response: null,
  }) };
  assert.strictEqual(statusService.replay(REQUEST_ID, "recovery.retry", { transactionId: null }), null);

  const randomImport = workspace("recovery-random-ids-");
  try {
    const manager = new BackupTransactionManager(managerOptions(randomImport));
    const service = new RecoveryService(manager, { now: () => new Date("2026-08-14T06:00:00.000Z") });
    assert.throws(() => service.recoveryFile("../escape"), error => error.code === "invalid_request");
    assert.throws(() => service.recoveryFile(""), error => error.code === "invalid_request");
    await assert.rejects(service.prepareImport(bundle(), { requestId: "bad" }), error => error.code === "invalid_request");
    await assert.rejects(service.prepareImport(bundle(), { recoveryPrepareId: "bad" }), error => error.code === "invalid_request");
    await assert.rejects(service.prepareImport(bundle(), { underlyingTransactionId: "bad" }), error => error.code === "invalid_request");
    const prepared = await service.prepareImport(bundle("Random IDs"));
    assert.strictEqual(prepared.recoveryPrepareId.length, 36);
    await assert.rejects(service.recoverImport(prepared.recoveryPrepareId), error => error.code === "transaction_busy");
    await assert.rejects(service.recoverImport(missingRecoveryId), error => error.code === "transaction_not_found");
    const journal = JSON.parse(fs.readFileSync(service.recoveryFile(prepared.recoveryPrepareId), "utf8"));
    assert.strictEqual(journal.requestId.length, 36);
    assert.throws(() => service.finalizeActive({ ...journal, recoveryPrepareId: "wrong" }), error => error.code === "manual_recovery_required");
    assert.throws(() => service.saveRecovery({ ...journal, recoveryPrepareId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), error => error.code === "manual_recovery_required");
    const finalPointer = path.join(randomImport.controlDir, "recovery-imports", prepared.recoveryPrepareId, "active.final.json");
    fs.writeFileSync(finalPointer, "{}");
    assert.throws(() => service.finalizeActive(journal), error => error.code === "manual_recovery_required");
    fs.unlinkSync(finalPointer);
    journal.state = "rescue_rolled_back";
    journal.terminalResult = "rescue_restored";
    journal.result = null;
    fs.writeFileSync(service.recoveryFile(prepared.recoveryPrepareId), JSON.stringify(journal));
    assert.strictEqual((await service.recoverImport(prepared.recoveryPrepareId)).terminalResult, "rescue_restored");
  } finally { cleanup(randomImport); }

  let now = 0;
  const tokens = new ConfirmationTokens({ now: () => now });
  const issued = tokens.issue("a", "b", "c");
  now = 11 * 60 * 1000;
  assert.throws(() => tokens.consume(issued.token, "a", "b", "c"), error => error.code === "state_changed");

  const fakeManager = {
    controlDir: "x", transactionsDir: "missing", load: () => ({ id: "x", targets: [] }),
    externalVolumeLock: {},
    restoreOld: async () => { throw new (require("./backup-transaction").TransactionError)("manual_recovery_required", "blocked"); },
  };
  assert.strictEqual(new RecoveryService(fakeManager).inspect("x").selection, "none");
  const fakeService = new RecoveryService(fakeManager);
  fakeService.inspect = () => ({ candidates: [{ name: "verified-old", kind: "old", fingerprint: "f" }] });
  fakeService.tokens.issue = () => ({ token: "t" });
  fakeService.tokens.consume = () => true;
  fakeService.idempotency = { get: () => null, begin: () => ({}), commit: () => ({}) };
  await assert.rejects(fakeService.restoreOld("x", "verified-old", "t"), error => error.code === "manual_recovery_required");
  fakeService.inspect = () => ({ candidates: [] });
  await assert.rejects(fakeService.restoreOld("x", "verified-old", "t"), error => error.code === "state_changed");
  fakeService.inspect = () => ({ candidates: [{ name: "verified-old", kind: "old", fingerprint: "f" }] });
  fakeManager.restoreOld = async () => { throw new Error("generic recovery failure"); };
  await assert.rejects(fakeService.restoreOld("x", "verified-old", "t"), /generic recovery failure/);
  assert.throws(() => fakeService.issueImportToken(missingRecoveryId), error => error.code === "transaction_not_found");
  await assert.rejects(fakeService.commitImport(missingRecoveryId, "x"), error => error.code === "transaction_not_found");

  console.log("recovery: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
