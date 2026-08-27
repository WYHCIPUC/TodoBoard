"use strict";

const EMPTY_CONTENT = "> 暂无可用正文，请手动补录内容。";
const MIN_AUTOMATIC_CHARS = 40;
const MIN_REPLACEMENT_RATIO = 0.6;
const AUTHORITIES = Object.freeze({
  manual: 5,
  official_api: 4,
  official_raw: 4,
  site_scraper: 3,
  readability: 2,
  metadata: 1,
  placeholder: 0,
});
const QUALITY = Object.freeze({ unusable: 0, usable_partial: 1, usable_clean: 2 });

function normalizeContent(content, title) {
  let lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] === "# " + String(title || "")) lines.shift();
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && /^> (来源|作者|摘要):/.test(lines[0])) {
    lines.shift();
    while (lines.length && lines[0] === "") lines.shift();
  }
  return lines.join("\n").replace(/\p{White_Space}+/gu, " ").trim();
}

function codePointLength(value) {
  return [...String(value || "")].length;
}

function validateAuthority(value, options = {}) {
  if (value === "legacy_unknown" && options.allowLegacy) return value;
  if (!Object.prototype.hasOwnProperty.call(AUTHORITIES, value)) {
    const error = new Error("归档 authority 非法");
    error.code = "invalid_authority";
    throw error;
  }
  return value;
}

function assessCandidate(candidate) {
  const authority = validateAuthority(candidate.authority, { allowLegacy: true });
  const manual = authority === "manual";
  const normalized = normalizeContent(candidate.content, candidate.title);
  const normalizedChars = codePointLength(normalized);
  const placeholder = normalized === normalizeContent(EMPTY_CONTENT, candidate.title);
  const usable = manual ? Boolean(normalized) && !placeholder : normalizedChars >= MIN_AUTOMATIC_CHARS && !placeholder;
  const captureState = candidate.captureState || (manual ? "manual" : "succeeded");
  let state = "unusable";
  if (usable) {
    state = captureState === "partial" || candidate.missingOptional === true ? "usable_partial" : "usable_clean";
  }
  if (["failed", "manual_required"].includes(captureState)) state = "unusable";
  return { manual, authority, state, normalizedChars, normalized, usable: state !== "unusable" };
}

function compareCandidate(candidate, active) {
  const next = candidate.state ? candidate : assessCandidate(candidate);
  if (next.state === "unusable") return { accepted: false, reasonCode: "candidate_unusable", ratio: null };
  if (!active) return { accepted: true, reasonCode: null, ratio: null };
  const current = active.state ? active : assessCandidate(active);
  if (current.authority === "legacy_unknown" && next.authority !== "manual") {
    return { accepted: false, reasonCode: "candidate_lower_quality", ratio: null };
  }
  if (current.manual && !next.manual) return { accepted: false, reasonCode: "candidate_lower_quality", ratio: null };
  if (next.manual) return { accepted: true, reasonCode: null, ratio: current.normalizedChars ? next.normalizedChars / current.normalizedChars : null };
  validateAuthority(current.authority, { allowLegacy: true });
  if (QUALITY[next.state] < QUALITY[current.state] || AUTHORITIES[next.authority] < AUTHORITIES[current.authority]) {
    return { accepted: false, reasonCode: "candidate_lower_quality", ratio: current.normalizedChars ? next.normalizedChars / current.normalizedChars : null };
  }
  const ratio = current.normalizedChars ? next.normalizedChars / current.normalizedChars : 1;
  return ratio >= MIN_REPLACEMENT_RATIO
    ? { accepted: true, reasonCode: null, ratio }
    : { accepted: false, reasonCode: "candidate_lower_quality", ratio };
}

module.exports = {
  AUTHORITIES,
  EMPTY_CONTENT,
  MIN_AUTOMATIC_CHARS,
  MIN_REPLACEMENT_RATIO,
  QUALITY,
  assessCandidate,
  codePointLength,
  compareCandidate,
  normalizeContent,
  validateAuthority,
};
