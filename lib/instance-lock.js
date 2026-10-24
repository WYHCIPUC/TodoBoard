"use strict";

/**
 * 数据目录实例锁。
 *
 * 服务启动时在 controlDir 下以原子 mkdir 取得 instance.lock，阻止两个进程
 * 同时写入同一数据目录。锁不是用户数据：bootstrap.hasUserEvidence 会忽略它，
 * 避免首次启动崩溃留下的锁被误判为“已有数据”。
 *
 * 进程正常退出时释放；崩溃后由 PID + heartbeat 判定陈旧锁。陈旧锁不会被
 * 直接删除，而是原子重命名为 instance.lock.stale-* 保留证据后再取锁。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { isCanonicalUtc } = require("./backup-format");
const { atomicJson, syncDirectory } = require("./idempotency");

const LOCK_NAME = "instance.lock";
const HEARTBEAT_MS = 10_000;
const STALE_MS = 120_000;
const OWNER_VERSION = 1;

class InstanceLockError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "InstanceLockError";
    this.code = code;
    this.details = details || null;
  }
}

function lockDirectory(controlDir) {
  return path.join(path.resolve(controlDir), LOCK_NAME);
}

function ownerFile(lockDir) {
  return path.join(lockDir, "owner.json");
}

function defaultPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function processStartedAt(nowMs) {
  return new Date(nowMs - Math.floor(process.uptime() * 1000)).toISOString();
}

function validOwner(owner) {
  return Boolean(owner) &&
    owner.version === OWNER_VERSION &&
    Number.isInteger(owner.pid) && owner.pid > 0 &&
    typeof owner.nonce === "string" && /^[0-9a-f]{32}$/.test(owner.nonce) &&
    isCanonicalUtc(owner.createdAt) &&
    isCanonicalUtc(owner.heartbeat) &&
    isCanonicalUtc(owner.processStartedAt);
}

function readOwner(lockDir) {
  try { return JSON.parse(fs.readFileSync(ownerFile(lockDir), "utf8")); }
  catch (_) { return null; }
}

function publicOwner(owner) {
  return { pid: owner.pid, createdAt: owner.createdAt, heartbeat: owner.heartbeat };
}

function inspectInstanceLock(controlDir, options = {}) {
  const lockDir = lockDirectory(controlDir);
  if (!fs.existsSync(lockDir)) return { locked: false, lockDir };
  try {
    const stat = fs.lstatSync(lockDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return { locked: true, invalid: true, reason: "invalid_lock_type", lockDir };
    }
  } catch (error) {
    return { locked: true, invalid: true, reason: error.code || "unreadable", lockDir };
  }
  const owner = readOwner(lockDir);
  if (!validOwner(owner)) {
    return { locked: true, invalid: true, reason: "invalid_owner", lockDir };
  }
  const now = options.now === undefined ? Date.now() : Number(options.now);
  const heartbeat = Date.parse(owner.heartbeat);
  const alive = (options.pidAlive || defaultPidAlive)(owner.pid);
  const stale = !alive && Number.isFinite(heartbeat) && now - heartbeat > STALE_MS;
  return {
    locked: true,
    invalid: false,
    stale,
    owner: publicOwner(owner),
    heartbeat,
    lockDir,
  };
}

function quarantineStale(lockDir, nowMs) {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, "-");
  const target = lockDir + ".stale-" + stamp + "-" + crypto.randomBytes(4).toString("hex");
  fs.renameSync(lockDir, target);
  syncDirectory(path.dirname(lockDir));
  return target;
}

class InstanceLockSession {
  constructor(controlDir, options = {}) {
    this.controlDir = path.resolve(controlDir);
    this.lockDir = lockDirectory(this.controlDir);
    this.now = options.now || (() => Date.now());
    this.pidAlive = options.pidAlive || defaultPidAlive;
    this.owner = null;
    this.timer = null;
    this.quarantined = [];
  }

  acquire() {
    if (this.owner) throw new InstanceLockError("data_in_use", "实例锁已由当前进程持有");
    fs.mkdirSync(this.controlDir, { recursive: true });
    let created = false;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        fs.mkdirSync(this.lockDir);
        created = true;
      } catch (error) {
        if (error.code !== "EEXIST") {
          throw new InstanceLockError("instance_lock_failed", "无法创建实例锁: " + error.message, { causeCode: error.code || null });
        }
        const inspected = inspectInstanceLock(this.controlDir, { now: this.now(), pidAlive: this.pidAlive });
        if (inspected.invalid) {
          throw new InstanceLockError("instance_lock_invalid", "实例锁内容无法验证，请检查 " + this.lockDir, { reason: inspected.reason });
        }
        if (!inspected.stale) {
          throw new InstanceLockError("data_in_use", "另一个灵感工作台实例正在使用同一数据目录", inspected.owner);
        }
        try {
          this.quarantined.push(quarantineStale(this.lockDir, this.now()));
        } catch (renameError) {
          if (renameError.code !== "ENOENT") {
            throw new InstanceLockError("instance_lock_failed", "无法隔离陈旧实例锁: " + renameError.message, { causeCode: renameError.code || null });
          }
        }
      }
    }
    if (!created) throw new InstanceLockError("data_in_use", "实例锁竞争失败，请稍后重试");
    const createdAt = new Date(this.now()).toISOString();
    const owner = {
      version: OWNER_VERSION,
      pid: process.pid,
      processStartedAt: processStartedAt(this.now()),
      nonce: crypto.randomBytes(16).toString("hex"),
      createdAt,
      heartbeat: createdAt,
    };
    try {
      atomicJson(ownerFile(this.lockDir), owner, { exclusive: true });
      const reread = readOwner(this.lockDir);
      if (!reread || reread.nonce !== owner.nonce) throw new Error("owner 复读失败");
    } catch (error) {
      try { fs.rmSync(this.lockDir, { recursive: true, force: false }); } catch (_) {}
      throw new InstanceLockError("instance_lock_failed", "实例锁写入后验证失败: " + error.message);
    }
    this.owner = owner;
    this.timer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.timer.unref();
    return this;
  }

  heartbeat() {
    if (!this.owner) return;
    const next = { ...this.owner, heartbeat: new Date(this.now()).toISOString() };
    try {
      atomicJson(ownerFile(this.lockDir), next);
      this.owner = next;
    } catch (_) {
      // 保留最后一个有效 heartbeat；进程仍存活时不会被其他实例抢占。
    }
  }

  release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.owner) return;
    try {
      const current = readOwner(this.lockDir);
      if (current && current.nonce === this.owner.nonce) {
        fs.unlinkSync(ownerFile(this.lockDir));
        fs.rmdirSync(this.lockDir);
        syncDirectory(this.controlDir);
      }
    } catch (_) {
      // 无法证明所有权时保留锁，交给 PID/heartbeat 判定。
    } finally {
      this.owner = null;
    }
  }
}

function acquireInstanceLock(controlDir, options) {
  return new InstanceLockSession(controlDir, options).acquire();
}

module.exports = {
  HEARTBEAT_MS,
  LOCK_NAME,
  STALE_MS,
  InstanceLockError,
  InstanceLockSession,
  acquireInstanceLock,
  inspectInstanceLock,
  lockDirectory,
};
