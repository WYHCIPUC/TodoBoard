"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bootstrap, inspectInstall, validateTopology } = require("./bootstrap");

function fixture(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-" + name + "-"));
  return {
    root, dataFile: path.join(root, "DATA.md"), entriesDir: path.join(root, "entries"), brainstormsDir: path.join(root, "brainstorms"),
    trashDir: path.join(root, "trash"), orphansDir: path.join(root, "orphans"), controlDir: path.join(root, ".linggan"),
  };
}

(async () => {
  const fresh = fixture("fresh");
  const example = path.join(fresh.root, "DATA.example.md");
  fs.writeFileSync(example, "# Data\n<!-- linggan:data-version=2 -->\n", "utf8");
  const events = [];
  const result = await bootstrap({
    ...fresh, exampleFile: example,
    auditLegacy: async () => { events.push("audit"); return { ok: true }; },
    bindBootstrapListener: async () => { events.push("bind"); return { promote: async () => events.push("promote"), close: async () => events.push("listener-close") }; },
    acquireLocks: async () => { events.push("locks"); return { release: async () => events.push("locks-release") }; },
    recoverGlobal: () => events.push("recover"),
    runUpgrade: async options => { events.push("upgrade"); assert.ok(fs.existsSync(options.dataFile), "fresh DATA must precede upgrade"); return { state: "completed" }; },
    archiveFactory: options => { events.push("archive"); assert.strictEqual(options.autoStart, false); return { queue: { start: () => events.push("queue-start") }, stop: () => events.push("archive-stop") }; },
  });
  assert.deepStrictEqual(events, ["audit", "bind", "locks", "recover", "upgrade", "archive"]);
  assert.strictEqual(result.freshInstall, true);
  await result.promote();
  assert.deepStrictEqual(events.slice(-2), ["promote", "queue-start"]);
  await result.release();
  assert.deepStrictEqual(events.slice(-3), ["archive-stop", "locks-release", "listener-close"]);

  const recovered = fixture("recovered-before-classify");
  fs.mkdirSync(recovered.controlDir, { recursive: true });
  fs.writeFileSync(path.join(recovered.controlDir, "recovery-evidence.json"), "{}", "utf8");
  const recoveredResult = await bootstrap({
    ...recovered,
    auditLegacy: async () => ({ ok: true }),
    bindBootstrapListener: async () => ({ close: async () => {} }),
    acquireLocks: async () => ({ release: async () => {} }),
    recoverGlobal: () => fs.writeFileSync(recovered.dataFile, "# Data\n<!-- linggan:data-version=2 -->\n", "utf8"),
    runUpgrade: async () => ({ state: "completed" }),
    archiveFactory: () => ({ queue: { start: () => {} }, stop: () => {} }),
  });
  assert.strictEqual(recoveredResult.state, "ready", "恢复后的 DATA 必须先于缺失判定");
  assert.strictEqual(recoveredResult.freshInstall, false);
  await recoveredResult.release();

  for (const evidence of ["marker-only", "queue-only"]) {
    const item = fixture(evidence);
    fs.mkdirSync(item.controlDir, { recursive: true });
    if (evidence === "marker-only") fs.writeFileSync(path.join(item.controlDir, "app-marker.json"), "{}", "utf8");
    else fs.writeFileSync(path.join(item.controlDir, "archive-jobs.json"), "{}", "utf8");
    const state = await bootstrap({ ...item, auditLegacy: async () => ({ ok: true }), bindBootstrapListener: async () => ({ close: async () => {} }), acquireLocks: async () => ({ release: async () => {} }) });
    assert.strictEqual(state.state, "recovery_required");
    assert.strictEqual(state.code, "data_missing");
    assert.strictEqual(fs.existsSync(item.dataFile), false, "evidence must never be hidden by example DATA");
    await state.release();
  }

  const future = fixture("future");
  fs.writeFileSync(future.dataFile, "# Data\n<!-- linggan:data-version=99 -->\n", "utf8");
  assert.strictEqual(inspectInstall(future).state, "downgrade_rejected");
  const futureBoot = await bootstrap({ ...future, auditLegacy: async () => ({ ok: true }), bindBootstrapListener: async () => ({ close: async () => {} }), acquireLocks: async () => ({ close: async () => {} }) });
  assert.strictEqual(futureBoot.code, "unsupported_version");
  await futureBoot.release();
  let bound = false;
  await assert.rejects(() => bootstrap({ ...future, auditLegacy: async () => ({ ok: false }), bindBootstrapListener: async () => { bound = true; } }), error => error.code === "legacy_instance_may_be_running");
  assert.strictEqual(bound, false, "legacy audit failure must precede listener and all writes");

  const defaults = fixture("defaults");
  fs.writeFileSync(defaults.dataFile, "# Data\n<!-- linggan:data-version=2 -->\n", "utf8");
  const defaultResult = await bootstrap({
    ...defaults,
    acquireLocks: async () => ({ close: async () => {} }),
    runUpgrade: async () => ({ state: "completed" }),
    archiveFactory: () => ({ queue: { start: () => {} }, stop: () => {} }),
  });
  await defaultResult.promote();
  await defaultResult.release();

  const changed = fixture("changed");
  const changedExample = path.join(changed.root, "example.md");
  fs.writeFileSync(changedExample, "# Data\n<!-- linggan:data-version=2 -->\n");
  await assert.rejects(bootstrap({
    ...changed, exampleFile: changedExample,
    auditLegacy: async () => ({ ok: true }),
    bindBootstrapListener: async () => ({ close: async () => {} }),
    acquireLocks: async () => { fs.writeFileSync(changed.dataFile, "changed"); return { release: async () => {} }; },
  }), error => error.code === "state_changed");

  const noExample = fixture("no-example");
  await assert.rejects(bootstrap({
    ...noExample, exampleFile: path.join(noExample.root, "missing-example.md"),
    auditLegacy: async () => ({ ok: true }), bindBootstrapListener: async () => ({ close: async () => {} }), acquireLocks: async () => ({ release: async () => {} }),
  }), error => error.code === "data_missing");

  assert.throws(() => validateTopology({ ...fresh, entriesDir: fresh.root, controlDir: fresh.controlDir }), error => error.code === "invalid_storage_topology");
  assert.throws(() => validateTopology({ ...fresh, controlDir: fresh.entriesDir }), error => error.code === "invalid_storage_topology");
  const queueEvidence = fixture("queue-evidence");
  fs.writeFileSync(path.join(queueEvidence.root, "archive-jobs.json.previous"), "{}");
  assert.strictEqual(require("./bootstrap").hasUserEvidence(queueEvidence), true);
  console.log("bootstrap: ALL PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
