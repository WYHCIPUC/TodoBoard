"use strict";

const { parseUrl } = require("../fetcher");
const github = require("./github");
const bilibili = require("./bilibili");
const readability = require("./readability");
const x = require("./x");

const SCRAPER_RESULT_FIELDS = ["url", "metadata", "markdown", "imageCandidates", "rawHtml", "status", "reasons"];

function normalizeResult(value, url) {
  const raw = value || {};
  const markdown = raw.markdown ?? raw.content ?? "";
  const reasons = Array.isArray(raw.reasons) ? raw.reasons.filter(Boolean) : (raw.warning ? [raw.warning] : []);
  const status = raw.status || (raw.ok ? "succeeded" : (markdown ? "partial" : "manual_required"));
  const metadata = { url, ...(raw.metadata || {}) };
  return {
    ...raw,
    ok: status === "succeeded",
    status,
    state: status,
    url,
    metadata,
    markdown,
    content: markdown,
    imageCandidates: [...new Set((raw.imageCandidates || []).filter(Boolean))],
    rawHtml: raw.rawHtml || "",
    reasons,
    title: raw.title || metadata.title || "",
    author: raw.author || metadata.author || "",
    warning: reasons[0] || "",
  };
}

/** Route every supported link to the frozen RA-2 scraper result contract. */
async function scrapeContent(url) {
  const parsed = parseUrl(url);
  let value;
  if (parsed.kind === "github" && parsed.repo) value = await github.scrape(parsed.repo);
  else if (parsed.kind === "x") value = await x.scrape(url);
  else if (parsed.kind === "bilibili" && parsed.bvid) value = await bilibili.scrapeSubtitle(parsed.bvid);
  else value = await readability.extract(url);
  return normalizeResult(value, value?.url || url);
}

module.exports = { scrapeContent, normalizeResult, SCRAPER_RESULT_FIELDS };
