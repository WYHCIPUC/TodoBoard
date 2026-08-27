"use strict";

const fs = require("fs");
const path = require("path");
const store = require("./store");
const canonicalContent = require("./archive-content");

const STATES = ["queued", "running", "partial", "succeeded", "failed", "manual_required"];
const RETRY_DELAYS = [0, 5 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000];

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function wallNow(clock) {
  if (typeof clock === "function") return Number(clock());
  if (clock && typeof clock.now === "function") return Number(clock.now());
  return Date.now();
}

function setTimer(clock, callback, delay) {
  if (clock && typeof clock.setTimeout === "function") return clock.setTimeout(callback, delay);
  return setTimeout(callback, delay);
}

function clearTimer(clock, timer) {
  if (timer === null || timer === undefined) return;
  if (clock && typeof clock.clearTimeout === "function") clock.clearTimeout(timer);
  else clearTimeout(timer);
}

function safeError(value) {
  let text = String(value || "");
  const cookie = process.env.X_COOKIE;
  if (cookie) text = text.split(cookie).join("[redacted]");
  return text.replace(/(?:x[-_ ]?cookie|cookie)\s*[:=]\s*[^\s,;]+/ig, "$1=[redacted]").slice(0, 500);
}

function atomicJson(file, value, options = {}) {
  const previous = file + ".previous";
  const sanitized = clone(value);
  const nextJobs = Array.isArray(sanitized) ? sanitized : sanitized.jobs || [];
  for (const job of nextJobs) if (job && typeof job === "object") delete job.manualContent;
  const changes = [];
  if (fs.existsSync(file)) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
      const jobs = Array.isArray(snapshot) ? snapshot : snapshot.jobs || [];
      for (const job of jobs) if (job && typeof job === "object") delete job.manualContent;
      changes.push({ file: previous, bytes: Buffer.from(JSON.stringify(snapshot, null, 2) + "\n") });
    } catch (_) {}
  }
  changes.push({ file, bytes: Buffer.from(JSON.stringify(sanitized, null, 2) + "\n") });
  return store.trustedWriteSet(changes, {
    action: options.action || "archive.queue",
    operationId: options.operationId,
    leaseToken: options.leaseToken,
    coordinator: options.coordinator,
    controlDir: options.controlDir || path.dirname(file),
  });
}

class ArchiveQueue {
  constructor(options = {}) {
    this.file = path.resolve(options.file || path.join(process.cwd(), ".linggan", "archive-jobs.json"));
    this.clock = options.clock || null;
    this.archive = options.archive || null;
    this.coordinator = options.coordinator;
    this.entriesDir = path.resolve(options.entriesDir || this.archive?.paths?.entriesDir || path.join(path.dirname(this.file), "entries"));
    this.runtimeDir = path.resolve(options.runtimeDir || this.archive?.paths?.runtimeDir || path.dirname(this.file));
    this.processor = options.processor || null;
    this.jobs = new Map();
    this.pendingManualContent = new Map();
    this.diagnostics = [];
    this.timer = null;
    this.running = null;
    this.stopped = false;
    this.started = options.autoStart !== false;
    this._load();
    if (this.started) this._schedule();
  }

  attachArchive(archive) { this.archive = archive; return this; }

  start() {
    this.started = true;
    this.stopped = false;
    this._schedule();
    return this;
  }

  stop() {
    this.stopped = true;
    clearTimer(this.clock, this.timer);
    this.timer = null;
    return this;
  }

  enqueue(entry, options = {}) {
    if (!entry || !entry.url) throw new Error("归档任务缺少 URL");
    const id = String(entry.id || entry.uid || "");
    if (!id) throw new Error("归档任务缺少 id");
    const existing = this.jobs.get(id);
    if (existing && ["queued", "running", "succeeded"].includes(existing.state)) {
      return { id, state: existing.state };
    }
    const stamp = wallNow(this.clock);
    const task = {
      id,
      uid: String(entry.uid || id),
      url: String(entry.url),
      entry: this._safeEntry(entry),
      attempt: 0,
      nextRunAt: stamp,
      lastError: null,
      state: "queued",
      createdAt: existing?.createdAt || new Date(stamp).toISOString(),
      updatedAt: new Date(stamp).toISOString(),
    };
    this.jobs.set(id, task);
    this._persist(options);
    this._schedule();
    return { id, state: "queued" };
  }

  getStatus(id) {
    const task = this.jobs.get(String(id));
    if (!task) return null;
    const result = clone(task);
    delete result.entry;
    delete result.manualContent;
    delete result.manualDraftHash;
    return result;
  }

  getTask(id) { return this.jobs.get(String(id)) || null; }

  retry(id) {
    const task = this.jobs.get(String(id));
    if (!task) throw new Error("未知归档任务: " + id);
    if (task.state === "running") throw new Error("归档任务正在执行");
    if (task.state === "queued") return { id: task.id, state: "queued" };
    const stamp = wallNow(this.clock);
    task.attempt = 0;
    task.nextRunAt = stamp;
    task.lastError = null;
    task.state = "queued";
    task.updatedAt = new Date(stamp).toISOString();
    delete task.manualContent;
    this._persist();
    this._schedule();
    return { id: task.id, state: "queued" };
  }

  setManualContent(id, content) {
    if (!String(content || "").trim()) throw new Error("手动归档内容不能为空");
    const task = this.jobs.get(String(id));
    if (!task) throw new Error("未知归档任务: " + id);
    const draft = canonicalContent.writeManualDraft({
      entriesDir: this.entriesDir,
      runtimeDir: this.runtimeDir,
      uid: task.uid,
      content: String(content),
      coordinator: this.coordinator,
    });
    if (task.state === "running") {
      this.pendingManualContent.set(task.id, { hash: draft.draftHash, content: String(content) });
      return { id: task.id, state: "running" };
    }
    const stamp = wallNow(this.clock);
    task.manualDraftHash = draft.draftHash;
    task.manualContent = String(content);
    task.attempt = 0;
    task.nextRunAt = stamp;
    task.lastError = null;
    task.state = "queued";
    task.updatedAt = new Date(stamp).toISOString();
    this._persist();
    this._schedule();
    return { id: task.id, state: "queued" };
  }

  async runDue() {
    if (this.stopped) return this.running;
    if (this.running) return this.running;
    const stamp = wallNow(this.clock);
    const task = [...this.jobs.values()]
      .filter(item => item.state === "queued" && item.nextRunAt <= stamp)
      .sort((a, b) => a.nextRunAt - b.nextRunAt || a.createdAt.localeCompare(b.createdAt))[0];
    if (!task) { this._schedule(); return null; }
    this.running = this._run(task);
    try { return await this.running; }
    finally { this.running = null; this._schedule(); }
  }

  async runAndWait(id) {
    const key = String(id);
    if (!this.jobs.has(key)) throw new Error("未知归档任务: " + id);
    while (true) {
      const task = this.jobs.get(key);
      if (task.state !== "queued" && task.state !== "running") return this.getStatus(key);
      if (this.running) {
        const waitingForTarget = task.state === "running";
        await this.running;
        if (waitingForTarget) {
          const status = this.getStatus(key);
          if (status.state !== "queued" || status.nextRunAt > wallNow(this.clock)) return status;
        }
        continue;
      }
      if (this.stopped) throw new Error("归档队列已停止");
      if (task.state === "running") throw new Error("归档任务状态异常: " + id);
      this.running = this._run(task);
      try { return await this.running; }
      finally { this.running = null; this._schedule(); }
    }
  }

  async drain() {
    while (true) {
      if (this.running) {
        await this.running;
        continue;
      }
      const result = await this.runDue();
      if (!result) break;
    }
    return this;
  }

  _run(task) {
    const stamp = wallNow(this.clock);
    task.state = "running";
    task.attempt += 1;
    task.nextRunAt = null;
    task.updatedAt = new Date(stamp).toISOString();
    this._persist();
    if (task.manualDraftHash && task.manualContent === undefined) {
      const file = path.join(this.entriesDir, task.uid, "drafts", "manual-" + task.manualDraftHash + ".md");
      const bytes = fs.readFileSync(file);
      if (require("./backup-format").sha256(bytes) !== task.manualDraftHash) throw new Error("手动草稿 hash 不匹配");
      task.manualContent = bytes.toString("utf8");
    }
    const processor = this.processor || (this.archive && this.archive.archiveTask?.bind(this.archive));
    if (typeof processor !== "function") return Promise.resolve(this._finish(task, { state: "failed", error: "未配置归档处理器" }));
    return Promise.resolve()
      .then(() => processor(task))
      .then(
        result => this._finish(task, result || { state: "failed", error: "归档处理器未返回结果" }),
        error => this._finish(task, { state: "failed", error: error.message || String(error), retryable: true })
      );
  }

  _finish(task, result) {
    const processedManualContent = task.manualDraftHash;
    const processedManualBody = task.manualContent;
    delete task.manualContent;
    delete task.manualDraftHash;
    const state = STATES.includes(result.state) ? result.state : "failed";
    const error = result.error || result.warning || (result.metadata && result.metadata.errors?.[0]) || null;
    task.lastError = error ? safeError(error) : null;
    if (state === "succeeded") {
      task.state = "succeeded";
      task.nextRunAt = null;
    } else if (state === "manual_required") {
      task.state = "manual_required";
      task.nextRunAt = null;
    } else if (result.retryable !== false && task.attempt < 4) {
      task.state = "queued";
      task.nextRunAt = wallNow(this.clock) + RETRY_DELAYS[task.attempt];
    } else if (result.retryable !== false && task.attempt >= 4) {
      task.state = "manual_required";
      task.nextRunAt = null;
    } else {
      task.state = state === "running" ? "failed" : state;
      task.nextRunAt = null;
    }
    const stamp = wallNow(this.clock);
    const pendingManualContent = this.pendingManualContent.get(task.id);
    if (pendingManualContent !== undefined) {
      this.pendingManualContent.delete(task.id);
      task.manualDraftHash = pendingManualContent.hash;
      task.manualContent = pendingManualContent.content;
      task.attempt = 0;
      task.nextRunAt = stamp;
      task.lastError = null;
      task.state = "queued";
    }
    task.updatedAt = new Date(stamp).toISOString();
    try {
      this._persist();
    } catch (error) {
      if (task.manualDraftHash === undefined && processedManualContent !== undefined) {
        task.manualDraftHash = processedManualContent;
        task.manualContent = processedManualBody;
      }
      task.state = "queued";
      task.nextRunAt = stamp + 5000;
      task.lastError = safeError("队列状态写入失败: " + (error.message || String(error)));
      task.updatedAt = new Date(stamp).toISOString();
      throw error;
    }
    if (result.state === "succeeded" && processedManualContent && this.archive?.consumeManualDraft) {
      this.archive.consumeManualDraft(task.uid, processedManualContent);
    }
    return this.getStatus(task.id);
  }

  _schedule() {
    if (this.stopped || !this.started || this.running) return;
    clearTimer(this.clock, this.timer);
    this.timer = null;
    const queued = [...this.jobs.values()].filter(task => task.state === "queued");
    if (!queued.length) return;
    const earliest = queued.sort((a, b) => a.nextRunAt - b.nextRunAt)[0];
    const delay = Math.max(0, Math.min(0x7fffffff, earliest.nextRunAt - wallNow(this.clock)));
    this.timer = setTimer(this.clock, () => {
      this.timer = null;
      this.runDue().catch(() => {});
    }, delay);
  }

  _persist(options = {}) {
    atomicJson(this.file, { version: 1, jobs: [...this.jobs.values()].map(job => clone(job)) }, { ...options, coordinator: options.coordinator || this.coordinator });
  }

  _load() {
    const previous = this.file + ".previous";
    if (!fs.existsSync(this.file) && !fs.existsSync(previous)) return;
    let jobs;
    let source = this.file;
    try {
      jobs = this._readJobs(source);
    } catch (error) {
      this.diagnostics.push("归档队列主文件读取失败，尝试上次快照: " + String(error.message).slice(0, 200));
      source = previous;
      try {
        jobs = this._readJobs(source);
        this.diagnostics.push("归档队列已从上次快照恢复");
      } catch (previousError) {
        this.diagnostics.push("归档队列上次快照读取失败: " + String(previousError.message).slice(0, 200));
        return;
      }
    }
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      try {
        this._validate(job);
        const restored = Object.assign({}, job);
        if (restored.state === "running") {
          restored.state = "queued";
          restored.nextRunAt = wallNow(this.clock);
        }
        this.jobs.set(restored.id, restored);
      } catch (error) {
        this.diagnostics.push("归档队列任务 " + index + " 无效，已跳过: " + String(error.message).slice(0, 200));
      }
    }
  }

  _readJobs(file) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const jobs = Array.isArray(parsed) ? parsed : (parsed && parsed.version === 1 ? parsed.jobs : null);
    if (!Array.isArray(jobs)) throw new Error("版本不兼容");
    return jobs;
  }

  _validate(job) {
    if (!job || typeof job !== "object") throw new Error("任务不是对象");
    if (!job.id || !job.url || !STATES.includes(job.state)) throw new Error("任务字段无效");
    if (!Number.isInteger(job.attempt) || job.attempt < 0 || job.attempt > 4) throw new Error("任务 attempt 无效");
    if (job.nextRunAt !== null && !Number.isFinite(job.nextRunAt)) throw new Error("任务 nextRunAt 无效");
    if (!job.createdAt || !job.updatedAt) throw new Error("任务时间字段缺失");
    if (job.manualDraftHash !== undefined && !/^[0-9a-f]{64}$/.test(job.manualDraftHash)) throw new Error("任务 manualDraftHash 无效");
  }

  _safeEntry(entry) {
    const allowed = ["id", "uid", "url", "title", "author", "summary", "desc", "site", "cover", "images", "source", "tags"];
    const result = {};
    for (const key of allowed) if (entry[key] !== undefined) {
      if (key === "images" && Array.isArray(entry[key])) {
        result[key] = entry[key].map(image => {
          if (typeof image === "string") return image;
          if (!image || typeof image !== "object") return null;
          return { url: image.url || image.src, contentType: image.contentType || image.type };
        }).filter(image => image && (typeof image === "string" || image.url));
      } else if (key === "cover" && entry[key] && typeof entry[key] === "object") {
        result[key] = { url: entry[key].url || entry[key].src, contentType: entry[key].contentType || entry[key].type };
      } else {
        result[key] = entry[key];
      }
    }
    return result;
  }
}

function createArchiveQueue(options) { return new ArchiveQueue(options); }

module.exports = {
  ArchiveQueue,
  createArchiveQueue,
  atomicJson,
  RETRY_DELAYS,
  STATES,
};
