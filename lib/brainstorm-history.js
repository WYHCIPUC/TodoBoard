"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const store = require("./store");
const { isCanonicalUtc } = require("./backup-format");

const REPORTS_DIR = process.env.BRAINSTORM_DIR
  ? path.resolve(process.env.BRAINSTORM_DIR)
  : path.join(path.dirname(store.README), ".linggan", "brainstorms");
const ID_RE = /^\d{8}T\d{6}-[0-9a-z]{6,12}$/;
const VERIFICATION_STATUSES = new Set(["pending", "verified", "rejected"]);
const VERIFICATION_LABELS = Object.freeze({ pending: "待验证", verified: "已验证", rejected: "被否定" });
const MAX_RESULT_CHARS = 1200;
const MAX_METADATA_HEAD = 16 * 1024;

function oneLine(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max || 500);
}

function normalizeVerification(value, fallbackCoverage) {
  const verification = value && typeof value === "object" ? value : {};
  const status = VERIFICATION_STATUSES.has(verification.status) ? verification.status : "pending";
  const result = String(verification.result || "").replace(/\s+/g, " ").trim().slice(0, MAX_RESULT_CHARS);
  const reviewedAt = isCanonicalUtc(verification.reviewedAt || "") ? verification.reviewedAt : null;
  const coverage = Number(verification.evidenceCoverage);
  const evidenceCoverage = Number.isFinite(coverage) && coverage >= 0 && coverage <= 100
    ? Math.round(coverage)
    : Math.max(0, Math.min(100, Math.round(Number(fallbackCoverage) || 0)));
  return { status, result, reviewedAt: status === "pending" ? null : reviewedAt, evidenceCoverage };
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return metadata;
  return { ...metadata, verification: normalizeVerification(metadata.verification, metadata.evidenceCoverage) };
}

function reportPath(id) {
  id = oneLine(id, 40);
  if (!ID_RE.test(id)) throw new Error("非法方案编号");
  const root = path.resolve(REPORTS_DIR);
  const target = path.resolve(root, id + ".md");
  if (!target.startsWith(root + path.sep)) throw new Error("方案路径越界");
  return target;
}

function reportMetadata(analysis, options) {
  const fusion = analysis && analysis.fusion || {};
  const plans = Array.isArray(fusion.plans) ? fusion.plans : [];
  const featured = plans[0] || {};
  const contributions = Array.isArray(featured.contributions) ? featured.contributions : [];
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const suffix = oneLine(options.suffix || crypto.randomUUID().replace(/-/g, "").slice(0, 8), 12).toLowerCase();
  if (!/^[0-9a-z]{6,12}$/.test(suffix)) throw new Error("非法方案后缀");
  const goal = oneLine(fusion.goal || analysis && analysis.goal, 400);
  if (!goal) throw new Error("请先输入一个实际需求");
  return {
    id: stamp + "-" + suffix,
    createdAt: now.toISOString(),
    goal,
    mode: oneLine(analysis && analysis.mode || "fusion", 30),
    topPlan: oneLine(featured.type || featured.title || "综合方案", 120),
    score: Number(featured.score) || 0,
    sourceCount: contributions.length,
    verification: {
      status: "pending",
      result: "",
      reviewedAt: null,
      evidenceCoverage: Math.max(0, Math.min(100, Math.round(Number(analysis && analysis.summary && analysis.summary.archiveCoverage) || 0))),
    },
  };
}

function verificationLines(value) {
  const verification = normalizeVerification(value);
  return [
    "## 验证记录",
    "",
    `- **状态**：${VERIFICATION_LABELS[verification.status]}`,
    `- **复盘日期**：${verification.reviewedAt ? verification.reviewedAt.slice(0, 10) : "未记录"}`,
    `- **来源证据覆盖率**：${verification.evidenceCoverage}%`,
    `- **验证结果**：${verification.result || "尚未填写"}`,
  ];
}

function toMarkdown(analysis, metadata) {
  const fusion = analysis.fusion || {};
  const plans = Array.isArray(fusion.plans) ? fusion.plans : [];
  const featured = plans[0] || {};
  const suggestions = Array.isArray(analysis.suggestions) ? analysis.suggestions : [];
  const summary = analysis.summary || {};
  const encodedMetadata = Buffer.from(JSON.stringify(metadata), "utf-8").toString("base64url");
  const lines = [
    `<!-- linggan:brainstorm-meta=${encodedMetadata} -->`,
    "# 头脑风暴方案",
    "",
    `> 保存时间：${metadata.createdAt}`,
    "",
    "## 实际需求",
    "",
    metadata.goal,
    "",
  ];

  if (plans.length) {
    lines.push("## 推荐融合方案", "", `### ${oneLine(featured.type || "综合方案", 120)}`, "");
    if (featured.summary) lines.push(oneLine(featured.summary, 1200), "");
    lines.push(`- **方案评分**：${Number(featured.score) || 0}`, `- **置信度**：${oneLine(featured.confidence || "待验证", 30)}`);
    if (featured.rationale) lines.push(`- **形成依据**：${oneLine(featured.rationale, 1200)}`);
    lines.push("", "### 来源项目与贡献", "");
    for (const contribution of featured.contributions || []) {
      const title = oneLine(contribution.title || contribution.id || "未命名项目", 240);
      const strength = oneLine(contribution.strength, 500);
      const reason = oneLine(contribution.reason, 800);
      lines.push(`- **${oneLine(contribution.id, 40)} ${title}**：${strength}${reason ? "；" + reason : ""}`);
    }
    lines.push("", "### 最小验证路径", "");
    (featured.mvp || []).forEach((step, index) => lines.push(`${index + 1}. ${oneLine(step, 1000)}`));
    lines.push("");
  }

  if (plans.length > 1) {
    lines.push("## 备选组合", "");
    for (const plan of plans.slice(1)) {
      lines.push(`- **${oneLine(plan.type || "备选方案", 120)}（${Number(plan.score) || 0} 分）**：${oneLine(plan.summary, 1000)}`);
    }
    lines.push("");
  }

  if (suggestions.length) {
    lines.push("## 补充建议", "");
    for (const suggestion of suggestions.slice(0, 12)) {
      lines.push(`- **${oneLine(suggestion.title || suggestion.type || "建议", 180)}**：${oneLine(suggestion.summary || suggestion.rationale, 1000)}`);
    }
    lines.push("");
  }

  const itemCount = Number(summary.items) || 0;
  const totalItems = Number(summary.totalItems) || itemCount;
  const scopeNote = summary.truncated && totalItems > itemCount
    ? `（项目库共 ${totalItems} 条，本次仅分析前 ${itemCount} 条）`
    : "";
  lines.push(
    "## 本轮分析依据",
    "",
    `- 项目数量：${itemCount}${scopeNote}`,
    `- 关系数量：${Number(summary.relations) || 0}`,
    `- 研究档案覆盖率：${Number(summary.archiveCoverage) || 0}%`,
    "",
    ...verificationLines(metadata.verification),
    "",
    "---",
    "由灵感工作台在本机生成并保存。",
    ""
  );
  return lines.join("\n");
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp";
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx");
    fs.writeFileSync(descriptor, content, "utf-8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_) {}
    }
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
    throw error;
  }
}

function saveReport(analysis, options) {
  options = options || {};
  const metadata = normalizeMetadata(reportMetadata(analysis, options));
  const file = reportPath(metadata.id);
  if (fs.existsSync(file)) throw new Error("方案编号冲突，请重试");
  writeAtomic(file, toMarkdown(analysis, metadata));
  return metadata;
}

function stripVerificationSection(text) {
  const marker = "\n## 验证记录";
  const index = text.indexOf(marker);
  if (index < 0) return text;
  const footer = text.indexOf("\n---\n", index);
  return footer >= 0 ? text.slice(0, index) + text.slice(footer) : text.slice(0, index);
}

function withVerificationSection(text, verification) {
  const stripped = stripVerificationSection(text).trimEnd();
  const section = verificationLines(verification).join("\n");
  const footerIndex = stripped.lastIndexOf("\n---\n");
  if (footerIndex >= 0) {
    return stripped.slice(0, footerIndex) + "\n\n" + section + "\n" + stripped.slice(footerIndex) + "\n";
  }
  return stripped + "\n\n" + section + "\n";
}

function updateVerification(id, input) {
  input = input || {};
  const file = reportPath(id);
  if (!fs.existsSync(file)) {
    const error = new Error("未找到已保存方案");
    error.statusCode = 404;
    throw error;
  }
  const metadata = metadataFromFile(file);
  if (!metadata) {
    const error = new Error("方案元数据损坏，无法记录验证");
    error.statusCode = 400;
    throw error;
  }
  const status = String(input.status || "").trim();
  if (!VERIFICATION_STATUSES.has(status)) {
    const error = new Error("验证状态只能是 pending、verified 或 rejected");
    error.statusCode = 400;
    throw error;
  }
  let reviewedAt = input.reviewedAt === null || input.reviewedAt === undefined ? null : String(input.reviewedAt);
  if (reviewedAt && !isCanonicalUtc(reviewedAt)) {
    const error = new Error("复盘日期必须是规范 UTC 时间");
    error.statusCode = 400;
    throw error;
  }
  if (status === "pending") reviewedAt = null;
  else if (!reviewedAt) reviewedAt = new Date().toISOString();
  const verification = normalizeVerification({
    status,
    result: input.result,
    reviewedAt,
    evidenceCoverage: metadata.verification.evidenceCoverage,
  });
  const nextMetadata = normalizeMetadata({ ...metadata, verification });
  const encoded = Buffer.from(JSON.stringify(nextMetadata), "utf-8").toString("base64url");
  const text = fs.readFileSync(file, "utf-8");
  const lines = text.split(/\r?\n/);
  if (!/^<!-- linggan:brainstorm-meta=[0-9A-Za-z_-]+ -->$/.test(lines[0] || "")) {
    const error = new Error("方案元数据行缺失，无法记录验证");
    error.statusCode = 400;
    throw error;
  }
  lines[0] = `<!-- linggan:brainstorm-meta=${encoded} -->`;
  writeAtomic(file, withVerificationSection(lines.join("\n"), nextMetadata.verification));
  return nextMetadata;
}

function metadataFromFile(file) {
  try {
    const head = fs.readFileSync(file, "utf-8").slice(0, MAX_METADATA_HEAD);
    const match = head.match(/^<!-- linggan:brainstorm-meta=([0-9A-Za-z_-]+) -->/);
    if (!match) return null;
    const metadata = JSON.parse(Buffer.from(match[1], "base64url").toString("utf-8"));
    if (!metadata || !ID_RE.test(metadata.id || "")) return null;
    return normalizeMetadata(metadata);
  } catch (_) {
    return null;
  }
}

function listReports(limit) {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  const max = Math.max(1, Math.min(50, Number(limit) || 10));
  return fs.readdirSync(REPORTS_DIR)
    .filter(name => ID_RE.test(path.basename(name, ".md")) && name.endsWith(".md"))
    .sort().reverse()
    .map(name => metadataFromFile(path.join(REPORTS_DIR, name)))
    .filter(Boolean)
    .slice(0, max);
}

function readReport(id) {
  const file = reportPath(id);
  if (!fs.existsSync(file)) {
    const error = new Error("未找到已保存方案");
    error.statusCode = 404;
    throw error;
  }
  return fs.readFileSync(file, "utf-8");
}

module.exports = {
  MAX_RESULT_CHARS,
  REPORTS_DIR,
  VERIFICATION_LABELS,
  VERIFICATION_STATUSES,
  listReports,
  metadataFromFile,
  normalizeMetadata,
  normalizeVerification,
  readReport,
  reportMetadata,
  saveReport,
  toMarkdown,
  updateVerification,
};
