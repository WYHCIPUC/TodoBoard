"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  HEARTBEAT_MS,
  STALE_MS,
  acquireInstanceLock,
  inspectInstanceLock,
  lockDirectory,
} = require("./instance-lock");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "instance-lock-test-"));
const NOW = Date.parse("2026-10-24T00:00:00.000Z");
const OLD = new Date(NOW - STALE_MS - 60_000).toISOString();

function controlDir(name) {
  return path.join(root, name);
}

try {
  assert.ok(HEARTBEAT_MS <= STALE_MS);

  const firstDir = controlDir("first");
  const first = acquireInstanceLock(firstDir, { now: () => NOW });
  assert.ok(fs.existsSync(lockDirectory(firstDir)), "取得锁后必须存在锁目录");
  const owner = JSON.parse(fs.readFileSync(path.join(lockDirectory(firstDir), "owner.json"), "utf8"));
  assert.strictEqual(owner.pid, process.pid);
  assert.match(owner.nonce, /^[0-9a-f]{32}$/);
  assert.strictEqual(inspectInstanceLock(firstDir, { now: NOW }).locked, true);

  assert.throws(
    () => acquireInstanceLock(firstDir, { now: () => NOW }),
    error => error.code === "data_in_use" && error.details.pid === process.pid
  );

  const childScript = `
    const lock = require(process.argv[1]);
    try {
      const session = lock.acquireInstanceLock(process.argv[2]);
      console.log("ACQUIRED");
      session.release();
    } catch (error) {
      console.error(error.code);
      process.exit(3);
    }
  `;
  const blocked = spawnSync(process.execPath, ["-e", childScript, path.join(__dirname, "instance-lock.js"), firstDir], { encoding: "utf8" });
  assert.strictEqual(blocked.status, 3, blocked.stderr);
  assert.ok(blocked.stderr.includes("data_in_use"), blocked.stderr);

  first.release();
  assert.strictEqual(fs.existsSync(lockDirectory(firstDir)), false, "正常释放必须移除锁目录");
  const second = acquireInstanceLock(firstDir, { now: () => NOW });
  second.release();

  const staleDir = controlDir("stale");
  const staleLock = lockDirectory(staleDir);
  fs.mkdirSync(staleLock, { recursive: true });
  fs.writeFileSync(path.join(staleLock, "owner.json"), JSON.stringify({
    version: 1,
    pid: 999999,
    processStartedAt: OLD,
    nonce: "a".repeat(32),
    createdAt: OLD,
    heartbeat: OLD,
  }), "utf8");
  const staleSession = acquireInstanceLock(staleDir, { now: () => NOW, pidAlive: () => false });
  const quarantined = fs.readdirSync(staleDir).filter(name => name.startsWith("instance.lock.stale-"));
  assert.strictEqual(quarantined.length, 1, "陈旧锁必须保留为隔离证据");
  assert.ok(fs.existsSync(path.join(staleDir, "instance.lock")), "隔离后必须取得新锁");
  staleSession.release();

  const invalidDir = controlDir("invalid");
  fs.mkdirSync(lockDirectory(invalidDir), { recursive: true });
  fs.writeFileSync(path.join(lockDirectory(invalidDir), "owner.json"), "{}", "utf8");
  assert.throws(
    () => acquireInstanceLock(invalidDir, { now: () => NOW, pidAlive: () => false }),
    error => error.code === "instance_lock_invalid"
  );
  assert.ok(fs.existsSync(lockDirectory(invalidDir)), "无法验证的锁不得被自动删除");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("instance-lock: ALL PASS");
