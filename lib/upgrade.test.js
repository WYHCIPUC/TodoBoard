"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const upgrade = require("./upgrade");

/* 迁移合同版本必须独立于产品版本并保持冻结，否则旧 marker/快照会失效。 */
assert.strictEqual(upgrade.MIGRATION_CONTRACT_VERSION, "2.2.0");
assert.strictEqual(upgrade.APP_VERSION, upgrade.MIGRATION_CONTRACT_VERSION);
assert.ok(upgrade.resolvePaths({ dataFile: path.join(os.tmpdir(), "marker-check", "DATA.md") }).markerFile.endsWith(path.join("app-migrations", "2.2.0.json")));

const UID = "77777777-7777-4777-8777-777777777777";
const LONG = "这是升级固定夹具中的足够长正文内容，用于证明旧根正文会在服务开放前转换为 canonical archive 并建立保护代。";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "upgrade-"));
const dataFile = path.join(root, "DATA.md");
const entriesDir = path.join(root, "entries");
const controlDir = path.join(root, ".linggan");
const queueFile = path.join(controlDir, "archive-jobs.json");
const options = {
  dataFile, entriesDir, controlDir, queueFile,
  brainstormsDir: path.join(root, "brainstorms"), trashDir: path.join(root, "trash"), orphansDir: path.join(controlDir, "recovered-orphans"),
  uidFactory: () => UID, now: "2026-08-14T00:00:00.000Z",
};
fs.mkdirSync(path.join(entriesDir, "1.1"), { recursive: true });
fs.mkdirSync(controlDir, { recursive: true });
fs.writeFileSync(dataFile, `# Legacy\n## 1. AI 工具\n### ⏳ 1.1 旧条目\n- **作者 / 来源**：[来源](https://example.invalid/a)\n- **研究要点**：（待补充）\n`, "utf8");
fs.writeFileSync(path.join(entriesDir, "1.1", "notes.md"), "legacy notes", "utf8");
fs.writeFileSync(path.join(entriesDir, "1.1", "content.md"), LONG, "utf8");
fs.writeFileSync(queueFile, JSON.stringify({ version: 1, jobs: [{
  id: "1.1", uid: "1.1", url: "https://example.invalid/a", state: "queued", attempt: 0, nextRunAt: 0,
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", manualContent: "用户手工补录的独立正文",
}] }), "utf8");

(async () => {
  const defaultPaths = upgrade.resolvePaths({ dataFile: path.join(root, "defaults", "DATA.md") });
  assert.strictEqual(defaultPaths.controlDir, path.join(root, "defaults", ".linggan"));
  assert.strictEqual(defaultPaths.entriesDir, path.join(root, "defaults", "docs", "entries"));
  assert.strictEqual(defaultPaths.queueFile, path.join(defaultPaths.controlDir, "archive-jobs.json"));
  const priorPathEnvironment = {
    ENTRIES_DIR: process.env.ENTRIES_DIR,
    BRAINSTORM_DIR: process.env.BRAINSTORM_DIR,
    TRASH_DIR: process.env.TRASH_DIR,
    RECOVERED_ORPHANS_DIR: process.env.RECOVERED_ORPHANS_DIR,
  };
  process.env.ENTRIES_DIR = path.join(root, "env-entries");
  process.env.BRAINSTORM_DIR = path.join(root, "env-brainstorms");
  process.env.TRASH_DIR = path.join(root, "env-trash");
  process.env.RECOVERED_ORPHANS_DIR = path.join(root, "env-orphans");
  const environmentPaths = upgrade.resolvePaths({ dataFile: path.join(root, "env", "DATA.md") });
  assert.strictEqual(environmentPaths.entriesDir, process.env.ENTRIES_DIR);
  assert.strictEqual(environmentPaths.brainstormsDir, process.env.BRAINSTORM_DIR);
  assert.strictEqual(environmentPaths.trashDir, process.env.TRASH_DIR);
  assert.strictEqual(environmentPaths.orphansDir, process.env.RECOVERED_ORPHANS_DIR);
  for (const [name, value] of Object.entries(priorPathEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  assert.ok(upgrade.resolvePaths().dataFile);
  const beforeData = fs.readFileSync(dataFile);
  const first = await upgrade.runUpgrade(options);
  assert.strictEqual(first.state, "completed");
  assert.deepStrictEqual(first.marker.steps, { dataSchema: "completed", manualDrafts: "completed", canonicalContent: "completed", lifecycle: "completed" });
  assert.strictEqual(fs.existsSync(path.join(entriesDir, UID, "content.md")), false);
  assert.ok(fs.existsSync(path.join(entriesDir, UID, "archive", "manifest.json")));
  assert.ok(fs.existsSync(path.join(entriesDir, UID, "protected-generations", "current.json")));
  const drafts = fs.readdirSync(path.join(entriesDir, UID, "drafts"));
  assert.strictEqual(drafts.filter(name => name.endsWith(".md")).length, 1);
  assert.strictEqual(fs.readFileSync(queueFile, "utf8").includes("用户手工补录"), false, "queue 不得保留唯一用户正文");

  const snapshots = upgrade.listUpgradeSnapshots(options);
  assert.strictEqual(snapshots.length, 1);
  assert.strictEqual(snapshots[0].restorable, true);
  const snapshotData = fs.readFileSync(path.join(controlDir, "upgrade-snapshots", snapshots[0].name, "targets", "data", "DATA.md"));
  assert.ok(snapshotData.equals(beforeData), "快照必须先于 schema 迁移");
  assert.deepStrictEqual(upgrade.prepareSnapshotRestore(snapshots[0].name, snapshots[0].manifestSha256, options).summary, { targets: 5, runtimeFiles: 2 });
  assert.throws(() => upgrade.prepareSnapshotRestore(snapshots[0].name, "0".repeat(64), options), error => error.code === "snapshot_not_restorable");

  const second = await upgrade.runUpgrade({ ...options, now: "2026-08-15T00:00:00.000Z" });
  assert.strictEqual(second.results.compatibilitySweep.changed, false);
  assert.strictEqual(upgrade.listUpgradeSnapshots(options).length, 1, "重复升级不得再建 full snapshot");

  const currentFile = path.join(entriesDir, UID, "protected-generations", "current.json");
  fs.unlinkSync(currentFile);
  fs.writeFileSync(path.join(entriesDir, UID, "content.md"), LONG + " 二点一新增字节", "utf8");
  const downgrade = await upgrade.runUpgrade({ ...options, now: "2026-08-16T00:00:00.000Z" });
  assert.strictEqual(downgrade.results.compatibilitySweep.changed, true);
  assert.ok(fs.existsSync(currentFile), "降级后 current 缺失应从健康 active 重建");
  assert.strictEqual(fs.existsSync(path.join(entriesDir, UID, "content.md")), false);
  assert.ok(upgrade.listUpgradeSnapshots(options).some(item => item.kind === "post_downgrade_incremental" && !item.restorable));

  fs.rmSync(path.join(entriesDir, UID, "archive"), { recursive: true });
  const restoredFromProtected = await upgrade.runUpgrade({ ...options, now: "2026-08-16T12:00:00.000Z" });
  assert.strictEqual(restoredFromProtected.results.compatibilitySweep.changed, true);
  assert.ok(fs.existsSync(path.join(entriesDir, UID, "archive", "manifest.json")), "active 缺失时必须从 current 保护代恢复");

  fs.writeFileSync(queueFile, JSON.stringify([{ id: "1.1", uid: UID, manualContent: "降级期间新人工正文" }]));
  const queueSweep = await upgrade.runUpgrade({ ...options, now: "2026-08-16T18:00:00.000Z" });
  assert.strictEqual(queueSweep.results.compatibilitySweep.changed, true);
  assert.strictEqual(fs.readFileSync(queueFile, "utf8").includes("降级期间新人工正文"), false);
  fs.appendFileSync(path.join(entriesDir, UID, "archive", "content.md"), "corrupt candidate");
  const corruptActiveSweep = await upgrade.runUpgrade({ ...options, now: "2026-08-16T20:00:00.000Z" });
  assert.strictEqual(corruptActiveSweep.results.compatibilitySweep.changed, true);
  assert.ok(fs.existsSync(path.join(options.orphansDir, "downgrade-candidate", UID)), "损坏 active 字节必须先保全");

  const recoveryPrepareId = crypto.randomUUID();
  const remigrated = await upgrade.remigrateUpgrade({ ...options, recoveryPrepareId, sourceState: "ready_for_2_1", now: "2026-08-17T00:00:00.000Z" });
  assert.strictEqual(remigrated.remigrate.state, "verified");
  assert.ok(remigrated.remigrate.snapshotName.startsWith("pre-remigrate-2.2.0-" + recoveryPrepareId));
  const afterRemigrate = await upgrade.runUpgrade({ ...options, now: "2026-08-18T00:00:00.000Z" });
  assert.strictEqual(afterRemigrate.state, "completed");

  assert.deepStrictEqual(upgrade.targetInventory("data", path.join(root, "missing-data")), { scope: "data", rootType: "file", existed: false, bytes: 0, sha256: null });
  assert.strictEqual(upgrade.targetInventory("entries", path.join(root, "missing-dir")).fileCount, 0);
  const badDataTarget = path.join(root, "bad-data-target");
  fs.mkdirSync(badDataTarget);
  assert.throws(() => upgrade.targetInventory("data", badDataTarget), error => error.code === "invalid_storage_topology");
  assert.deepStrictEqual(upgrade.listUpgradeSnapshots({ ...options, snapshotsDir: path.join(root, "none") }), []);
  assert.throws(() => upgrade.prepareSnapshotRestore("../bad", "x", options), error => error.code === "snapshot_not_found");
  await assert.rejects(upgrade.remigrateUpgrade({ ...options, recoveryPrepareId: "bad" }), error => error.code === "invalid_request");

  const freshMarker = upgrade.freshMarker();
  assert.strictEqual(upgrade.validateMarker(freshMarker, upgrade.resolvePaths(options)).freshInstall, true);
  assert.throws(() => upgrade.validateMarker(null, upgrade.resolvePaths(options)), error => error.code === "manual_recovery_required");
  const badSteps = upgrade.freshMarker(); badSteps.steps.dataSchema = "bad";
  assert.throws(() => upgrade.validateMarker(badSteps, upgrade.resolvePaths(options)), error => error.code === "manual_recovery_required");
  const reversed = upgrade.freshMarker(); reversed.steps.manualDrafts = "completed";
  assert.throws(() => upgrade.validateMarker(reversed, upgrade.resolvePaths(options)), error => error.code === "manual_recovery_required");
  const noSnapshot = upgrade.freshMarker(); noSnapshot.freshInstall = false;
  assert.throws(() => upgrade.validateMarker(noSnapshot, upgrade.resolvePaths(options)), error => error.code === "manual_recovery_required");
  const missingSnapshotMarker = upgrade.freshMarker();
  missingSnapshotMarker.freshInstall = false; missingSnapshotMarker.snapshotPath = "missing"; missingSnapshotMarker.snapshotManifestSha256 = "0".repeat(64);
  assert.throws(() => upgrade.validateMarker(missingSnapshotMarker, upgrade.resolvePaths(options)), error => error.code === "manual_recovery_required");

  const extractRoot = path.join(root, "extract-cases");
  const extractOptions = {
    ...options,
    dataFile: path.join(extractRoot, "DATA.md"), entriesDir: path.join(extractRoot, "entries"), controlDir: path.join(extractRoot, ".linggan"),
    queueFile: path.join(extractRoot, ".linggan", "queue.json"), orphansDir: path.join(extractRoot, "orphans"),
  };
  fs.mkdirSync(path.dirname(extractOptions.queueFile), { recursive: true });
  fs.writeFileSync(extractOptions.dataFile, `# Data\n<!-- linggan:data-version=2 -->\n`);
  fs.writeFileSync(extractOptions.queueFile, JSON.stringify([{ id: "missing", manualContent: "orphan content" }, null]));
  assert.strictEqual(upgrade.extractManualDrafts(upgrade.resolvePaths(extractOptions), extractOptions).extracted, 1);
  assert.ok(fs.existsSync(path.join(extractOptions.orphansDir, "legacy-manual-drafts")));
  fs.writeFileSync(extractOptions.queueFile, "bad-json");
  assert.throws(() => upgrade.extractManualDrafts(upgrade.resolvePaths(extractOptions), extractOptions), error => error.code === "manual_recovery_required");
  fs.writeFileSync(extractOptions.queueFile, JSON.stringify({ version: 1, jobs: "bad" }));
  assert.throws(() => upgrade.extractManualDrafts(upgrade.resolvePaths(extractOptions), extractOptions), error => error.code === "manual_recovery_required");

  const checksumCopy = path.join(root, "snapshot-checksum-copy");
  fs.cpSync(path.join(controlDir, "upgrade-snapshots", snapshots[0].name), checksumCopy, { recursive: true });
  fs.appendFileSync(path.join(checksumCopy, "targets", "data", "DATA.md"), "tamper");
  assert.strictEqual(upgrade.verifyUpgradeSnapshot(checksumCopy).reason, "checksum_mismatch");
  assert.strictEqual(upgrade.verifyUpgradeSnapshot(path.join(root, "missing-snapshot")).reason, "unreadable");

  const legacyArchiveRoot = path.join(root, "legacy-archive-case");
  const legacyArchiveOptions = {
    dataFile: path.join(legacyArchiveRoot, "DATA.md"), entriesDir: path.join(legacyArchiveRoot, "entries"), controlDir: path.join(legacyArchiveRoot, ".linggan"),
    brainstormsDir: path.join(legacyArchiveRoot, "brainstorms"), trashDir: path.join(legacyArchiveRoot, "trash"), orphansDir: path.join(legacyArchiveRoot, "orphans"),
  };
  fs.mkdirSync(path.join(legacyArchiveOptions.entriesDir, UID, "archive"), { recursive: true });
  fs.writeFileSync(legacyArchiveOptions.dataFile, `# Data\n<!-- linggan:data-version=2 -->\n## 1. X\n### ⏳ 1.1 Legacy archive\n<!-- linggan:uid=${UID} -->\n`);
  fs.writeFileSync(path.join(legacyArchiveOptions.entriesDir, UID, "archive", "content.md"), LONG);
  const legacyConverted = await upgrade.migrateCanonicalContent(upgrade.resolvePaths(legacyArchiveOptions), legacyArchiveOptions);
  assert.strictEqual(legacyConverted.converted, 1);

  const unusableRoot = path.join(root, "unusable-root");
  const unusableUid = "88888888-8888-4888-8888-888888888888";
  const unusableOptions = {
    ...options,
    dataFile: path.join(unusableRoot, "DATA.md"),
    entriesDir: path.join(unusableRoot, "entries"),
    controlDir: path.join(unusableRoot, ".linggan"),
  };
  fs.mkdirSync(path.join(unusableOptions.entriesDir, unusableUid), { recursive: true });
  fs.writeFileSync(unusableOptions.dataFile, `# Data\n<!-- linggan:data-version=2 -->\n## 1. X\n### ⏳ 1.1 Short root\n<!-- linggan:uid=${unusableUid} -->\n`);
  fs.writeFileSync(path.join(unusableOptions.entriesDir, unusableUid, "content.md"), "short");
  await upgrade.migrateCanonicalContent(upgrade.resolvePaths(unusableOptions), unusableOptions);
  assert.strictEqual(fs.readdirSync(path.join(unusableOptions.entriesDir, unusableUid, "attachments")).length, 1);

  const missingQueueOptions = { ...extractOptions, queueFile: path.join(extractRoot, "missing-queue.json") };
  assert.strictEqual(upgrade.extractManualDrafts(upgrade.resolvePaths(missingQueueOptions), missingQueueOptions).extracted, 0);

  const blockedRoot = path.join(root, "blocked-case");
  const blockedOptions = {
    dataFile: path.join(blockedRoot, "DATA.md"), entriesDir: path.join(blockedRoot, "entries"), controlDir: path.join(blockedRoot, ".linggan"),
    brainstormsDir: path.join(blockedRoot, "brainstorms"), trashDir: path.join(blockedRoot, "trash"), orphansDir: path.join(blockedRoot, "orphans"), freshInstall: true,
    now: "2026-08-19T00:00:00.000Z",
  };
  fs.mkdirSync(path.join(blockedOptions.entriesDir, UID, "archive"), { recursive: true });
  fs.mkdirSync(path.join(blockedOptions.entriesDir, UID, "protected-generations"), { recursive: true });
  fs.writeFileSync(path.join(blockedOptions.entriesDir, UID, "archive", "junk"), "x");
  fs.writeFileSync(blockedOptions.dataFile, `# Data\n<!-- linggan:data-version=2 -->\n## 1. X\n### ⏳ 1.1 Blocked\n<!-- linggan:uid=${UID} -->\n`);
  await assert.rejects(upgrade.runUpgrade(blockedOptions), error => error.code === "manual_recovery_required");

  const full = upgrade.listUpgradeSnapshots(options).find(item => item.name === snapshots[0].name);
  fs.appendFileSync(path.join(controlDir, "upgrade-snapshots", full.name, "manifest.json"), " ");
  assert.strictEqual(upgrade.verifyUpgradeSnapshot(path.join(controlDir, "upgrade-snapshots", full.name)).valid, false);

  const restoreRoot = path.join(root, "restore-case");
  const restoreOptions = {
    dataFile: path.join(restoreRoot, "DATA.md"),
    entriesDir: path.join(restoreRoot, "entries"),
    brainstormsDir: path.join(restoreRoot, "brainstorms"),
    trashDir: path.join(restoreRoot, "trash"),
    orphansDir: path.join(restoreRoot, "orphans"),
    controlDir: path.join(restoreRoot, ".linggan"),
    now: "2026-08-20T00:00:00.000Z",
  };
  fs.mkdirSync(path.join(restoreOptions.entriesDir, UID), { recursive: true });
  fs.mkdirSync(restoreOptions.brainstormsDir, { recursive: true });
  fs.mkdirSync(restoreOptions.trashDir, { recursive: true });
  fs.mkdirSync(restoreOptions.orphansDir, { recursive: true });
  fs.writeFileSync(restoreOptions.dataFile, `# Restore\n<!-- linggan:data-version=2 -->\n## 1. X\n### ⏳ 1.1 Restore\n<!-- linggan:uid=${UID} -->\n`);
  fs.writeFileSync(path.join(restoreOptions.entriesDir, UID, "notes.md"), "restore notes", "utf8");
  const queuePath = path.join(restoreOptions.controlDir, "archive-jobs.json");
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  fs.writeFileSync(queuePath, JSON.stringify({ version: 1, jobs: [{ id: "1.1", uid: UID, url: "https://example.invalid/a", state: "queued", attempt: 0, nextRunAt: 0, createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" }] }), "utf8");
  const restoreSnapshot = upgrade.createUpgradeSnapshot({ ...restoreOptions, namePrefix: "pre-test-restore-" });
  fs.writeFileSync(restoreOptions.dataFile, "# Changed\n", "utf8");
  fs.writeFileSync(path.join(restoreOptions.entriesDir, UID, "extra.txt"), "extra", "utf8");
  fs.writeFileSync(path.join(restoreOptions.entriesDir, UID, "notes.md"), "changed notes", "utf8");
  fs.writeFileSync(queuePath, JSON.stringify({ version: 1, jobs: [] }), "utf8");
  const restored = upgrade.restoreUpgradeSnapshot(restoreSnapshot.name, restoreSnapshot.manifestSha256, restoreOptions);
  assert.strictEqual(restored.state, "restored");
  assert.ok(restored.rescueSnapshot.startsWith("pre-restore-"));
  assert.strictEqual(fs.readFileSync(restoreOptions.dataFile, "utf8"), `# Restore\n<!-- linggan:data-version=2 -->\n## 1. X\n### ⏳ 1.1 Restore\n<!-- linggan:uid=${UID} -->\n`);
  assert.strictEqual(fs.readFileSync(path.join(restoreOptions.entriesDir, UID, "notes.md"), "utf8"), "restore notes");
  assert.strictEqual(fs.existsSync(path.join(restoreOptions.entriesDir, UID, "extra.txt")), false, "恢复必须删除快照之外的当前文件");
  assert.strictEqual(JSON.parse(fs.readFileSync(queuePath, "utf8")).jobs.length, 1, "运行队列必须随快照恢复");
  assert.strictEqual(fs.existsSync(path.join(restoreOptions.controlDir, "app-migrations", "2.2.0.json")), false, "恢复升级前数据后必须删除 marker");

  console.log("upgrade: ALL PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
