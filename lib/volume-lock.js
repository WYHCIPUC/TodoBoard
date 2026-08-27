"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { atomicJson, syncDirectory } = require("./idempotency");
const { sha256 } = require("./backup-format");

const HEARTBEAT_MS = 10_000;
const STALE_MS = 120_000;

class VolumeLockError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "VolumeLockError";
    this.code = code;
    this.details = details || null;
  }
}

function loadNativeBinding(options = {}) {
  if (options.nativeBinding) return options.nativeBinding;
  const candidates = options.bindingPath ? [options.bindingPath] : [
    path.join(__dirname, "..", "build", "Release", "volume_lock.node"),
    path.join(__dirname, "..", "build", "Debug", "volume_lock.node"),
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
  }
  throw new VolumeLockError("invalid_storage_topology", "native volume-lock helper 不可用");
}

function normalizeResource(resource) {
  const resolved = path.resolve(resource).normalize("NFC");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function ownerPath(lockPath) {
  return path.join(lockPath, "owner.json");
}

function resourceLockPath(resource) {
  const canonical = normalizeResource(resource);
  return path.join(path.dirname(path.resolve(resource)), ".linggan-owner-" + sha256(Buffer.from(canonical)).slice(0, 16) + ".lock");
}

function readOwner(lockPath) {
  try { return JSON.parse(fs.readFileSync(ownerPath(lockPath), "utf8")); } catch (_) { return null; }
}

function publicOwner(owner) {
  if (!owner || !Number.isInteger(owner.pid) || typeof owner.processStartedAt !== "string" ||
      typeof owner.createdAt !== "string" || typeof owner.heartbeat !== "string" || typeof owner.descriptorHash !== "string") {
    return null;
  }
  return {
    pid: owner.pid,
    processStartedAt: owner.processStartedAt,
    createdAt: owner.createdAt,
    heartbeat: owner.heartbeat,
    descriptorHash: owner.descriptorHash,
  };
}

function processStartTime() {
  return new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString();
}

function ownerMatches(lock, owner) {
  const current = readOwner(lock.path);
  return current && current.nonce === owner.nonce && current.descriptorHash === owner.descriptorHash;
}

function inspectResourceLock(resource, options = {}) {
  const lockPath = resourceLockPath(resource);
  if (!fs.existsSync(lockPath)) return { locked: false, resourcePathHash: sha256(normalizeResource(resource)) };
  const owner = readOwner(lockPath);
  const stat = fs.lstatSync(lockPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { locked: true, stale: false, evidence: "invalid_lock_type", resourcePathHash: sha256(normalizeResource(resource)) };
  }
  const now = options.now === undefined ? Date.now() : options.now;
  const safeOwner = publicOwner(owner);
  const heartbeat = safeOwner && Date.parse(safeOwner.heartbeat);
  const pidAlive = safeOwner && typeof options.pidAlive === "function" ? options.pidAlive(safeOwner.pid, safeOwner.processStartedAt) : true;
  const stale = Boolean(safeOwner && !pidAlive && Number.isFinite(heartbeat) && now - heartbeat > STALE_MS);
  const ownerBytes = fs.existsSync(ownerPath(lockPath)) ? fs.readFileSync(ownerPath(lockPath)) : Buffer.alloc(0);
  return {
    locked: true,
    stale,
    resourcePathHash: sha256(normalizeResource(resource)),
    lockDescriptorHash: sha256(Buffer.concat([Buffer.from(lockPath), ownerBytes])),
    staleSince: stale ? new Date(heartbeat + STALE_MS).toISOString() : null,
    evidence: safeOwner ? (stale ? "dead_owner_and_expired_heartbeat" : "owner_active_or_unproven") : "ownerless_requires_two_observations",
    owner: safeOwner,
  };
}

function ensureSafeDirectory(directory) {
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  let cursor = root;
  for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      fs.mkdirSync(cursor);
      stat = fs.lstatSync(cursor);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new VolumeLockError("invalid_storage_topology", "lock parent 路径包含非普通目录或链接");
    }
  }
}

class VolumeLockSession {
  constructor(resources, options = {}) {
    this.resources = [...new Set(resources.map(normalizeResource))].sort();
    this.controlDir = options.controlDir ? normalizeResource(options.controlDir) : null;
    this.native = loadNativeBinding(options);
    this.now = options.now || (() => new Date());
    this.handles = [];
    this.locks = [];
    this.owner = null;
    this.timer = null;
  }

  acquire() {
    if (this.owner) throw new VolumeLockError("transaction_busy", "volume lock session 已取得锁");
    let resourceDescriptors;
    try {
      resourceDescriptors = this.resources.map(resource => {
        if (this.native.isRemote(resource)) throw new VolumeLockError("invalid_storage_topology", "不支持远程/多主机卷");
        const volumeId = String(this.native.getVolumeId(resource));
        if (!volumeId) throw new VolumeLockError("invalid_storage_topology", "无法取得稳定 volume ID");
        return { resource, volumeId };
      });
    } catch (error) {
      if (error instanceof VolumeLockError) throw error;
      throw new VolumeLockError("invalid_storage_topology", "native volume topology 检查失败", { causeCode: error.code || null });
    }
    const volumes = [...new Set(resourceDescriptors.map(item => item.volumeId))].sort();
    try {
      for (const volumeId of volumes) {
        const handle = this.native.acquire(sha256(Buffer.from(volumeId)));
        if (!handle) throw new VolumeLockError("data_in_use", "目标卷已被其他实例占用", { volumeIdHash: sha256(volumeId) });
        this.handles.push(handle);
      }
      const ordered = [...resourceDescriptors].sort((a, b) => {
        if (this.controlDir && a.resource === this.controlDir) return -1;
        if (this.controlDir && b.resource === this.controlDir) return 1;
        return a.resource.localeCompare(b.resource);
      });
      const descriptorHash = sha256(Buffer.from(JSON.stringify(ordered)));
      const owner = {
        nonce: crypto.randomBytes(16).toString("hex"),
        pid: process.pid,
        processStartedAt: processStartTime(),
        descriptorHash,
        createdAt: this.now().toISOString(),
        heartbeat: this.now().toISOString(),
      };
      this.owner = owner;
      for (const item of ordered) {
        const lockPath = resourceLockPath(item.resource);
        ensureSafeDirectory(path.dirname(lockPath));
        try { fs.mkdirSync(lockPath); } catch (error) {
          if (error.code === "EEXIST") throw new VolumeLockError("data_in_use", "资源已被其他实例占用", inspectResourceLock(item.resource));
          throw error;
        }
        const lock = { ...item, path: lockPath };
        this.locks.push(lock);
        atomicJson(ownerPath(lockPath), owner, { exclusive: true });
        if (!ownerMatches(lock, owner)) throw new VolumeLockError("data_in_use", "owner 复读失败");
        syncDirectory(path.dirname(lockPath));
      }
      this.timer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
      this.timer.unref();
      return this;
    } catch (error) {
      this.release();
      if (error instanceof VolumeLockError) throw error;
      throw new VolumeLockError("invalid_storage_topology", "volume/resource lock 获取失败", { causeCode: error.code || null });
    }
  }

  heartbeat() {
    if (!this.owner) return;
    const next = { ...this.owner, heartbeat: this.now().toISOString() };
    for (const lock of this.locks) {
      if (!ownerMatches(lock, this.owner)) throw new VolumeLockError("data_in_use", "resource owner 已变化");
      atomicJson(ownerPath(lock.path), next);
    }
    this.owner = next;
  }

  release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const lock of [...this.locks].reverse()) {
      try {
        if (this.owner && ownerMatches(lock, this.owner)) {
          fs.unlinkSync(ownerPath(lock.path));
          fs.rmdirSync(lock.path);
          syncDirectory(path.dirname(lock.path));
        }
      } catch (_) {
        // Fail closed: never remove a lock whose owner cannot be proven.
      }
    }
    this.locks = [];
    for (const handle of [...this.handles].reverse()) {
      try { this.native.release(handle); } catch (_) {}
    }
    this.handles = [];
    this.owner = null;
  }

  volumeId(resource) {
    return String(this.native.getVolumeId(normalizeResource(resource)));
  }
}

function acquireVolumeLocks(resources, options = {}) {
  return new VolumeLockSession(resources, options).acquire();
}

module.exports = {
  HEARTBEAT_MS,
  STALE_MS,
  VolumeLockError,
  VolumeLockSession,
  acquireVolumeLocks,
  inspectResourceLock,
  ensureSafeDirectory,
  loadNativeBinding,
  normalizeResource,
  resourceLockPath,
};
