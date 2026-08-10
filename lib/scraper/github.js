"use strict";

const { httpGet } = require("../fetcher");

const MAX_MARKDOWN = 100 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;
const BRANCH_FALLBACKS = ["default", "main", "master", "develop", "trunk"];
const README_NAMES = [
  "README.md", "readme.md", "README.MD", "README.markdown", "README.rst", "README",
];

let httpGetImpl = httpGet;

function setHttpGet(fn) {
  httpGetImpl = typeof fn === "function" ? fn : httpGet;
}

function result({ url, metadata = {}, markdown = "", imageCandidates = [], rawHtml = "", status, reasons = [], source = "GitHub" }) {
  const normalizedReasons = reasons.filter(Boolean).map(reason => String(reason));
  const content = markdown || "";
  return {
    ok: status === "succeeded",
    status,
    state: status,
    url,
    metadata: { url, site: "GitHub", ...metadata },
    markdown: content,
    content,
    imageCandidates: [...new Set(imageCandidates.filter(Boolean))],
    rawHtml: rawHtml || "",
    reasons: normalizedReasons,
    title: metadata.title || "",
    author: metadata.author || "",
    source,
    warning: normalizedReasons[0] || "",
  };
}

function safeRepo(repo) {
  return /^[-.\w]+\/[-.\w]+$/.test(String(repo || "")) ? repo : "";
}

function parseJson(body) {
  try { return JSON.parse(body); } catch (_) { return null; }
}

function responseReason(label, response) {
  if (!response) return `${label}请求失败`;
  if (response.status === 403 || response.status === 429) return `${label}受限（HTTP ${response.status}），已使用公开 README 降级路径`;
  return `${label}不可用（HTTP ${response.status}）`;
}

function readmeImages(markdown, rawUrl) {
  const images = [];
  const add = value => {
    if (!value || /^data:/i.test(value)) return;
    try { images.push(new URL(value, rawUrl).href); } catch (_) { /* ignore malformed markdown URL */ }
  };
  for (const match of String(markdown || "").matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) add(match[1]);
  for (const match of String(markdown || "").matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) add(match[1]);
  return images;
}

async function get(url, headers = {}) {
  try {
    return await httpGetImpl(url, 10000, headers, MAX_RESPONSE);
  } catch (error) {
    return { status: 0, body: "", error };
  }
}

async function discoverReadme(repo, branch, reasons) {
  const response = await get(`https://api.github.com/repos/${repo}/contents?ref=${encodeURIComponent(branch)}`, {
    "Accept": "application/vnd.github+json",
    "User-Agent": "linggankanban/1.0",
  });
  if (response.status !== 200) {
    if (response.status === 403 || response.status === 429) reasons.push(responseReason("GitHub contents API", response));
    return [];
  }
  const listing = parseJson(response.body);
  if (!Array.isArray(listing)) return [];
  return listing
    .filter(item => item && item.type === "file" && /^readme(?:\.|$)/i.test(item.name || ""))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map(item => item.path)
    .filter(Boolean);
}

async function readRaw(repo, branch, file) {
  const rawUrl = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${file.split("/").map(encodeURIComponent).join("/")}`;
  const response = await get(rawUrl, { "User-Agent": "linggankanban/1.0" });
  if (response.status === 200 && String(response.body || "").trim()) {
    return { ...response, rawUrl };
  }
  return null;
}

/**
 * Scrape a public GitHub repository README.
 * The returned object is deliberately stable for RA-2: metadata, markdown,
 * imageCandidates, rawHtml, status and reasons are always present.
 */
async function scrape(repo) {
  const cleanRepo = safeRepo(repo);
  const url = cleanRepo ? `https://github.com/${cleanRepo}` : `https://github.com/${String(repo || "")}`;
  const reasons = [];
  if (!cleanRepo) {
    return result({ url, status: "manual_required", reasons: ["GitHub 仓库地址格式无效"] });
  }

  let metadata = { repository: cleanRepo, title: cleanRepo, author: cleanRepo.split("/")[0] };
  const api = await get(`https://api.github.com/repos/${cleanRepo}`, {
    "Accept": "application/vnd.github+json",
    "User-Agent": "linggankanban/1.0",
  });
  const repoData = api.status === 200 ? parseJson(api.body) : null;
  if (repoData && repoData.full_name) {
    metadata = {
      ...metadata,
      repository: repoData.full_name,
      title: repoData.full_name,
      author: repoData.owner?.login || metadata.author,
      description: repoData.description || "",
      defaultBranch: repoData.default_branch || "",
      branch: repoData.default_branch || "",
      language: repoData.language || "",
      stars: Number(repoData.stargazers_count) || 0,
      avatar: repoData.owner?.avatar_url || "",
    };
  } else {
    reasons.push(api.error ? `GitHub API 请求失败：${api.error.message}` : responseReason("GitHub API", api));
  }

  const branches = [...new Set([
    metadata.defaultBranch,
    ...BRANCH_FALLBACKS,
  ].filter(Boolean))];
  for (const branch of branches) {
    const discovered = await discoverReadme(cleanRepo, branch, reasons);
    const files = [...new Set([...discovered, ...README_NAMES])];
    for (const file of files) {
      const raw = await readRaw(cleanRepo, branch, file);
      if (!raw) continue;
      const markdown = String(raw.body).slice(0, MAX_MARKDOWN);
      const truncated = String(raw.body).length > MAX_MARKDOWN;
      metadata = { ...metadata, branch, readmePath: file };
      if (truncated) reasons.push("README 超过 100 KB，已截断 Markdown");
      return result({
        url,
        metadata,
        markdown,
        imageCandidates: [metadata.avatar, ...readmeImages(markdown, raw.rawUrl)],
        status: "succeeded",
        reasons,
        source: `GitHub raw (${branch}/${file})`,
      });
    }
  }

  reasons.push("未找到可读取的 README，已保留仓库元数据");
  return result({ url, metadata, status: repoData ? "partial" : "manual_required", reasons });
}

module.exports = { scrape, setHttpGet, _internals: { readmeImages, safeRepo } };
