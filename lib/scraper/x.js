"use strict";

const { httpGet } = require("../fetcher");
const { parseHTML } = require("linkedom");

let httpGetImpl = httpGet;

function redact(value) {
  const secret = process.env.X_COOKIE;
  if (!secret) return value;
  if (typeof value === "string") return value.split(secret).join("[redacted]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redact(child)]));
  return value;
}

function setHttpGet(fn) {
  httpGetImpl = typeof fn === "function" ? fn : httpGet;
}

function parseStatusUrl(input) {
  let url;
  try { url = new URL(input); } catch (_) { return null; }
  const host = url.hostname.toLowerCase();
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0].toLowerCase() !== "i" && parts[1].toLowerCase() === "status" && /^\d+$/.test(parts[2])) {
    return { id: parts[2], username: parts[0], canonicalUrl: `https://x.com/${parts[0]}/status/${parts[2]}` };
  }
  if (parts.length === 3 && parts[0].toLowerCase() === "i" && parts[1].toLowerCase() === "status" && /^\d+$/.test(parts[2])) {
    return { id: parts[2], username: "", canonicalUrl: `https://x.com/i/status/${parts[2]}` };
  }
  return null;
}

function makeResult({ url, metadata = {}, markdown = "", imageCandidates = [], rawHtml = "", status, reasons = [], source = "X" }) {
  const normalizedReasons = redact(reasons.filter(Boolean).map(reason => String(reason)));
  const content = redact(markdown || "");
  const safeMetadata = redact(metadata);
  return {
    ok: status === "succeeded",
    status,
    state: status,
    url,
    metadata: { url, canonicalUrl: url, site: "X", ...safeMetadata },
    markdown: content,
    content,
    imageCandidates: [...new Set(redact(imageCandidates.filter(Boolean)))],
    rawHtml: redact(rawHtml || ""),
    reasons: normalizedReasons,
    title: safeMetadata.title || "",
    author: safeMetadata.author || "",
    source,
    warning: normalizedReasons[0] || "",
  };
}

function textValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function metaFromDocument(doc, url) {
  const value = selector => doc.querySelector(selector)?.getAttribute("content") || "";
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || url;
  const images = [value('meta[property="og:image"]'), value('meta[name="twitter:image"]'), value('meta[name="twitter:image:src"]')];
  return {
    title: textValue(value('meta[property="og:title"]') || value('meta[name="twitter:title"]') || doc.title),
    description: textValue(value('meta[property="og:description"]') || value('meta[name="twitter:description"]') || value('meta[name="description"]')),
    author: textValue(value('meta[name="author"]')),
    canonicalUrl: canonical,
    imageCandidates: images.filter(Boolean),
  };
}

function walkTweet(value, found = { tweet: null, user: null, images: [] }) {
  if (!value || typeof value !== "object" || found.tweet) return found;
  if (Array.isArray(value)) {
    for (const item of value) walkTweet(item, found);
    return found;
  }
  const legacy = value.legacy && typeof value.legacy === "object" ? value.legacy : value;
  if (legacy.full_text || (legacy.text && (legacy.entities || value.core || value.user_results))) {
    found.tweet = legacy;
    const user = value.core?.user_results?.result?.legacy || value.user_results?.result?.legacy || value.user;
    if (user) found.user = user;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "full_text" || key === "text" || key === "legacy") continue;
    walkTweet(child, found);
  }
  return found;
}

function hydrationFromDocument(doc) {
  const found = { tweet: null, user: null, images: [] };
  for (const script of [...doc.querySelectorAll("script")]) {
    const text = script.textContent || "";
    if (!text.trim() || !/tweet|status|full_text|hydration/i.test(text)) continue;
    try { walkTweet(JSON.parse(text), found); } catch (_) { /* not every script is JSON */ }
    if (found.tweet) break;
  }
  const tweet = found.tweet;
  if (!tweet) return { markdown: "", metadata: {}, imageCandidates: [] };
  const images = [];
  for (const media of tweet.entities?.media || []) images.push(media.media_url_https || media.media_url || "");
  for (const media of tweet.extended_entities?.media || []) images.push(media.media_url_https || media.media_url || "");
  const user = found.user || {};
  return {
    markdown: textValue(tweet.full_text || tweet.text),
    metadata: {
      author: user.screen_name ? `@${user.screen_name}` : "",
      authorName: user.name || "",
      publishedAt: tweet.created_at || "",
      tweetId: tweet.id_str || tweet.id || "",
    },
    imageCandidates: images.filter(Boolean),
  };
}

function fromSyndication(data) {
  if (!data || typeof data !== "object") return null;
  const images = [];
  for (const media of data.mediaDetails || data.media_details || []) images.push(media.media_url_https || media.media_url || "");
  return {
    markdown: textValue(data.text || data.full_text),
    metadata: {
      author: data.user?.screen_name ? `@${data.user.screen_name}` : (data.user?.name || ""),
      authorName: data.user?.name || "",
      publishedAt: data.created_at || "",
      tweetId: data.id_str || data.id || "",
    },
    imageCandidates: images.filter(Boolean),
  };
}

async function request(url, headers = {}) {
  try { return await httpGetImpl(url, 10000, headers, 6 * 1024 * 1024); }
  catch (error) { return { status: 0, body: "", error }; }
}

function resultFromParsed(parsed, metadata, markdown, images, rawHtml, reasons, source) {
  const usableText = textValue(markdown);
  return makeResult({
    url: parsed.canonicalUrl,
    metadata: { ...metadata, canonicalUrl: parsed.canonicalUrl, tweetId: metadata.tweetId || parsed.id, username: metadata.username || parsed.username },
    markdown: usableText,
    imageCandidates: images,
    rawHtml,
    status: usableText ? "succeeded" : "manual_required",
    reasons,
    source,
  });
}

async function scrape(inputUrl) {
  const parsed = parseStatusUrl(inputUrl);
  if (!parsed) {
    return makeResult({ url: String(inputUrl || ""), status: "manual_required", reasons: ["仅支持 X/Twitter 的 canonical /status/{id} 地址"] });
  }
  const reasons = [];
  const baseMetadata = { tweetId: parsed.id, username: parsed.username };
  const target = new URL(parsed.canonicalUrl);
  const cookie = process.env.X_COOKIE;
  const headers = {
    "User-Agent": "Mozilla/5.0 (compatible; LingganArchive/1.0)",
    "Accept-Language": "en-US,en;q=0.8",
  };
  // The cookie is read only for the first-party page request. It is never
  // copied into a result, error, log, fallback URL, or persisted metadata.
  if (cookie && (target.hostname === "x.com" || target.hostname === "twitter.com")) headers.Cookie = cookie;

  const page = await request(parsed.canonicalUrl, headers);
  let staticMetadata = baseMetadata;
  let rawHtml = "";
  if (page.status === 200 && page.body) {
    rawHtml = String(page.body);
    try {
      const doc = parseHTML(rawHtml).document;
      const meta = metaFromDocument(doc, parsed.canonicalUrl);
      const hydration = hydrationFromDocument(doc);
      staticMetadata = { ...baseMetadata, ...meta, ...hydration.metadata };
      const images = [...(meta.imageCandidates || []), ...(hydration.imageCandidates || [])];
      if (hydration.markdown || meta.description) {
        return resultFromParsed(parsed, staticMetadata, hydration.markdown || meta.description, images, rawHtml, reasons, "X(static/hydration)");
      }
    } catch (error) {
      reasons.push(`X 页面解析失败：${error.message}`);
    }
  } else if (page.status) {
    reasons.push(page.status === 403 || page.status === 429 ? `X 页面受限（HTTP ${page.status}）` : `X 页面不可用（HTTP ${page.status}）`);
  } else if (page.error) {
    reasons.push(`X 页面请求失败：${page.error.message}`);
  }

  const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(parsed.id)}&lang=en`;
  const syndication = await request(syndicationUrl);
  if (syndication.status === 200) {
    const data = (() => { try { return JSON.parse(syndication.body); } catch (_) { return null; } })();
    const parsedSyndication = fromSyndication(data);
    if (parsedSyndication?.markdown) {
      reasons.push("静态页面不可用，已使用公开官方 syndication 降级");
      return resultFromParsed(parsed, { ...staticMetadata, ...parsedSyndication.metadata }, parsedSyndication.markdown, parsedSyndication.imageCandidates, rawHtml, reasons, "X(syndication)");
    }
  } else if (syndication.status) {
    reasons.push(`X syndication 不可用（HTTP ${syndication.status}）`);
  }

  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(parsed.canonicalUrl)}&omit_script=1`;
  const oembed = await request(oembedUrl);
  if (oembed.status === 200) {
    const data = (() => { try { return JSON.parse(oembed.body); } catch (_) { return null; } })();
    const html = data?.html || "";
    const text = (() => {
      try {
        const document = parseHTML(html).document;
        return textValue(document.querySelector("blockquote")?.textContent || document.documentElement?.textContent || "");
      } catch (_) { return ""; }
    })();
    if (text) {
      reasons.push("静态页面不可用，已使用公开 oEmbed 降级");
      return resultFromParsed(parsed, { ...staticMetadata, author: data.author_name ? `@${data.author_name}` : staticMetadata.author }, text, [data.thumbnail_url], rawHtml, reasons, "X(oEmbed)");
    }
  } else if (oembed.status) {
    reasons.push(`X oEmbed 不可用（HTTP ${oembed.status}）`);
  }

  return resultFromParsed(parsed, staticMetadata, "", [], rawHtml, reasons.length ? reasons : ["X 内容不可用，需要手动补录"], "X");
}

module.exports = { scrape, parseStatusUrl, setHttpGet, _internals: { metaFromDocument, hydrationFromDocument, fromSyndication } };
