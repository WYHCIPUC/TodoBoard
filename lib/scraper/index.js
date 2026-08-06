"use strict";
const { parseUrl } = require("../fetcher");
const github = require("./github");
const bilibili = require("./bilibili");
const readability = require("./readability");

/**
 * 统一抓取入口,按 URL 自动路由
 * @param {string} url
 * @returns {Promise<{ok, title, content, source, warning?}>}
 */
async function scrapeContent(url) {
  const parsed = parseUrl(url);
  if (parsed.kind === "github" && parsed.repo) {
    return github.scrape(parsed.repo);
  }
  // B站视频:走官方字幕 API,无字幕时自动降级为视频简介
  if (parsed.kind === "bilibili" && parsed.bvid) {
    return bilibili.scrapeSubtitle(parsed.bvid);
  }
  // 所有其他 web 链接走通用正文抓取
  return readability.extract(url);
}

module.exports = { scrapeContent };
