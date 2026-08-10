"use strict";

const { httpGet } = require("../fetcher");
const { Readability } = require("@mozilla/readability");
const { parseHTML } = require("linkedom");
const TurndownService = require("turndown");

const MAX_RAW_HTML = 20 * 1024 * 1024;
const MAX_MARKDOWN = 100 * 1024;
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
let httpGetImpl = httpGet;

function setHttpGet(fn) {
  httpGetImpl = typeof fn === "function" ? fn : httpGet;
}

function makeResult({ url, metadata = {}, markdown = "", rawHtml = "", imageCandidates = [], status, reasons = [], source = "web" }) {
  const normalizedReasons = reasons.filter(Boolean).map(reason => String(reason));
  const content = markdown || "";
  return {
    ok: status === "succeeded",
    status,
    state: status,
    url,
    metadata: { url, site: "web", ...metadata },
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

function collectMetadata(doc, url) {
  const get = selector => doc.querySelector(selector)?.getAttribute("content") || "";
  const title = get('meta[property="og:title"]') || get('meta[name="twitter:title"]') || doc.title || "";
  const description = get('meta[property="og:description"]') || get('meta[name="twitter:description"]') || get('meta[name="description"]') || "";
  const author = get('meta[name="author"]') || get('meta[property="article:author"]') || "";
  const imageCandidates = [get('meta[property="og:image"]'), get('meta[name="twitter:image"]'), get('meta[name="twitter:image:src"]')];
  for (const image of [...doc.querySelectorAll("img")]) imageCandidates.push(image.getAttribute("src") || "");
  const absoluteImages = imageCandidates.filter(Boolean).map(image => {
    try { return new URL(image, url).href; } catch (_) { return ""; }
  });
  return {
    title: String(title).trim().slice(0, 200),
    description: String(description).replace(/\s+/g, " ").trim().slice(0, 500),
    author: String(author).trim().slice(0, 200),
    imageCandidates: absoluteImages.filter(Boolean),
  };
}

async function extract(url) {
  let response;
  try {
    response = await httpGetImpl(url, 10000, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      "Accept-Language": "zh-CN,zh;q=0.9",
    }, MAX_RAW_HTML);
  } catch (error) {
    return makeResult({ url, status: "manual_required", reasons: [`抓取失败：${error.message}`] });
  }
  const rawHtml = String(response.body || "").slice(0, MAX_RAW_HTML);
  if (response.status >= 400) {
    return makeResult({ url, rawHtml, status: "manual_required", reasons: [`页面请求失败（HTTP ${response.status}）`] });
  }
  let doc;
  try {
    doc = parseHTML(rawHtml).document;
  } catch (error) {
    return makeResult({ url, rawHtml, status: "manual_required", reasons: [`HTML 解析失败：${error.message}`] });
  }

  const extracted = collectMetadata(doc, url);
  const metadata = {
    title: extracted.title,
    description: extracted.description,
    author: extracted.author,
  };
  try {
    const article = new Readability(doc, { charThreshold: 100 }).parse();
    if (article?.content) {
      const markdown = turndown.turndown(article.content).slice(0, MAX_MARKDOWN);
      const reasons = markdown.length < turndown.turndown(article.content).length ? ["正文超过 100 KB，已截断 Markdown"] : [];
      return makeResult({
        url,
        metadata: { ...metadata, title: article.title || metadata.title, excerpt: article.excerpt || "" },
        markdown,
        rawHtml,
        imageCandidates: extracted.imageCandidates,
        status: "succeeded",
        reasons,
        source: "web(readability)",
      });
    }
  } catch (error) {
    return makeResult({ url, metadata, rawHtml, imageCandidates: extracted.imageCandidates, status: "partial", reasons: [`正文解析失败：${error.message}`], source: "web" });
  }

  const fallback = extracted.description || doc.querySelector("article p, .article p, p")?.textContent?.trim() || "";
  if (fallback) {
    return makeResult({
      url,
      metadata,
      markdown: turndown.turndown(fallback).slice(0, 5 * 1024),
      rawHtml,
      imageCandidates: extracted.imageCandidates,
      status: "partial",
      reasons: ["Readability 未识别主正文，已使用摘要降级"],
      source: "web(readability fallback)",
    });
  }
  return makeResult({ url, metadata, rawHtml, imageCandidates: extracted.imageCandidates, status: "manual_required", reasons: ["无法识别页面正文，可能需要登录或 JavaScript 渲染"] });
}

module.exports = { extract, setHttpGet, _internals: { collectMetadata, makeResult } };
