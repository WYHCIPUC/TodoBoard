"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  BackupTransactionManager,
  canonicalTargets,
  fingerprintTargets,
  manifestHash,
  manifestMatches,
  readStableFile,
  renameWithRetry,
  requiredSpace,
  targetManifest,
  volumeIdFor,
} = require("./backup-transaction");
const { bundle, cleanup, managerOptions: fixtureManagerOptions, REQUEST_ID, TRANSACTION_ID, workspace } = require("./fixtures/recovery/helpers");

function managerOptions(context, overrides = {}) {
  return {
    ...fixtureManagerOptions(context, overrides),
    lockFactory: overrides.lockFactory || (() => ({ release() {} })),
  };
}

function expectCode(promise, code) {
  return assert.rejects(promise, error => error.code === code);
}

(async () => {
  const fixtureRoot = path.join(__dirname, "fixtures", "v2.2", "transactions");
  const manifestContext = workspace("manifest-");
  try {
    const fileManifest = targetManifest(manifestContext.paths.data, "file", TRANSACTION_ID, "data");
    assert.strictEqual(fileManifest.existed, true);
    assert.strictEqual(manifestHash(fileManifest).length, 64);
    assert.strictEqual(manifestMatches(manifestContext.paths.data, fileManifest), true);
    const missingManifest = targetManifest(path.join(manifestContext.root, "missing"), "file", TRANSACTION_ID, "data");
    assert.deepStrictEqual(missingManifest, { version: 1, transactionId: TRANSACTION_ID, scope: "data", rootType: "file", existed: false, bytes: 0, sha256: null });
    const directoryManifest = targetManifest(manifestContext.paths.entries, "directory", TRANSACTION_ID, "entries");
    assert.strictEqual(directoryManifest.fileCount, 1);
    assert.strictEqual(manifestMatches(manifestContext.paths.entries, fileManifest), false);
    assert.throws(() => readStableFile(manifestContext.paths.entries), error => error.code === "invalid_storage_topology");
    assert.ok(volumeIdFor(path.join(manifestContext.root, "missing", "target")));
    const defaultsManager = new BackupTransactionManager({ ...managerOptions(manifestContext), now: undefined });
    assert.ok(defaultsManager.now() instanceof Date);
    assert.strictEqual(fingerprintTargets(canonicalTargets(manifestContext.paths, manifestContext.controlDir)).length, 64);
    assert.strictEqual(requiredSpace(100, 200), 100 + 64 * 1024 * 1024);
    assert.ok(JSON.parse(fs.readFileSync(path.join(fixtureRoot, "file-target-manifest.json"), "utf8")));
  } finally { cleanup(manifestContext); }

  const context = workspace("transaction-commit-");
  try {
    const manager = new BackupTransactionManager(managerOptions(context));
    const prepared = await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: TRANSACTION_ID });
    assert.strictEqual(prepared.transactionId, TRANSACTION_ID);
    assert.strictEqual(prepared.requiredByVolume.length, 1);
    assert.deepStrictEqual(await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: TRANSACTION_ID }), prepared);
    await expectCode(manager.prepare(bundle("Different"), { requestId: REQUEST_ID, transactionId: TRANSACTION_ID }), "idempotency_conflict");
    assert.strictEqual(manager.load(TRANSACTION_ID).state, "prepared");
    const committed = await manager.commit(TRANSACTION_ID);
    assert.deepStrictEqual(committed, { committed: true, rolledBack: false });
    assert.strictEqual(manager.load(TRANSACTION_ID).state, "completed");
    assert.strictEqual((await manager.commit(TRANSACTION_ID)).committed, true);
    assert.deepStrictEqual(await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: TRANSACTION_ID }), prepared);
    assert.ok(fs.readFileSync(context.paths.data, "utf8").includes("Restored"));
    assert.strictEqual((await manager.restoreOld(TRANSACTION_ID)).modified, true);
    assert.strictEqual((await manager.restoreOld(TRANSACTION_ID)).modified, false);
  } finally { cleanup(context); }

  const legacyRemovedContext = workspace("transaction-v1-removed-");
  try {
    const removedUid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    fs.mkdirSync(path.join(legacyRemovedContext.paths.entries, removedUid));
    fs.writeFileSync(path.join(legacyRemovedContext.paths.entries, removedUid, "notes.md"), "removed notes");
    const manager = new BackupTransactionManager(managerOptions(legacyRemovedContext));
    const id = "abababab-abab-4bab-8bab-abababababab";
    await manager.prepare({
      format: "linggan-backup",
      version: 1,
      data: require("./fixtures/recovery/helpers").dataText("Legacy overlay"),
      entries: [],
    }, { requestId: "acacacac-acac-4cac-8cac-acacacacacac", transactionId: id });
    await manager.commit(id);
    assert.strictEqual(fs.existsSync(path.join(legacyRemovedContext.paths.entries, removedUid)), false);
    assert.strictEqual(fs.readFileSync(path.join(legacyRemovedContext.paths.orphans, id, "removed-entries", removedUid, "notes.md"), "utf8"), "removed notes");
  } finally { cleanup(legacyRemovedContext); }

  const lockContext = workspace("transaction-native-lock-");
  try {
    let acquired = 0;
    let released = 0;
    const lockFactory = resources => {
      acquired++;
      assert.ok(resources.includes(lockContext.controlDir));
      assert.strictEqual(resources.length, 6);
      return { release() { released++; } };
    };
    const manager = new BackupTransactionManager(managerOptions(lockContext, { lockFactory }));
    const id = "adadadad-adad-4dad-8dad-adadadadadad";
    await manager.prepare(bundle(), { requestId: "aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae", transactionId: id });
    await manager.commit(id);
    assert.strictEqual(acquired, 2);
    assert.strictEqual(released, 2);
  } finally { cleanup(lockContext); }

  const unicodeContext = workspace("可信恢复 中文 空格-");
  try {
    const manager = new BackupTransactionManager(managerOptions(unicodeContext));
    const id = "afafafaf-afaf-4faf-8faf-afafafafafaf";
    await manager.prepare(bundle("Unicode path"), { requestId: "b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0", transactionId: id });
    await manager.commit(id);
    assert.ok(fs.readFileSync(unicodeContext.paths.data, "utf8").includes("Unicode path"));
  } finally { cleanup(unicodeContext); }

  const cancelledContext = workspace("transaction-cancel-");
  try {
    const manager = new BackupTransactionManager(managerOptions(cancelledContext));
    const id = "44444444-4444-4444-8444-444444444444";
    await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: id });
    assert.deepStrictEqual(await manager.cancel(id), { cancelled: true });
    assert.deepStrictEqual(await manager.cancel(id), { cancelled: true });
    await expectCode(manager.commit(id), "transaction_busy");
  } finally { cleanup(cancelledContext); }

  const changedContext = workspace("transaction-changed-");
  try {
    const manager = new BackupTransactionManager(managerOptions(changedContext));
    const id = "55555555-5555-4555-8555-555555555555";
    await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: id });
    fs.appendFileSync(changedContext.paths.data, "changed");
    await expectCode(manager.commit(id), "state_changed");
  } finally { cleanup(changedContext); }

  const stageChangedContext = workspace("transaction-stage-changed-");
  try {
    const manager = new BackupTransactionManager(managerOptions(stageChangedContext));
    const id = "30303030-3030-4030-8030-303030303030";
    await manager.prepare(bundle(), { requestId: "31313131-3131-4131-8131-313131313131", transactionId: id });
    const target = manager.load(id).targets.find(item => item.scope === "data");
    fs.appendFileSync(target.stage, "tampered");
    await expectCode(manager.commit(id), "state_changed");
    assert.ok(fs.readFileSync(stageChangedContext.paths.data, "utf8").includes("Original"));
  } finally { cleanup(stageChangedContext); }

  const capacityContext = workspace("transaction-capacity-");
  try {
    const manager = new BackupTransactionManager(managerOptions(capacityContext, { statfs: () => ({ bavail: 0n, bsize: 1n }) }));
    await expectCode(manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: "66666666-6666-4666-8666-666666666666" }), "insufficient_space");
    assert.strictEqual(fs.readFileSync(capacityContext.paths.data, "utf8").includes("Original"), true);
  } finally { cleanup(capacityContext); }

  const volumeContext = workspace("transaction-volume-");
  try {
    const manager = new BackupTransactionManager(managerOptions(volumeContext, {
      volumeIdProvider: target => target.includes(".stage") ? "wrong-volume" : "live-volume",
    }));
    await expectCode(manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: "77777777-7777-4777-8777-777777777777" }), "invalid_storage_topology");
  } finally { cleanup(volumeContext); }

  const crashContext = workspace("transaction-crash-");
  try {
    let crashed = false;
    const crash = point => {
      if (!crashed && point === "old_ready:data") {
        crashed = true;
        const error = new Error("simulated process crash");
        error.simulatedCrash = true;
        throw error;
      }
    };
    const id = "88888888-8888-4888-8888-888888888888";
    const crashingManager = new BackupTransactionManager(managerOptions(crashContext, { fault: crash }));
    await crashingManager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: id });
    await assert.rejects(crashingManager.commit(id), /simulated process crash/);
    assert.strictEqual(fs.existsSync(crashContext.paths.data), false);
    const recoveryManager = new BackupTransactionManager(managerOptions(crashContext));
    const result = await recoveryManager.recover(id);
    assert.deepStrictEqual(result, { state: "completed", terminalResult: "rolled_back" });
    assert.ok(fs.readFileSync(crashContext.paths.data, "utf8").includes("Original"));
    assert.strictEqual((await recoveryManager.recover(id)).state, "completed");
  } finally { cleanup(crashContext); }

  const verifyContext = workspace("transaction-verify-");
  try {
    const id = "99999999-9999-4999-8999-999999999999";
    const manager = new BackupTransactionManager(managerOptions(verifyContext, {
      fault: point => {
        if (point === "live_ready:data") fs.appendFileSync(verifyContext.paths.data, "corrupt");
      },
    }));
    await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: id });
    await expectCode(manager.commit(id), "commit_failed_rolled_back");
    assert.ok(fs.readFileSync(verifyContext.paths.data, "utf8").includes("Original"));
  } finally { cleanup(verifyContext); }

  const retrySource = path.join(process.env.LINGGAN_TEST_ROOT || process.cwd(), "rename-source.tmp");
  const retryTarget = retrySource + ".done";
  fs.writeFileSync(retrySource, "x");
  let attempts = 0;
  renameWithRetry(retrySource, retryTarget, (source, target) => {
    attempts++;
    if (attempts < 3) throw Object.assign(new Error("busy"), { code: "EBUSY" });
    fs.renameSync(source, target);
  });
  assert.strictEqual(attempts, 3);
  fs.unlinkSync(retryTarget);

  assert.throws(() => renameWithRetry("a", "b", () => { throw Object.assign(new Error("denied"), { code: "ENOSPC" }); }), error => error.code === "ENOSPC");
  let exhausted = 0;
  assert.throws(() => renameWithRetry("a", "b", () => { exhausted++; throw Object.assign(new Error("busy"), { code: "EBUSY" }); }), error => error.code === "EBUSY");
  assert.strictEqual(exhausted, 6);

  const edgeContext = workspace("transaction-edges-");
  try {
    assert.throws(() => canonicalTargets({ ...edgeContext.paths, entries: path.join(edgeContext.controlDir, "entries") }, edgeContext.controlDir), error => error.code === "invalid_storage_topology");
    assert.throws(() => canonicalTargets({ ...edgeContext.paths, entries: path.dirname(edgeContext.paths.brainstorms) }, edgeContext.controlDir), error => error.code === "invalid_storage_topology");
    assert.throws(() => targetManifest(edgeContext.paths.entries, "file", TRANSACTION_ID, "data"), error => error.code === "invalid_storage_topology");
    const manager = new BackupTransactionManager(managerOptions(edgeContext));
    await expectCode(manager.withExternalVolumeLock(null, async () => {}), "invalid_request");
    await expectCode(manager.withExternalVolumeLock({}, async () => {}), "invalid_request");
    const externalSession = { release() {} };
    assert.strictEqual(await manager.withExternalVolumeLock(externalSession, () => manager.withVolumeLocks(() => 42)), 42);
    assert.throws(() => manager.load("00000000-0000-4000-8000-000000000000"), error => error.code === "transaction_not_found");
    assert.throws(() => manager.load("../escape"), error => error.code === "invalid_request");
    await expectCode(manager.prepare(bundle(), { requestId: "bad", transactionId: TRANSACTION_ID }), "invalid_request");
    const random = await manager.prepare(bundle());
    assert.strictEqual(random.transactionId.length, 36);
    await expectCode(manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: random.transactionId }), "transaction_busy");
    assert.strictEqual(manager.inspect(random.transactionId).targets.length, 5);
    const randomJournal = manager.load(random.transactionId);
    fs.unlinkSync(path.join(randomJournal.targets[0].sidecar, "stage.manifest.json"));
    assert.strictEqual(manager.inspect(random.transactionId).targets[0].stage.valid, false);
    await manager.cancel(random.transactionId);
    assert.deepStrictEqual(await manager.cancel(random.transactionId), { cancelled: true });
    const collisionId = "20202020-2020-4020-8020-202020202020";
    fs.writeFileSync(edgeContext.paths.data + ".import-" + collisionId + ".stage", "collision");
    await expectCode(manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: collisionId }), "transaction_busy");
    const corruptId = "23232323-2323-4323-8323-232323232323";
    fs.mkdirSync(path.dirname(manager.journalFile(corruptId)), { recursive: true });
    fs.writeFileSync(manager.journalFile(corruptId), "{");
    assert.throws(() => manager.load(corruptId), error => error.code === "manual_recovery_required");
  } finally { cleanup(edgeContext); }

  const expiryContext = workspace("transaction-expiry-");
  try {
    let current = new Date("2026-08-14T00:00:00.000Z");
    const manager = new BackupTransactionManager(managerOptions(expiryContext, { now: () => current }));
    const id = "12121212-1212-4212-8212-121212121212";
    await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: id });
    assert.strictEqual((await manager.recover(id)).state, "prepared");
    fs.rmSync(manager.load(id).targets[0].stage);
    current = new Date("2026-08-16T00:00:00.000Z");
    assert.strictEqual((await manager.recover(id)).state, "expired");
    await expectCode(manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: id }), "transaction_expired");
    await expectCode(manager.cancel(id), "transaction_expired");
    await expectCode(manager.commit(id), "transaction_expired");

    const preparing = "13131313-1313-4313-8313-131313131313";
    current = new Date("2026-08-14T00:00:00.000Z");
    await manager.prepare(bundle(), { requestId: "14141414-1414-4414-8414-141414141414", transactionId: preparing });
    const journal = manager.load(preparing); journal.state = "preparing"; manager.save(journal);
    await expectCode(manager.cancel(preparing), "transaction_busy");
    assert.strictEqual((await manager.recover(preparing)).state, "expired");
  } finally { cleanup(expiryContext); }

  const oldCollisionContext = workspace("transaction-old-collision-");
  try {
    const manager = new BackupTransactionManager(managerOptions(oldCollisionContext));
    const id = "24242424-2424-4424-8424-242424242424";
    await manager.prepare(bundle(), { requestId: "25252525-2525-4525-8525-252525252525", transactionId: id });
    fs.writeFileSync(oldCollisionContext.paths.data + ".import-" + id + ".old", "collision");
    await expectCode(manager.commit(id), "transaction_busy");
  } finally { cleanup(oldCollisionContext); }

  const committedCrashContext = workspace("transaction-committed-crash-");
  try {
    const id = "15151515-1515-4515-8515-151515151515";
    const manager = new BackupTransactionManager(managerOptions(committedCrashContext, { fault: point => {
      if (point === "committed") { const error = new Error("committed crash"); error.simulatedCrash = true; throw error; }
    } }));
    await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: id });
    await assert.rejects(manager.commit(id), /committed crash/);
    const recovered = await new BackupTransactionManager(managerOptions(committedCrashContext)).recover(id);
    assert.deepStrictEqual(recovered, { state: "completed", terminalResult: "committed" });
  } finally { cleanup(committedCrashContext); }

  const noLiveContext = workspace("transaction-no-live-");
  try {
    fs.rmSync(noLiveContext.paths.trash, { recursive: true });
    fs.rmSync(noLiveContext.paths.orphans, { recursive: true });
    const id = "16161616-1616-4616-8616-161616161616";
    const manager = new BackupTransactionManager(managerOptions(noLiveContext, { fault: point => {
      if (point === "live_ready:orphans") fs.writeFileSync(path.join(noLiveContext.paths.orphans, "corrupt.bin"), "x");
    } }));
    await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: id });
    await expectCode(manager.commit(id), "commit_failed_rolled_back");
    assert.strictEqual(fs.existsSync(noLiveContext.paths.trash), false);
    assert.strictEqual(fs.existsSync(noLiveContext.paths.orphans), false);
  } finally { cleanup(noLiveContext); }

  const manualContext = workspace("transaction-manual-");
  try {
    const id = "17171717-1717-4717-8717-171717171717";
    const manager = new BackupTransactionManager(managerOptions(manualContext, { fault: point => {
      if (point === "live_ready:data") {
        fs.appendFileSync(manualContext.paths.data, "corrupt");
        fs.rmSync(manualContext.paths.data + ".import-" + id + ".old");
      }
    } }));
    await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: id });
    await expectCode(manager.commit(id), "manual_recovery_required");
    const recovery = new BackupTransactionManager(managerOptions(manualContext));
    await expectCode(recovery.recover(id), "manual_recovery_required");
    const journal = recovery.load(id); journal.state = "unknown"; recovery.save(journal);
    await expectCode(recovery.recover(id), "manual_recovery_required");
  } finally { cleanup(manualContext); }

  const crossVolumeContext = workspace("transaction-cross-volume-");
  try {
    const id = "21212121-2121-4121-8121-212121212121";
    const volumes = new Map(Object.entries(crossVolumeContext.paths).map(([scope, live]) => [path.dirname(live) + path.sep + path.basename(live), "volume-" + scope]));
    const volumeIdProvider = target => {
      for (const [live, volume] of volumes) {
        if (target === live || target.startsWith(live + ".import-")) return volume;
      }
      throw new Error("unmapped fixture volume: " + target);
    };
    let stopped = false;
    const manager = new BackupTransactionManager(managerOptions(crossVolumeContext, { volumeIdProvider, fault: point => {
      if (!stopped && point === "live_ready:brainstorms") {
        stopped = true;
        const error = new Error("cross-volume crash"); error.simulatedCrash = true; throw error;
      }
    } }));
    await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: id });
    assert.strictEqual(new Set(manager.load(id).targets.map(target => target.volumeId)).size, 5);
    await assert.rejects(manager.commit(id), /cross-volume crash/);
    const recovered = await new BackupTransactionManager(managerOptions(crossVolumeContext, { volumeIdProvider })).recover(id);
    assert.strictEqual(recovered.terminalResult, "rolled_back");
    assert.ok(fs.readFileSync(crossVolumeContext.paths.data, "utf8").includes("Original"));
    assert.strictEqual(fs.readFileSync(path.join(crossVolumeContext.paths.entries, require("./fixtures/recovery/helpers").UID, "notes.md"), "utf8"), "old notes");
  } finally { cleanup(crossVolumeContext); }

  console.log("backup-transaction: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
