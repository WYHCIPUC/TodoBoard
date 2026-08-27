"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const backup = require("./backup");
const { UID, REQUEST_ID, TRANSACTION_ID, bundle, cleanup, dataText, workspace } = require("./fixtures/recovery/helpers");

(async () => {
  const context = workspace("backup-v2-");
  try {
    const defaults = backup.defaultPaths({ dataFile: context.paths.data });
    assert.strictEqual(defaults.data, context.paths.data);
    assert.ok(defaults.controlDir.endsWith(".linggan"));
    fs.writeFileSync(path.join(context.paths.entries, UID, "unknown.dat"), Buffer.from([9, 8, 7]));
    const exported = backup.exportBundle({
      dataFile: context.paths.data,
      entriesDir: context.paths.entries,
      brainstormDir: context.paths.brainstorms,
      trashDir: context.paths.trash,
      orphansDir: context.paths.orphans,
      controlDir: context.controlDir,
      createdAt: "2026-08-14T00:00:00.000Z",
      appVersion: "2.2.0",
    });
    const checked = backup.validateBundle(exported);
    assert.ok(backup.collectExportFiles({ ...context.paths, controlDir: context.controlDir }).files.length > 0);
    assert.strictEqual(exported.version, 2);
    assert.strictEqual(checked.entryCount, 1);
    assert.ok(exported.files.some(file => /orphans\/unclassified\/entries\/.+\/payload\.bin$/.test(file.path)));
    assert.strictEqual(exported.warnings[0].code, "unclassified");
    assert.deepStrictEqual(backup.summary(exported).scopes, ["data", "entries", "brainstorms", "trash", "orphans"]);
    assert.strictEqual(JSON.parse(backup.serializeBundle(exported)).warnings, undefined);

    const restored = bundle();
    const result = await backup.importBundle(restored, {
      dataFile: context.paths.data,
      entriesDir: context.paths.entries,
      brainstormDir: context.paths.brainstorms,
      trashDir: context.paths.trash,
      orphansDir: context.paths.orphans,
      controlDir: context.controlDir,
      requestId: REQUEST_ID,
      transactionId: TRANSACTION_ID,
      now: () => new Date("2026-08-14T01:00:00.000Z"),
      volumeIdProvider: () => "fixture-volume",
      statfs: () => ({ bavail: 1024n * 1024n, bsize: 1024n }),
      lockFactory: () => ({ release() {} }),
    });
    assert.strictEqual(result.committed, true);
    assert.ok(fs.readFileSync(context.paths.data, "utf8").includes("Restored"));
    assert.strictEqual(fs.readFileSync(path.join(context.paths.entries, UID, "notes.md"), "utf8"), "new notes");
    assert.strictEqual(fs.existsSync(path.join(context.paths.entries, UID, "unknown.dat")), false);
    assert.strictEqual(fs.readFileSync(path.join(context.paths.brainstorms, "plan.md"), "utf8"), "new plan");

    const asyncExport = await backup.exportBundleAsync({
      dataFile: context.paths.data,
      entriesDir: context.paths.entries,
      brainstormDir: context.paths.brainstorms,
      trashDir: context.paths.trash,
      orphansDir: context.paths.orphans,
      controlDir: context.controlDir,
      createdAt: "2026-08-14T02:00:00.000Z",
    });
    assert.strictEqual(asyncExport.format, backup.FORMAT);
  } finally {
    cleanup(context);
  }

  const legacyContext = workspace("backup-v1-");
  try {
    fs.writeFileSync(path.join(legacyContext.paths.entries, UID, "attachments.bin"), "preserve");
    const legacy = {
      format: "linggan-backup",
      version: 1,
      data: dataText("Legacy restored"),
      entries: [{ uid: UID, files: [{ name: "notes.md", encoding: "utf8", data: "legacy notes" }] }],
    };
    const result = await backup.importBundle(legacy, {
      dataFile: legacyContext.paths.data,
      entriesDir: legacyContext.paths.entries,
      brainstormDir: legacyContext.paths.brainstorms,
      trashDir: legacyContext.paths.trash,
      orphansDir: legacyContext.paths.orphans,
      controlDir: legacyContext.controlDir,
      requestId: "44444444-4444-4444-8444-444444444444",
      transactionId: "55555555-5555-4555-8555-555555555555",
      now: () => new Date("2026-08-14T03:00:00.000Z"),
      volumeIdProvider: () => "fixture-volume",
      statfs: () => ({ bavail: 1024n * 1024n, bsize: 1024n }),
      lockFactory: () => ({ release() {} }),
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(legacyContext.paths.entries, UID, "attachments.bin"), "utf8"), "preserve");
    assert.strictEqual(fs.readFileSync(path.join(legacyContext.paths.entries, UID, "notes.md"), "utf8"), "legacy notes");
    assert.strictEqual(fs.readFileSync(path.join(legacyContext.paths.brainstorms, "plan.md"), "utf8"), "old plan");
  } finally {
    cleanup(legacyContext);
  }

  const missing = workspace("backup-missing-");
  fs.unlinkSync(missing.paths.data);
  assert.throws(() => backup.exportBundle({ dataFile: missing.paths.data, entriesDir: missing.paths.entries, controlDir: missing.controlDir }), error => error.code === "data_missing");
  cleanup(missing);
  console.log("backup: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
