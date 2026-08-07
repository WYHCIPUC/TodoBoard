"use strict";
const { CATS, CAT_KEYWORDS } = require("./constants");

/** 基于关键字词库自动分类;0 分或平手按词库顺序优先 */
function classify(text) {
  const t = (text || "").toLowerCase();
  let best = "其他", bestScore = 0;
  for (const cat of CATS) {
    if (cat === "其他" || !CAT_KEYWORDS[cat]) continue;
    let s = 0;
    for (const kw of CAT_KEYWORDS[cat]) if (t.includes(kw)) s++;
    if (s > bestScore) { bestScore = s; best = cat; }
  }
  return best;
}

function categoryOfSectionTitle(t) {
  if (/收件箱|Inbox/i.test(t)) return "收件箱";
  if (/AI|Agent|智能/.test(t)) return "AI 工具";
  if (/硬件|嵌入式|DIY/.test(t)) return "硬件 & 嵌入式";
  if (/设计|前端|网页/.test(t)) return "前端 & 设计";
  if (/软件|工具|桌面/.test(t)) return "桌面 & 系统";
  if (/开源|开发/.test(t)) return "开源项目 & 开发";
  if (/搜索|OSINT/.test(t)) return "搜索 & OSINT";
  if (/教程|资源/.test(t)) return "教程 & 资源";
  if (/其他/.test(t)) return "其他";
  const custom = String(t || "")
    .replace(/^\s*\d+\.\s*/, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim();
  return custom || "其他";
}

function guessSource(url) {
  if (url.includes("bilibili.com")) return "B站视频";
  if (url.includes("mp.weixin.qq.com")) return "微信公众号原文";
  if (url.includes("github.com")) return "GitHub 仓库";
  return "来源";
}

module.exports = { classify, categoryOfSectionTitle, guessSource };
