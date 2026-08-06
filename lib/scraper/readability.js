"use strict";
const { httpGet } = require("../fetcher");
const { Readability } = require("@mozilla/readability");
const { parseHTML } = require("linkedom");
const TurndownService = require("turndown");

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

/**
 * 通用网页正文抓取:HTML → Readability 提正文 → Turndown 转 Markdown
 * @param {string} url
 * @returns {Promise<{ok, title, content, source, warning?}>}
 */
async function extract(url) {
  let html, host;
  try {
    const r = await httpGet(url, 10000, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      "Accept-Language": "zh-CN,zh;q=0.9",
    });
    if (r.status >= 400) {
      return { ok: false, title: "", content: "", source: "web", warning: `页面请求失败(HTTP ${r.status})` };
    }
    html = r.body;
    host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  } catch (e) {
    return { ok: false, title: "", content: "", source: "web", warning: "抓取失败: " + e.message };
  }

  // 用 linkedom 解析成标准 DOM
  let doc;
  try {
    doc = parseHTML(html).document;
  } catch (e) {
    return { ok: false, title: "", content: "", source: "web", warning: "HTML 解析失败: " + e.message };
  }

  // Readability 提正文
  try {
    const reader = new Readability(doc, { charThreshold: 100 });
    const article = reader.parse();
    if (!article || !article.content) {
      // 降级:尝试提取 og:description 或首段
      const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute("content") || "";
      const firstP = doc.querySelector("article p, .article p, p")?.textContent || "";
      const fallback = ogDesc || firstP;
      if (fallback) {
        return {
          ok: true,
          title: article?.title || doc.title || host || "网页正文",
          content: turndown.turndown(fallback).slice(0, 5 * 1024) + "\n\n> ⚠️ 正文提取不完整(Readability 未识别主正文),以上为摘要/首段降级。",
          source: "web(readability 降级)",
          warning: "正文提取不完整,已用摘要降级",
        };
      }
      return { ok: false, title: doc.title || "", content: "", source: "web", warning: "无法识别该页面正文内容(可能需要登录或为 JS 动态渲染页面)" };
    }
    // 转 Markdown
    const md = turndown.turndown(article.content).slice(0, 100 * 1024); // 截断 100KB
    return {
      ok: true,
      title: article.title || doc.title || host || "网页正文",
      content: md,
      source: "web(readability)",
    };
  } catch (e) {
    return { ok: false, title: "", content: "", source: "web", warning: "正文解析失败: " + e.message };
  }
}

module.exports = { extract };
