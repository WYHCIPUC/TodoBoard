"use strict";

const { isCanonicalUtc } = require("./backup-format");
const crypto = require("crypto");
const path = require("path");
const { canonicalRequestHash, IdempotencyStore } = require("./idempotency");
const schema = require("./schema");

const DAY_MS = 86_400_000;
const REVIEW_MS = 30 * DAY_MS;
const MAX_REVIEW_MS = 10 * 365 * DAY_MS;
const STATUS = Object.freeze({ pending: "⏳", active: "🔄", completed: "✅" });
const ACTION_STATUS = Object.freeze({
  start: STATUS.active,
  start_research: STATUS.active,
  reopen: STATUS.active,
  complete: STATUS.completed,
  reset: STATUS.pending,
  mark_unresearched: STATUS.pending,
});
const PLACEHOLDERS = new Set(["", "（待补充）", "待补充", "暂无", "无"]);

class LifecycleError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "LifecycleError";
    this.code = code;
    this.details = details || null;
  }
}

function canonicalNow(value) {
  const date = value instanceof Date ? value : new Date(value === undefined ? Date.now() : value);
  let output;
  try { output = date.toISOString(); }
  catch (_) { throw new LifecycleError("invalid_timestamp", "now 必须可转换为规范 UTC 时间"); }
  if (!isCanonicalUtc(output)) throw new LifecycleError("invalid_timestamp", "now 必须可转换为规范 UTC 时间");
  return output;
}

function substantive(value) {
  return !PLACEHOLDERS.has(String(value || "").trim());
}

function hasSubstantiveResearch(fields = {}) {
  return [fields.researchNotes, fields.keyFindings, fields.actionItems, fields.conclusion, fields.experience]
    .some(substantive);
}

function entryBounds(lines, entry) {
  let start = -1;
  let end = lines.length;
  for (let index = 0; index < lines.length; index++) {
    const head = lines[index].match(schema.ENTRY_HEAD_RE);
    if (head && head[2] === entry.id) {
      start = index;
      for (let next = index + 1; next < lines.length; next++) {
        if (schema.ENTRY_HEAD_RE.test(lines[next]) || /^##\s/.test(lines[next]) || /^---\s*$/.test(lines[next])) {
          end = next;
          break;
        }
      }
      break;
    }
  }
  return { start, end };
}

function healthyLifecycle(entry) {
  return entry.lifecycleDiagnostics.length === 0;
}

function normalizedLifecycleForRepair(entry) {
  const result = { createdAt: null, lastStudiedAt: null, nextReviewAt: null };
  for (const item of entry.lifecycleComments) {
    if (!item.valid) continue;
    if (item.field === "createdAt") {
      if (result.createdAt === null) result.createdAt = item.value;
    } else {
      result[item.field] = item.value;
    }
  }
  return result;
}

function validateReview(value, nowMs) {
  if (!isCanonicalUtc(value || "")) throw new LifecycleError("invalid_timestamp", "回顾时间必须是规范 UTC 毫秒格式");
  const when = Date.parse(value);
  if (when < nowMs || when > nowMs + MAX_REVIEW_MS) {
    throw new LifecycleError("invalid_timestamp", "回顾时间超出允许范围");
  }
  return value;
}

function renderLifecycle(text, entry, lifecycle, nextStatus) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const bounds = entryBounds(lines, entry);
  if (bounds.start < 0) throw new LifecycleError("entry_not_found", "条目不存在");
  if (nextStatus && nextStatus !== entry.status) {
    const head = lines[bounds.start].match(schema.ENTRY_HEAD_RE);
    lines[bounds.start] = "### " + nextStatus + " " + head[2] + " " + head[3];
  }
  for (let index = bounds.end - 1; index > bounds.start; index--) {
    if (/^<!--\s*linggan:(created-at|last-studied-at|next-review-at)=/.test(lines[index])) lines.splice(index, 1);
  }
  let insertAt = bounds.start + 1;
  while (insertAt < lines.length && /^<!--\s*linggan:uid=/.test(lines[insertAt])) insertAt++;
  const comments = [];
  if (lifecycle.createdAt) comments.push("<!-- linggan:created-at=" + lifecycle.createdAt + " -->");
  if (lifecycle.lastStudiedAt) comments.push("<!-- linggan:last-studied-at=" + lifecycle.lastStudiedAt + " -->");
  if (lifecycle.nextReviewAt) comments.push("<!-- linggan:next-review-at=" + lifecycle.nextReviewAt + " -->");
  lines.splice(insertAt, 0, ...comments);
  return lines.join(newline);
}

function applyLifecycle(text, ref, action, options = {}) {
  const entry = schema.findEntry(text, ref);
  if (!entry) throw new LifecycleError("entry_not_found", "条目不存在");
  const repair = action === "repair_lifecycle";
  if (!repair && !healthyLifecycle(entry)) {
    throw new LifecycleError("invalid_lifecycle", "生命周期注释损坏，必须先修复", { id: entry.id });
  }
  const now = canonicalNow(options.now);
  const nowMs = Date.parse(now);
  const current = repair ? normalizedLifecycleForRepair(entry) : { ...entry.lifecycle };
  const next = { ...current };
  let nextStatus = entry.status;

  if (repair) {
    // normalizedLifecycleForRepair already implements the frozen keep-first/keep-last rule.
  } else if (ACTION_STATUS[action]) {
    nextStatus = ACTION_STATUS[action];
    if (nextStatus !== entry.status) {
      if (nextStatus === STATUS.active) {
        next.lastStudiedAt = now;
        next.nextReviewAt = null;
      } else if (nextStatus === STATUS.completed) {
        next.lastStudiedAt = now;
        if (!next.nextReviewAt || Date.parse(next.nextReviewAt) <= nowMs) {
          next.nextReviewAt = new Date(nowMs + REVIEW_MS).toISOString();
        }
      } else if (nextStatus === STATUS.pending) {
        next.nextReviewAt = null;
      }
    }
  } else if (action === "mark_reviewed") {
    next.lastStudiedAt = now;
    next.nextReviewAt = new Date(nowMs + REVIEW_MS).toISOString();
  } else if (action === "set_review") {
    next.nextReviewAt = validateReview(options.nextReviewAt, nowMs);
  } else if (action === "clear_review") {
    next.nextReviewAt = null;
  } else if (action === "study_saved") {
    if (options.substantive) {
      next.lastStudiedAt = now;
      if (entry.status === STATUS.completed) next.nextReviewAt = new Date(nowMs + REVIEW_MS).toISOString();
    }
  } else {
    throw new LifecycleError("invalid_request", "未知生命周期动作");
  }

  const changed = nextStatus !== entry.status || Object.keys(next).some(key => next[key] !== current[key]) || Boolean(repair && entry.lifecycleComments.length);
  return {
    changed,
    text: changed ? renderLifecycle(text, entry, next, nextStatus) : text,
    lifecycle: next,
    status: nextStatus,
    fixedNow: now,
    id: entry.id,
    uid: entry.uid,
  };
}

async function updateLifecycle(ref, action, options = {}) {
  const store = options.store || require("./store");
  const requestId = String(options.requestId || crypto.randomUUID()).toLowerCase();
  const values = {
    entryRef: String(ref),
    lifecycleAction: String(action),
    nextReviewAt: options.nextReviewAt || null,
  };
  const idempotency = options.idempotency || new IdempotencyStore(path.join(options.controlDir || store.CONTROL_DIR, "idempotency"), { now: options.nowProvider });
  const existing = idempotency.get(requestId);
  if (existing) {
    if (existing.action !== "lifecycle.update" || existing.requestHash !== canonicalRequestHash("lifecycle.update", values)) {
      throw Object.assign(new LifecycleError("idempotency_conflict", "requestId 已用于其他生命周期请求"), { requestId });
    }
    if (existing.state === "committed") return existing.response;
  }
  const fixedNow = existing?.state === "pending" && existing.fixedNow
    ? canonicalNow(existing.fixedNow)
    : canonicalNow(options.now);
  return store.mutate(text => {
    const applied = applyLifecycle(text, ref, action, { now: fixedNow, nextReviewAt: options.nextReviewAt, substantive: options.substantive });
    const response = {
      saved: applied.changed,
      lifecycleUpdated: applied.changed,
      lifecycle: applied.lifecycle,
      status: applied.status,
      operationId: requestId,
    };
    return {
      text: applied.text,
      write: applied.changed,
      result: response,
      operation: applied.changed ? {
        operationId: requestId,
        action: "lifecycle.update",
        controlDir: options.controlDir,
        coordinator: options.coordinator,
        leaseToken: options.leaseToken,
        now: () => new Date(fixedNow),
        idempotency: { store: idempotency, action: "lifecycle.update", values },
        response,
      } : undefined,
    };
  });
}

module.exports = {
  ACTION_STATUS,
  DAY_MS,
  LifecycleError,
  MAX_REVIEW_MS,
  PLACEHOLDERS,
  REVIEW_MS,
  STATUS,
  applyLifecycle,
  hasSubstantiveResearch,
  substantive,
  updateLifecycle,
};
