"use strict";

const assert = require("assert");
const fs = require("fs");
const { BackupTransactionManager } = require("./backup-transaction");
const { EXIT, help, parseArgs, run } = require("../scripts/recover");
const { bundle, cleanup, managerOptions: fixtureManagerOptions, REQUEST_ID, workspace } = require("./fixtures/recovery/helpers");

function managerOptions(context, overrides = {}) {
  return { ...fixtureManagerOptions(context, overrides), lockFactory: () => ({ release() {} }) };
}

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    io: { stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function args(context) {
  return [
    "--data", context.paths.data,
    "--entries", context.paths.entries,
    "--brainstorms", context.paths.brainstorms,
    "--trash", context.paths.trash,
    "--orphans", context.paths.orphans,
    "--control-dir", context.controlDir,
  ];
}

(async () => {
  assert.strictEqual(parseArgs(["--dry-run", "--json"]).json, true);
  assert.throws(() => parseArgs(["--unknown"]), /未知参数/);
  assert.throws(() => parseArgs(["--apply"]), /--interactive/);
  assert.match(help(), /默认只读 dry-run/);

  const empty = workspace("recover-cli-empty-");
  try {
    const output = capture();
    const code = await run([...args(empty), "--json"], { io: output.io });
    assert.strictEqual(code, EXIT.NO_CANDIDATE);
    const body = JSON.parse(output.stdout());
    assert.strictEqual(body.dryRun, true);
    assert.strictEqual(body.modified, false);
  } finally { cleanup(empty); }

  const context = workspace("recover-cli-apply-");
  try {
    const transactionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    let crashed = false;
    const manager = new BackupTransactionManager(managerOptions(context, { fault: point => {
      if (!crashed && point === "old_ready:data") {
        crashed = true;
        const error = new Error("crash");
        error.simulatedCrash = true;
        throw error;
      }
    } }));
    await manager.prepare(bundle(), { requestId: REQUEST_ID, transactionId });
    await assert.rejects(manager.commit(transactionId));

    const dry = capture();
    const dryCode = await run([...args(context), "--transaction", transactionId, "--json"], { io: dry.io });
    assert.strictEqual(dryCode, EXIT.OK);
    assert.strictEqual(JSON.parse(dry.stdout()).inspection.suggestedCandidate, "verified-old");
    assert.strictEqual(fs.existsSync(context.paths.data), false);

    const held = new Set();
    const nativeBinding = {
      getVolumeId: () => "fixture-volume",
      isRemote: () => false,
      acquire: id => held.has(id) ? null : (held.add(id), { id }),
      release: handle => held.delete(handle.id),
    };
    const applied = capture();
    const applyCode = await run([
      ...args(context), "--transaction", transactionId, "--candidate", "verified-old", "--apply", "--interactive", "--json",
    ], {
      io: applied.io,
      nativeBinding,
      ask: question => /([0-9a-f]{8})/.exec(question)[1],
    });
    assert.strictEqual(applyCode, EXIT.OK);
    assert.strictEqual(JSON.parse(applied.stdout()).modified, true);
    assert.ok(fs.readFileSync(context.paths.data, "utf8").includes("Original"));

    const cancelled = workspace("recover-cli-cancel-");
    try {
      const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      let stopped = false;
      const crashManager = new BackupTransactionManager(managerOptions(cancelled, { fault: point => {
        if (!stopped && point === "old_ready:data") {
          stopped = true;
          const error = new Error("crash"); error.simulatedCrash = true; throw error;
        }
      } }));
      await crashManager.prepare(bundle(), { requestId: REQUEST_ID, transactionId: id });
      await assert.rejects(crashManager.commit(id));
      const output = capture();
      const code = await run([...args(cancelled), "--transaction", id, "--candidate", "verified-old", "--apply", "--interactive", "--json"], {
        io: output.io, nativeBinding, ask: () => "cancel",
      });
      assert.strictEqual(code, EXIT.CANCELLED);
      assert.strictEqual(JSON.parse(output.stdout()).modified, false);
    } finally { cleanup(cancelled); }
  } finally { cleanup(context); }

  const usage = capture();
  assert.strictEqual(await run(["--apply"], { io: usage.io }), EXIT.USAGE);
  const helpOutput = capture();
  assert.strictEqual(await run(["--help"], { io: helpOutput.io }), EXIT.OK);
  assert.match(helpOutput.stdout(), /用法/);
  console.log("recover-cli: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
