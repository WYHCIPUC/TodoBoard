"use strict";

const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  VolumeLockSession,
  acquireVolumeLocks,
  ensureSafeDirectory,
  inspectResourceLock,
  loadNativeBinding,
  normalizeResource,
  resourceLockPath,
} = require("./volume-lock");

function child(script, args) {
  const process_ = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  process_.stdout.on("data", chunk => { stdout += chunk; });
  process_.stderr.on("data", chunk => { stderr += chunk; });
  return { process_, stdout: () => stdout, stderr: () => stderr, done: new Promise(resolve => process_.on("exit", code => resolve(code))) };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "volume-lock-"));
  const resource = path.join(root, "data", "DATA.md");
  const controlDir = path.join(root, "control", ".linggan");
  const heldVolumes = new Set();
  const nativeBinding = {
    getVolumeId: () => "fixture-volume",
    isRemote: () => false,
    acquire: id => heldVolumes.has(id) ? null : (heldVolumes.add(id), { id }),
    release: handle => heldVolumes.delete(handle.id),
  };
  try {
    assert.strictEqual(normalizeResource(resource), path.resolve(resource).normalize("NFC").toLowerCase());
    assert.ok(resourceLockPath(resource).includes(".linggan-owner-"));
    const session = new VolumeLockSession([resource, controlDir, resource], { controlDir, nativeBinding }).acquire();
    assert.strictEqual(session.locks.length, 2);
    assert.strictEqual(session.volumeId(resource), "fixture-volume");
    assert.strictEqual(inspectResourceLock(resource).locked, true);
    assert.throws(() => session.acquire(), error => error.code === "transaction_busy");
    assert.throws(() => new VolumeLockSession([resource], { nativeBinding }).acquire(), error => error.code === "data_in_use");
    session.heartbeat();
    session.release();
    session.heartbeat();
    assert.strictEqual(inspectResourceLock(resource).locked, false);
    assert.strictEqual(heldVolumes.size, 0);
    const directSession = acquireVolumeLocks([resource], { nativeBinding });
    directSession.release();
    const blockedParent = path.join(root, "blocked-parent");
    fs.writeFileSync(blockedParent, "not a directory");
    assert.throws(() => ensureSafeDirectory(path.join(blockedParent, "child")), error => error.code === "invalid_storage_topology");

    const remote = { ...nativeBinding, isRemote: () => true };
    assert.throws(() => new VolumeLockSession([resource], { nativeBinding: remote }).acquire(), error => error.code === "invalid_storage_topology");
    const noId = { ...nativeBinding, getVolumeId: () => "" };
    assert.throws(() => new VolumeLockSession([resource], { nativeBinding: noId }).acquire(), error => error.code === "invalid_storage_topology");
    const denied = { ...nativeBinding, getVolumeId: () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } };
    assert.throws(() => new VolumeLockSession([resource], { nativeBinding: denied }).acquire(), error => error.code === "invalid_storage_topology" && error.details.causeCode === "EACCES");
    const acquireDenied = { ...nativeBinding, acquire: () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } };
    assert.throws(() => new VolumeLockSession([resource], { nativeBinding: acquireDenied }).acquire(), error => error.code === "invalid_storage_topology" && error.details.causeCode === "EACCES");
    assert.throws(() => loadNativeBinding({ bindingPath: path.join(root, "missing.node") }), error => error.code === "invalid_storage_topology");

    const lockPath = resourceLockPath(resource);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "not a directory");
    assert.strictEqual(inspectResourceLock(resource).evidence, "invalid_lock_type");
    fs.unlinkSync(lockPath);
    fs.mkdirSync(lockPath, { recursive: true });
    fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
      pid: 99,
      processStartedAt: "2026-08-13T00:00:00.000Z",
      createdAt: "2026-08-13T00:00:00.000Z",
      heartbeat: "2026-08-14T00:00:00.000Z",
      descriptorHash: "a".repeat(64),
    }));
    const stale = inspectResourceLock(resource, { now: Date.parse("2026-08-14T00:03:00.000Z"), pidAlive: () => false });
    assert.strictEqual(stale.stale, true);
    assert.strictEqual(stale.owner.pid, 99);
    assert.strictEqual(inspectResourceLock(resource, { now: Date.parse("2026-08-14T00:03:00.000Z"), pidAlive: () => true }).stale, false);
    fs.rmSync(lockPath, { recursive: true });

    const firstResource = path.join(root, "partial", "a");
    const collidingResource = path.join(root, "partial", "z");
    const collidingLock = resourceLockPath(collidingResource);
    fs.mkdirSync(collidingLock, { recursive: true });
    assert.throws(() => new VolumeLockSession([firstResource, collidingResource], { nativeBinding }).acquire(), error => error.code === "data_in_use");
    assert.strictEqual(fs.existsSync(resourceLockPath(firstResource)), false);
    assert.strictEqual(fs.existsSync(collidingLock), true);
    fs.rmSync(collidingLock, { recursive: true });

    const throwingNative = {
      getVolumeId: () => "other-volume", isRemote: () => false, acquire: () => ({}), release: () => { throw new Error("release failed"); },
    };
    const changed = new VolumeLockSession([resource], { nativeBinding: throwingNative }).acquire();
    const ownerFile = path.join(resourceLockPath(resource), "owner.json");
    const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
    fs.writeFileSync(ownerFile, JSON.stringify({ ...owner, nonce: "changed" }));
    assert.throws(() => changed.heartbeat(), error => error.code === "data_in_use");
    changed.release();
    fs.rmSync(resourceLockPath(resource), { recursive: true, force: true });
    fs.mkdirSync(lockPath);
    assert.strictEqual(inspectResourceLock(resource).evidence, "ownerless_requires_two_observations");
    fs.rmSync(lockPath, { recursive: true });

    const script = path.join(__dirname, "fixtures", "recovery", "volume-lock-child.js");
    const first = child(script, [resource, controlDir, "400"]);
    await new Promise(resolve => first.process_.stdout.once("data", resolve));
    const second = child(script, [resource, controlDir, "10"]);
    const secondCode = await second.done;
    const firstCode = await first.done;
    assert.strictEqual(firstCode, 0);
    assert.strictEqual(secondCode, 5);
    assert.match(first.stdout(), /acquired/);
    assert.match(second.stderr(), /data_in_use/);

    const nativeAddon = path.join(__dirname, "..", "build", "Release", "volume_lock.node");
    if (fs.existsSync(nativeAddon)) {
      const nativeScript = path.join(__dirname, "fixtures", "recovery", "native-volume-lock-child.js");
      const nativeFirst = child(nativeScript, [resource, controlDir, "400"]);
      await new Promise(resolve => nativeFirst.process_.stdout.once("data", resolve));
      const nativeSecond = child(nativeScript, [resource, controlDir, "10"]);
      const nativeSecondCode = await nativeSecond.done;
      assert.strictEqual(nativeSecondCode, 5, nativeSecond.stderr());
      assert.strictEqual(await nativeFirst.done, 0);
      assert.match(nativeFirst.stdout(), /native-acquired/);
      assert.match(nativeSecond.stderr(), /data_in_use/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("volume-lock: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
