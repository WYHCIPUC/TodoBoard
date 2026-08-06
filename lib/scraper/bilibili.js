"use strict";
const { httpGet } = require("../fetcher");

/**
 * 抓取 B站视频字幕
 *
 * 流程(基于 SocialSisterYi/bilibili-API-collect 文档,2026-08 实测):
 *   1. GET /x/web-interface/view?bvid=  → 拿 cid / aid / title / desc
 *   2. GET /x/player/v2?cid=&aid=       → 拿 data.subtitle.subtitles[] (含 subtitle_url)
 *   3. GET subtitle_url (aisubtitle.hdslb.com 的 JSON) → 字幕正文
 *
 * 实测关键点:
 *   - player/v2 不需要登录 cookie 即可拿到字幕列表(返回 code:0)
 *   - 但绝大多数视频无字幕(UP主未传且无 AI 字幕),subtitle.subtitles 为 []
 *   - 此时降级为视频简介(desc)。desc 通常含章节标记,信息密度高
 *
 * @param {string} bvid - BV 开头的视频ID
 * @returns {Promise<{ok, title, content, source, warning?}>}
 */
async function scrapeSubtitle(bvid) {
  let title = "";
  try {
    // 1. 拿 aid + cid + 基本信息
    const r1 = await httpGet(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
    const d1 = JSON.parse(r1.body);
    if (!d1 || d1.code !== 0 || !d1.data) {
      // 视频不存在 / 稿件不可见 / 已删除等:d1.message 形如 "请求错误"/"稿件不可见"/"啥都木有"
      return {
        ok: false,
        title: bvid,
        content: "",
        source: "bilibili",
        warning: "视频信息获取失败: " + (d1 && d1.message ? d1.message : "HTTP " + r1.status),
      };
    }
    const { cid, aid } = d1.data;
    title = d1.data.title || bvid;

    // 2. 拿字幕列表(player/v2 不强制登录即可读 subtitle 字段)
    const r2 = await httpGet(`https://api.bilibili.com/x/player/v2?cid=${cid}&aid=${aid}`);
    const d2 = JSON.parse(r2.body);
    const subs = (d2.data && d2.data.subtitle && d2.data.subtitle.subtitles) || [];

    if (!subs.length) {
      // 无字幕:返回视频简介作为降级(简介常含章节/要点,信息量较高)
      const desc = (d1.data.desc || "").trim();
      const hasDesc = desc.length > 0;
      const body = hasDesc
        ? `> 该视频无公开字幕,以下为视频简介。\n\n${desc}`
        : "> 该视频无公开字幕,且无简介。";
      return {
        ok: true,
        title: title + "(无字幕·简介)",
        content: `# ${title}\n\n> B站视频 ${bvid}\n\n${body}\n\n> 字幕功能依赖视频有 AI 字幕或 UP 主上传字幕。`,
        source: "bilibili(简介降级)",
        warning: "该视频无公开字幕,已用简介降级",
      };
    }

    // 3. 优先选中文字幕(zh-CN / ai-zh / 任意 zh*),否则取第一个
    const pick =
      subs.find(s => s.lan === "zh-CN" || s.lan === "ai-zh") ||
      subs.find(s => typeof s.lan === "string" && s.lan.startsWith("zh")) ||
      subs[0];

    let url = pick.subtitle_url || "";
    if (!url) {
      // 异常:列表里有条目但无 URL
      const desc = (d1.data.desc || "").trim();
      return {
        ok: true,
        title: title + "(字幕条目异常·简介)",
        content: `# ${title}\n\n> B站视频 ${bvid}\n\n> 字幕条目缺少 URL,以下为简介。\n\n${desc || "(无简介)"}`,
        source: "bilibili(简介降级)",
        warning: "字幕条目缺少 subtitle_url,已用简介降级",
      };
    }
    if (url.startsWith("//")) url = "https:" + url;

    const r3 = await httpGet(url, 15000);
    let lines = [];
    try {
      const d3 = JSON.parse(r3.body);
      // B站字幕 JSON 结构: { body: [ { from, to, content }, ... ] }
      lines = (d3.body || []).map(x => x && x.content).filter(Boolean);
    } catch (_) {
      // subtitle_url 偶尔返回非 JSON(空 / 报错页),降级简介
      const desc = (d1.data.desc || "").trim();
      return {
        ok: true,
        title: title + "(字幕解析失败·简介)",
        content: `# ${title}\n\n> B站视频 ${bvid}\n\n> 字幕内容解析失败,以下为简介。\n\n${desc || "(无简介)"}`,
        source: "bilibili(简介降级)",
        warning: "字幕 JSON 解析失败,已用简介降级",
      };
    }

    if (!lines.length) {
      const desc = (d1.data.desc || "").trim();
      return {
        ok: true,
        title: title + "(字幕为空·简介)",
        content: `# ${title}\n\n> B站视频 ${bvid}\n\n> 字幕内容为空,以下为简介。\n\n${desc || "(无简介)"}`,
        source: "bilibili(简介降级)",
        warning: "字幕内容为空,已用简介降级",
      };
    }

    const lanLabel = pick.lan_doc || pick.lan || "未知语言";
    const fullText = lines.join("\n");
    return {
      ok: true,
      title: title + "(字幕)",
      content: `# ${title} 字幕\n\n> 来源: B站 ${bvid} · ${lanLabel}\n\n${fullText.slice(0, 100 * 1024)}`,
      source: `bilibili字幕(${pick.lan || lanLabel})`,
    };
  } catch (e) {
    return {
      ok: false,
      title: title || bvid,
      content: "",
      source: "bilibili",
      warning: "B站字幕抓取失败: " + e.message,
    };
  }
}

module.exports = { scrapeSubtitle };
