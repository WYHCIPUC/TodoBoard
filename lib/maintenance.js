"use strict";

const crypto = require("crypto");

class MaintenanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MaintenanceError";
    this.code = code;
  }
}

class MaintenanceCoordinator {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs === undefined ? 60_000 : options.timeoutMs;
    this.pause = options.pause || (async () => {});
    this.resume = options.resume || (async () => {});
    this.activeMutations = new Map();
    this.intent = false;
    this.maintenanceToken = null;
    this.waiters = new Set();
  }

  status() {
    return {
      mode: this.maintenanceToken ? "maintenance" : this.intent ? "waiting" : "normal",
      activeMutations: this.activeMutations.size,
    };
  }

  notify() {
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }

  waitForChange(timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer;
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      this.waiters.add(done);
      timer = setTimeout(() => {
        this.waiters.delete(done);
        reject(new MaintenanceError("maintenance_timeout", "等待在途写入结束超时"));
      }, timeoutMs);
    });
  }

  acquireMutation(existingToken) {
    if (existingToken) {
      const record = this.activeMutations.get(existingToken.id);
      if (!record || record.token !== existingToken || existingToken.released) {
        throw new MaintenanceError("maintenance_locked", "嵌套 mutation lease 无效");
      }
      record.depth++;
      return existingToken;
    }
    if (this.intent || this.maintenanceToken) {
      throw new MaintenanceError("maintenance_locked", "维护正在等待或执行，暂不接受新写入");
    }
    const token = { id: crypto.randomUUID(), kind: "mutation", released: false };
    this.activeMutations.set(token.id, { token, depth: 1 });
    return token;
  }

  releaseMutation(token) {
    const record = token && this.activeMutations.get(token.id);
    if (!record || record.token !== token || token.released) return false;
    record.depth--;
    if (record.depth > 0) return true;
    token.released = true;
    this.activeMutations.delete(token.id);
    this.notify();
    return true;
  }

  async acquireMaintenance(options = {}) {
    if (this.intent || this.maintenanceToken) {
      throw new MaintenanceError("transaction_busy", "已有维护操作正在进行");
    }
    const timeoutMs = options.timeoutMs === undefined ? this.timeoutMs : options.timeoutMs;
    const deadline = Date.now() + timeoutMs;
    this.intent = true;
    let paused = false;
    try {
      await this.pause();
      paused = true;
      while (this.activeMutations.size) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new MaintenanceError("maintenance_timeout", "等待在途写入结束超时");
        await this.waitForChange(remaining);
      }
      const token = { id: crypto.randomUUID(), kind: "maintenance", released: false };
      this.maintenanceToken = token;
      return token;
    } catch (error) {
      this.intent = false;
      if (paused) await this.resume();
      this.notify();
      throw error;
    }
  }

  async releaseMaintenance(token) {
    if (!token || token !== this.maintenanceToken || token.released) return false;
    token.released = true;
    this.maintenanceToken = null;
    this.intent = false;
    try {
      await this.resume();
    } finally {
      this.notify();
    }
    return true;
  }

  async withMutation(work, existingToken) {
    const token = this.acquireMutation(existingToken);
    try {
      return await work(token);
    } finally {
      this.releaseMutation(token);
    }
  }

  async withMaintenance(work, options) {
    const token = await this.acquireMaintenance(options);
    try {
      return await work(token);
    } finally {
      await this.releaseMaintenance(token);
    }
  }
}

const defaultCoordinator = new MaintenanceCoordinator();

module.exports = {
  MaintenanceCoordinator,
  MaintenanceError,
  defaultCoordinator,
};
