"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const upgrade = require("./upgrade");
const { acquireInstanceLock } = require("./instance-lock");
const cli = require("../scripts/upgrade-snapshot");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "upgrade-snapshot-cli-"));
const UID = "99999999-9999-4999-8999-999999999999";
const paths = {
  dataFile: path.join(root, "DATA.md"),
  entriesDir: path.join(root, "entries"),
  brainstormsDir: path.join(root, "brainstorms"),
  trashDir: path.join(root, "trash"),
  orphansDir: path.join(root, "orphans"),
  controlDir: path.join(root, ".linggan"),
};
for (const directory of [paths.entriesDir, paths.brainstormsDir, paths.trashDir, paths.orphansDir, path.join(paths.entriesDir, UID)]) {
  fs.mkdirSync(directory, { recursive: true });
}
fs.writeFileSync(paths.dataFile, `# CLI\n<!-- linggan:data-version=2 -->\n## 1. X\n### ⏳ 1.1 Restore\n<!-- linggan:uid=${UID} -->\n`, "utf8");
fs.writeFileSync(path.join(paths.entriesDir, UID, "notes.md"), "snapshot notes", "utf8");
const args = ["--data", paths.dataFile, "--entries", paths.entriesDir, "--brainstorms", paths.brainstormsDir, "--trash", paths.trashDir, "--orphans", paths.orphansDir, "--control-dir", paths.controlDir];

function output() {
  const result = { stdout: "", stderr: "" };
  result.io = {
    stdout: { write: text => { result.stdout += text; } },
    stderr: { write: text => { result.stderr += text; } },
  };
  return result;
}

(async () => {
  try {
    assert.throws(() => cli.parseArgs(["--apply"]), /interactive/);
    assert.throws(() => cli.parseArgs(["--restore", "x", "--apply", "--interactive", "--hash", "bad"]), /SHA-256/);

    const snapshot = upgrade.createUpgradeSnapshot({ ...paths, namePrefix: "pre-cli-" });
    const listIo = output();
    assert.strictEqual(await cli.run([...args, "--list", "--json"], { io: listIo.io }), cli.EXIT.OK);
    const listed = JSON.parse(listIo.stdout);
    assert.strictEqual(listed.snapshots.some(item => item.name === snapshot.name && item.restorable), true);

    fs.writeFileSync(paths.dataFile, "# Mutated\n", "utf8");
    fs.writeFileSync(path.join(paths.entriesDir, UID, "notes.md"), "mutated notes", "utf8");

    const lock = acquireInstanceLock(paths.controlDir);
    const lockedIo = output();
    assert.strictEqual(await cli.run([...args, "--restore", snapshot.name, "--hash", snapshot.manifestSha256, "--apply", "--interactive", "--json"], { io: lockedIo.io, ask: async () => "00000000" }), cli.EXIT.LOCKED);
    lock.release();

    const restoreIo = output();
    const code = await cli.run([...args, "--restore", snapshot.name, "--hash", snapshot.manifestSha256, "--apply", "--interactive", "--json"], {
      io: restoreIo.io,
      acquireLocks: () => ({ release() {} }),
      ask: question => question.match(/([0-9a-f]{8})/)[1],
    });
    assert.strictEqual(code, cli.EXIT.OK, restoreIo.stderr + restoreIo.stdout);
    const restored = JSON.parse(restoreIo.stdout);
    assert.strictEqual(restored.modified, true);
    assert.ok(restored.result.rescueSnapshot);
    assert.strictEqual(fs.readFileSync(paths.dataFile, "utf8"), `# CLI\n<!-- linggan:data-version=2 -->\n## 1. X\n### ⏳ 1.1 Restore\n<!-- linggan:uid=${UID} -->\n`);
    assert.strictEqual(fs.readFileSync(path.join(paths.entriesDir, UID, "notes.md"), "utf8"), "snapshot notes");

    const missingIo = output();
    assert.strictEqual(await cli.run([...args, "--restore", "missing", "--hash", "0".repeat(64), "--apply", "--interactive", "--json"], { io: missingIo.io, ask: async () => "x" }), cli.EXIT.NOT_FOUND);

    assert.throws(() => cli.parseArgs(["--remigrate", "bad", "--apply", "--interactive"]), /UUID/);
    const remigrateId = "33333333-3333-4333-8333-333333333333";
    const remigrateIo = output();
    let remigrateOptions = null;
    const remigrateCode = await cli.run([...args, "--remigrate", remigrateId, "--apply", "--interactive", "--json"], {
      io: remigrateIo.io,
      acquireLocks: () => ({ release() {} }),
      ask: question => question.match(/([0-9a-f]{8})/)[1],
      remigrate: async options => { remigrateOptions = options; return { state: "completed" }; },
    });
    assert.strictEqual(remigrateCode, cli.EXIT.OK, remigrateIo.stderr + remigrateIo.stdout);
    assert.strictEqual(remigrateOptions.recoveryPrepareId, remigrateId);
    assert.strictEqual(JSON.parse(remigrateIo.stdout).modified, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("upgrade-snapshot-cli: ALL PASS");
})().catch(error => { console.error(error); process.exit(1); });
