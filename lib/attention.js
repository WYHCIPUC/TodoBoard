"use strict";

const fs = require("fs");
const path = require("path");
const schema = require("./schema");
const { DAY_MS, substantive } = require("./lifecycle");

const NOTES_LIMIT = 20 * 1024 * 1024;
const REASONS = Object.freeze({
  archive_blocked: { priority: 1, thresholdDays: null },
  review_due: { priority: 2, thresholdDays: 0 },
  open_action: { priority: 3, thresholdDays: null },
  stalled: { priority: 4, thresholdDays: 14 },
  unresearched: { priority: 5, thresholdDays: 7 },
  lifecycle_missing: { priority: 6, thresholdDays: null },
});
const STATUS = Object.freeze({ "⏳": "待研究", "🔄": "进行中", "✅": "已完成" });

class AttentionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "AttentionError";
    this.code = code;
    this.details = details || null;
  }
}

function numericId(value) {
  if (!/^\d+(?:\.\d+)+$/.test(value)) return null;
  return value.split(".").map(Number);
}

function compareId(left, right) {
  const a = numericId(left);
  const b = numericId(right);
  if (!a || !b) return String(left).localeCompare(String(right));
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return String(left).localeCompare(String(right));
}

function parseNotes(content) {
  const field = label => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return content.match(new RegExp("\\*\\*" + escaped + "\\*\\*: ?([^\\r\\n]*)"))?.[1].trim() || "";
  };
  return {
    keyFindings: field("关键发现"),
    actionItems: field("行动项"),
    conclusion: field("结论"),
    experience: content.match(/\*\*使用感受\*\*:\r?\n([\s\S]*?)(?=\r?\n## |$)/)?.[1].trim() || "",
  };
}

function readNotes(entry, entriesDir) {
  if (!entriesDir) return { fields: {}, warning: null };
  const key = entry.uid || entry.id;
  const root = path.resolve(entriesDir);
  const file = path.resolve(root, key, "notes.md");
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return { fields: {}, warning: null };
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) return { fields: {}, warning: "notes_unreadable" };
    if (stat.size > NOTES_LIMIT) return { fields: {}, warning: "notes_too_large" };
    return { fields: parseNotes(fs.readFileSync(file, "utf8")), warning: null };
  } catch (_) {
    return { fields: {}, warning: "notes_unreadable" };
  }
}

function archiveBlocked(archive = {}) {
  const state = archive.state || "not_archived";
  if (["failed", "manual_required", "manual_pending"].includes(state)) return true;
  if (state === "not_archived") return !["queued", "running"].includes(archive.taskState);
  if (state !== "partial") return false;
  return archive.retryable === true || archive.contentUsable === false || archive.integrity?.state === "damaged";
}

function buildReason(code, dueAt) {
  return { code, priority: REASONS[code].priority, dueAt: dueAt || null };
}

function aggregateAttention(dataText, options = {}) {
  let entries;
  try {
    entries = schema.validateData(dataText).entries;
  } catch (error) {
    throw new AttentionError("attention_unavailable", "无法建立唯一条目集合", { cause: error.message });
  }
  const now = new Date(options.now === undefined ? Date.now() : options.now);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new AttentionError("invalid_timestamp", "待处理计算时间非法");
  const archiveByUid = options.archiveByUid || options.archiveStatuses || {};
  const warnings = [];
  const items = [];

  for (const entry of entries) {
    if (!numericId(entry.id)) {
      warnings.push({ code: "invalid_id", id: entry.id });
      continue;
    }
    const notes = readNotes(entry, options.entriesDir);
    if (notes.warning) warnings.push({ code: notes.warning, id: entry.id, uid: entry.uid || null });
    const researchNotes = entry.fields?.["研究要点"] || "";
    const researchFields = { ...notes.fields, researchNotes };
    const hasResearch = Object.values(researchFields).some(substantive);
    const status = STATUS[entry.status];
    const lifecycle = entry.lifecycle;
    const activity = lifecycle.lastStudiedAt || lifecycle.createdAt;
    const reasons = [];
    const archive = archiveByUid[entry.uid] || archiveByUid[entry.id] || {};
    if (archiveBlocked(archive)) reasons.push(buildReason("archive_blocked"));
    if (lifecycle.nextReviewAt && Date.parse(lifecycle.nextReviewAt) <= nowMs) {
      reasons.push(buildReason("review_due", lifecycle.nextReviewAt));
    }
    if (status !== "已完成" && substantive(notes.fields.actionItems)) reasons.push(buildReason("open_action"));
    if (status === "进行中" && activity && nowMs - Date.parse(activity) >= 14 * DAY_MS) {
      reasons.push(buildReason("stalled", new Date(Date.parse(activity) + 14 * DAY_MS).toISOString()));
    }
    if (status === "待研究" && lifecycle.createdAt && nowMs - Date.parse(lifecycle.createdAt) >= 7 * DAY_MS && !hasResearch) {
      reasons.push(buildReason("unresearched", new Date(Date.parse(lifecycle.createdAt) + 7 * DAY_MS).toISOString()));
    }
    const createdInvalid = !lifecycle.createdAt || entry.lifecycleDiagnostics.some(item => item.field === "createdAt");
    if (createdInvalid) reasons.push(buildReason("lifecycle_missing"));
    if (!reasons.length) continue;
    reasons.sort((left, right) => left.priority - right.priority || left.code.localeCompare(right.code));
    const primary = reasons[0];
    items.push({
      id: entry.id,
      uid: entry.uid,
      title: entry.title,
      status,
      activityAt: activity || null,
      primaryReason: primary.code,
      reasons,
      warnings: notes.warning ? [notes.warning] : [],
    });
  }

  const time = value => value ? Date.parse(value) : Number.POSITIVE_INFINITY;
  items.sort((left, right) => {
    const priority = left.reasons[0].priority - right.reasons[0].priority;
    if (priority) return priority;
    const due = time(left.reasons[0].dueAt) - time(right.reasons[0].dueAt);
    if (Number.isFinite(due) && due) return due;
    const activity = time(left.activityAt) - time(right.activityAt);
    if (Number.isFinite(activity) && activity) return activity;
    return compareId(left.id, right.id);
  });

  const byReason = Object.fromEntries(Object.keys(REASONS).map(code => [code, 0]));
  for (const item of items) for (const reason of item.reasons) byReason[reason.code]++;
  return {
    generatedAt: now.toISOString(),
    policy: {
      dayMilliseconds: DAY_MS,
      thresholdDays: { unresearched: 7, stalled: 14, defaultReview: 30 },
      reasonPriorities: Object.fromEntries(Object.entries(REASONS).map(([code, value]) => [code, value.priority])),
    },
    counts: { items: items.length, byReason, warnings: warnings.length },
    items,
    warnings,
  };
}

function todayRecommendations(result) {
  return result.items.filter(item => item.reasons.some(reason => !["archive_blocked", "lifecycle_missing"].includes(reason.code)));
}

module.exports = {
  AttentionError,
  NOTES_LIMIT,
  REASONS,
  aggregateAttention,
  archiveBlocked,
  compareId,
  parseNotes,
  todayRecommendations,
};
