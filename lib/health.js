"use strict";

const schema = require("./schema");

function inspectData(text) {
  const version = schema.getDataVersion(text);
  const entries = schema.scanEntries(text);
  const ids = new Set();
  const uids = new Set();
  const urls = new Set();
  const counts = {
    entries: entries.length,
    duplicateIds: 0,
    missingUids: 0,
    invalidUids: 0,
    duplicateUids: 0,
    missingUrls: 0,
    invalidUrls: 0,
    duplicateUrls: 0,
  };

  for (const entry of entries) {
    if (ids.has(entry.id)) counts.duplicateIds++;
    ids.add(entry.id);

    if (!entry.uid) counts.missingUids++;
    else if (!schema.UID_RE.test(entry.uid)) counts.invalidUids++;
    else if (uids.has(entry.uid)) counts.duplicateUids++;
    else uids.add(entry.uid);

    if (!entry.url) {
      counts.missingUrls++;
      continue;
    }
    const normalized = schema.normalizeUrl(entry.url);
    if (!normalized) counts.invalidUrls++;
    else if (urls.has(normalized)) counts.duplicateUrls++;
    else urls.add(normalized);
  }

  const issues = [];
  const add = (code, severity, count, message) => {
    if (count) issues.push({ code, severity, count, message });
  };
  add("data_version", "error", version > schema.DATA_VERSION ? 1 : 0, "数据格式版本高于当前程序");
  add("legacy_version", "warning", version < schema.DATA_VERSION ? 1 : 0, "数据格式尚未升级");
  add("duplicate_ids", "error", counts.duplicateIds, "存在重复条目编号");
  add("missing_uids", version >= 2 ? "error" : "warning", counts.missingUids, "条目缺少稳定 UID");
  add("invalid_uids", "error", counts.invalidUids, "条目 UID 格式无效");
  add("duplicate_uids", "error", counts.duplicateUids, "存在重复条目 UID");
  add("missing_urls", "warning", counts.missingUrls, "条目缺少来源链接");
  add("invalid_urls", "warning", counts.invalidUrls, "条目来源链接无效");
  add("duplicate_urls", "warning", counts.duplicateUrls, "存在重复来源链接");

  const status = issues.some(issue => issue.severity === "error")
    ? "error"
    : (issues.length ? "warning" : "ok");
  return { status, version, counts, issues };
}

module.exports = { inspectData };
