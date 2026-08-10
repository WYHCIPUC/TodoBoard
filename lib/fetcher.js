"use strict";
const http = require("http");
const https = require("https");
const net = require("net");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const { classify } = require("./classifier");
const { assertPublicUrl } = require("./safeurl");

/* ============================================================
 * 解析记录日志（默认 docs/fetch-log.md）
 * 每次预览 / 入库都追加一行；超 LOG_MAX_LINES 行自动裁剪最旧记录
 * ============================================================ */
const DIR = __dirname;
const LOG_FILE = process.env.FETCH_LOG_FILE
  ? path.resolve(process.env.FETCH_LOG_FILE)
  : path.join(__dirname, "..", "docs", "fetch-log.md");
const LOG_MAX_LINES = 3000;

function appendLog({ stage, result, title, url, mode, error }) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const esc = s => String(s || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 500);
    const ts = new Date().toLocaleString("zh-CN", { hour12: false });
    const HEADER = "# 🔗 链接解析记录\n\n> 每次预览 / 入库自动记录；超 " + LOG_MAX_LINES + " 行自动裁剪最旧记录。\n\n| 时间 | 入口 | 结果 | 标题 | 方式 | 链接 | 备注 |\n| --- | --- | --- | --- | --- | --- | --- |";
    const row = `| ${ts} | ${esc(stage)} | ${esc(result)} | ${esc(title)} | ${esc(mode)} | ${esc(url)} | ${esc(error)} |`;
    let lines = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf-8").split(/\r?\n/) : [];
    const body = lines.filter(l => {
      const t = l.trim();
      return t && !t.startsWith("#") && !t.startsWith(">") && !t.startsWith("| 时间") && !/^\| -+/.test(t);
    });
    body.push(row);
    const kept = body.length > LOG_MAX_LINES - 8 ? body.slice(body.length - (LOG_MAX_LINES - 8)) : body;
    fs.writeFileSync(LOG_FILE, HEADER + "\n" + kept.join("\n") + "\n", "utf-8");
  } catch (_) { /* 日志失败不影响主流程 */ }
}

/* ============================================================
 * 代理支持（零依赖）
 * 优先级：环境变量 HTTPS_PROXY / ALL_PROXY / PROXY_URL（http 用 HTTP_PROXY）
 * 未配置时自动探测常见本地代理端口（Clash 7890/7897、v2rayN 10808/10809 等），
 * 仅当直连失败时才启用；探测结果缓存 5 分钟
 * ============================================================ */
const PROXY_ENV = (process.env.HTTPS_PROXY || process.env.https_proxy
  || process.env.HTTP_PROXY || process.env.http_proxy
  || process.env.ALL_PROXY || process.env.all_proxy
  || process.env.PROXY_URL || "").trim();
const AUTO_PROXY_PORTS = [7890, 7897, 10809, 10808, 2080, 1080, 8888];
let proxyCache = { found: null, time: 0 };

function parseProxyEnv() {
  if (!PROXY_ENV) return null;
  let s = PROXY_ENV;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    const port = Number(u.port || 80);
    if (u.hostname && port) return { host: u.hostname, port };
  } catch (_) { /* 非法代理配置 */ }
  return null;
}

/** 已配置或已探测到的代理（同步读取，不触发探测） */
function getProxyCached() {
  const env = parseProxyEnv();
  if (env) return env;
  return proxyCache.found;
}

function probePort(host, port, ms = 300) {
  return new Promise(resolve => {
    const s = net.connect({ host, port });
    let done = false;
    const finish = ok => { if (done) return; done = true; try { s.destroy(); } catch (_) {} resolve(ok); };
    s.setTimeout(ms, () => finish(false));
    s.once("connect", () => finish(true));
    s.once("error", () => finish(false));
  });
}

/** 探测常见本地代理端口（并行，最多约 300ms）；5 分钟内只探测一次 */
async function detectProxy() {
  if (proxyCache.found) return proxyCache.found;
  if (Date.now() - proxyCache.time < 5 * 60 * 1000) return null;
  proxyCache.time = Date.now();
  const list = await Promise.all(AUTO_PROXY_PORTS.map(p => probePort("127.0.0.1", p)));
  const idx = list.indexOf(true);
  const found = idx >= 0 ? { host: "127.0.0.1", port: AUTO_PROXY_PORTS[idx] } : null;
  proxyCache.found = found;
  return found;
}

/** HTTPS 走 HTTP 代理：先建 CONNECT 隧道，返回已连通的 socket */
function tunnelConnect(proxy, host, port, timeout) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: proxy.host, port: proxy.port });
    const fail = e => { try { sock.destroy(); } catch (_) {} reject(e); };
    sock.setTimeout(timeout, () => fail(new Error("代理连接超时")));
    sock.once("error", fail);
    sock.once("connect", () => {
      sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    let buf = "";
    sock.on("data", d => {
      buf += d.toString("latin1");
      const idx = buf.indexOf("\r\n\r\n");
      if (idx < 0) return;
      const code = parseInt(buf.slice(0, idx).split(" ")[1], 10);
      if (code === 200) { sock.removeAllListeners("data"); sock.setTimeout(0); resolve(sock); }
      else fail(new Error("代理 CONNECT 失败（HTTP " + code + "）"));
    });
  });
}

/* ============================================================
 * HTTP 抓取：直连 + 代理竞争 + 快速失败重试
 * ============================================================ */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 仅对「秒断」类网络错误重试（TLS 握手被断开 / ECONNRESET / EPIPE）；超时类不重试 */
function isRetryable(e) {
  const c = e && e.code || "";
  const m = String(e && e.message || "");
  return c === "ECONNRESET" || c === "EPIPE"
    || /socket disconnected|secure TLS|tls handshake|wrong version/i.test(m);
}

/** 响应处理（直连 / 代理共用）：跟随重定向（最多 5 跳）、缓冲正文、记录传输方式。
 *  由 mod.get 的回调直接传入 res（response 事件已触发，不能再注册 on('response')）。
 *  超时用「数据驱动」的手动定时器：收到数据即重新计时（Windows 上 socket.timeout 与 TLS 存在误触发问题） */
function handleResponse(req, res, resolve, reject, url, timeout, headers, maxBody, redirects, via) {
  if (process.env.DEBUG_FETCH) console.log("[dbg] 收到响应:", res.statusCode, "via:", via);
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    if (redirects <= 0) { reject(new Error("重定向次数过多")); res.resume(); return; }
    let target;
    try { target = new URL(res.headers.location, url).href; }
    catch (_) { reject(new Error("无效的重定向地址")); res.resume(); return; }
    resolve(requestWithTransport(target, timeout, headers, maxBody, redirects - 1));
    res.resume();
    return;
  }
  // 缓冲为 Buffer：二进制安全，避免 gzip/deflate 字节被字符串拼接破坏
  // (此前用 data += c 把 Buffer 隐式转 UTF-16 字符串，会损坏压缩字节，
  //  导致 gzip 响应无法解析—— eyedex.org 等强制 gzip 的站点会失败)
  const chunks = [];
  let dataLen = 0;
  let stalled = false;
  let oversized = false;
  let stallTimer = null;
  const armStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => { if (process.env.DEBUG_FETCH) console.log("[dbg] stallTimer 触发"); stalled = true; req.destroy(new Error("抓取超时")); }, timeout);
  };
  armStall();
  res.on("data", c => {
    if (stalled) return;
    armStall();
    dataLen += c.length;
    if (dataLen > maxBody) {
      oversized = true;
      res.destroy();
      req.destroy(new Error("响应体超过大小限制"));
      return;
    }
    chunks.push(c);
  });
  res.on("end", () => {
    clearTimeout(stallTimer);
    if (oversized) {
      reject(new Error("响应体超过大小限制"));
      return;
    }
    if (process.env.DEBUG_FETCH) console.log("[dbg] 正文结束");
    const buf = Buffer.concat(chunks);
    // 解压 content-encoding(gzip/deflate/br),按声明编码处理;失败则原样返回(不阻断)
    const enc = (res.headers["content-encoding"] || "").toLowerCase();
    let body;
    try {
      if (enc.includes("gzip")) body = zlib.gunzipSync(buf).toString("utf8");
      else if (enc.includes("deflate")) body = zlib.inflateSync(buf).toString("utf8");
      else if (enc.includes("br")) body = zlib.brotliDecompressSync(buf).toString("utf8");
      else body = buf.toString("utf8");
    } catch (e) {
      if (process.env.DEBUG_FETCH) console.log("[dbg] 解压失败,使用原始字节:", e.message);
      body = buf.toString("utf8");
    }
    resolve({ status: res.statusCode, body, transport: via });
  });
}

/** 直连请求（带连接阶段超时，避免被墙域名挂到系统级超时）。
 *  autoSelectFamily: 域名多 IP 时做 Happy Eyeballs 回退（默认只连第一个 IP，首个 IP 被墙会卡死） */
function httpGetDirect(u, timeout, headers, maxBody, redirects) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    if (process.env.DEBUG_FETCH) console.log("[dbg] httpGetDirect 发起:", u.href);
    const req = mod.get(u, {
      headers: Object.assign({
        "User-Agent": UA,
        "Accept-Language": "zh-CN,zh;q=0.9",
      }, headers),
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 500,
    }, res => handleResponse(req, res, resolve, reject, u.href, timeout, headers, maxBody, redirects, "直连"));
    const connTimer = setTimeout(() => { if (process.env.DEBUG_FETCH) console.log("[dbg] connTimer 触发"); req.destroy(new Error("连接超时")); }, timeout);
    req.once("response", () => { if (process.env.DEBUG_FETCH) console.log("[dbg] response 事件"); clearTimeout(connTimer); });
    req.once("close", () => { if (process.env.DEBUG_FETCH) console.log("[dbg] close 事件"); clearTimeout(connTimer); });
    req.on("error", e => { if (process.env.DEBUG_FETCH) console.log("[dbg] error:", e.message); reject(e); });
    req.on("socket", s => {
      if (!process.env.DEBUG_FETCH) return;
      console.log("[dbg] socket 事件");
      s.once("connect", () => console.log("[dbg] socket connect"));
      s.once("secureConnect", () => console.log("[dbg] secureConnect"));
    });
  });
}

/** 经 HTTP 代理请求：https 走 CONNECT 隧道，http 走绝对 URI */
function httpGetViaProxy(u, proxy, timeout, headers, maxBody, redirects) {
  const common = { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" };
  return new Promise((resolve, reject) => {
    if (u.protocol === "https:") {
      tunnelConnect(proxy, u.hostname, u.port || 443, timeout)
        .then(sock => {
          const req = https.request({
            host: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            method: "GET",
            headers: Object.assign(common, headers),
            agent: false,
            createConnection: () => sock,
          }, res => handleResponse(req, res, resolve, reject, u.href, timeout, headers, maxBody, redirects, "代理"));
          const connTimer = setTimeout(() => req.destroy(new Error("连接超时")), timeout);
          req.once("response", () => clearTimeout(connTimer));
          req.once("close", () => clearTimeout(connTimer));
          req.on("error", reject);
        })
        .catch(reject);
    } else {
      const req = http.request({
        host: proxy.host,
        port: proxy.port,
        path: u.href,
        method: "GET",
        headers: Object.assign(common, headers),
        autoSelectFamily: true,
        autoSelectFamilyAttemptTimeout: 500,
      }, res => handleResponse(req, res, resolve, reject, u.href, timeout, headers, maxBody, redirects, "代理"));
      req.on("error", reject);
    }
  });
}

/** 竞争取第一个成功结果（任一成功即返回；全部失败取第一个错误） */
function firstSuccess(promises) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const errs = [];
    for (const p of promises) {
      p.then(r => { if (!settled) { settled = true; resolve(r); } },
        e => { errs.push(e); if (errs.length === promises.length && !settled) { settled = true; reject(errs[0]); } });
    }
  });
}

/** 带代理的请求入口：先做 SSRF 校验（重定向链同样经过本入口）；已知代理则与直连竞争；全部失败且未探测过代理时，探测本地代理再试一次 */
function requestWithTransport(url, timeout, headers, maxBody, redirects) {
  let u;
  try { u = new URL(url); }
  catch (_) { return Promise.reject(new Error("无效 URL")); }
  return assertPublicUrl(url).then(() => {
    // Scrapers must connect to the validated public URL directly.  In
    // particular, do not turn a failed fetch into an implicit proxy/relay
    // request: that would change the SSRF and cookie trust boundary.
    return httpGetDirect(u, timeout, headers, maxBody, redirects);
  });
}

/** 统一入口：快速失败类网络错误最多重试 2 次（间隔 500ms） */
function httpGet(url, timeout = 8000, headers = {}, maxBody = 6 * 1024 * 1024) {
  const attempt = () => requestWithTransport(url, timeout, headers, maxBody, 5);
  return attempt().catch(async e => {
    if (!isRetryable(e)) throw e;
    await sleep(500);
    return attempt().catch(async e2 => {
      if (!isRetryable(e2)) throw e2;
      await sleep(500);
      return attempt();
    });
  });
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}

/* - 平台识别 - */
function parseUrl(url) {
  const u = new URL(url);
  const host = u.hostname;
  if (host.includes("bilibili.com")) {
    const m = url.match(/[Bb][Vv][0-9A-Za-z]+/);
    if (m) return { kind: "bilibili", bvid: m[0] };
  }
  if (host === "github.com" || host === "www.github.com") {
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg.length >= 2) {
      const repo = seg.slice(0, 2).join("/").replace(/\.git$/i, "");
      return { kind: "github", repo };
    }
  }
  if (host === "x.com" || host === "www.x.com" || host === "twitter.com" || host === "www.twitter.com") {
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg.length >= 3 && seg[1].toLowerCase() === "status" && /^\d+$/.test(seg[2])) {
      return { kind: "x", username: seg[0], statusId: seg[2], canonicalUrl: `https://x.com/${seg[0]}/status/${seg[2]}` };
    }
    if (seg.length === 3 && seg[0].toLowerCase() === "i" && seg[1].toLowerCase() === "status" && /^\d+$/.test(seg[2])) {
      return { kind: "x", username: "", statusId: seg[2], canonicalUrl: `https://x.com/i/status/${seg[2]}` };
    }
    return { kind: "x", username: "", statusId: "", canonicalUrl: "" };
  }
  return { kind: "web" };
}

/* - B站：官方 view API - */
async function fetchBilibili(bvid) {
  const r = await httpGet(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  const j = JSON.parse(r.body);
  if (!j || j.code !== 0) throw new Error("B站解析失败：" + (j && j.message || r.status));
  const d = j.data;
  return {
    title: d.title || "",
    author: d.owner ? d.owner.name : "",
    desc: (d.desc || "").replace(/\s+/g, " ").slice(0, 300),
    image: d.pic || "",
    site: "B站视频",
    categoryHint: d.tname || "",
    transport: r.transport || "直连",
  };
}

/* - GitHub：官方 repos API - */
async function fetchGithub(repo) {
  const r = await httpGet(`https://api.github.com/repos/${repo}`, 8000, {
    "Accept": "application/vnd.github+json",
  });
  const j = JSON.parse(r.body);
  if (j && j.message && j.message.includes("API rate")) throw new Error("GitHub API 限流，稍后再试");
  if (!j || !j.full_name) throw new Error("GitHub 仓库不存在或解析失败");
  return {
    title: j.full_name,
    author: j.owner ? j.owner.login : "",
    desc: (j.description || "").slice(0, 300),
    image: j.owner ? `https://avatars.githubusercontent.com/${j.owner.login}?s=200` : "",
    site: "GitHub",
    categoryHint: j.language || "",
    stars: j.stargazers_count || 0,
    transport: r.transport || "直连",
  };
}

/* - 通用网页：og / twitter / JSON-LD / meta 多源融合（cheerio 解析，比正则稳健） - */
const cheerio = require("cheerio");
function fetchOgMeta(html) {
  const $ = cheerio.load(html);
  // meta 取值：兼容 property= / name= 两种写法
  const meta = key => {
    const v = $(`meta[property="${key}"], meta[name="${key}"]`).attr("content");
    return v ? decodeHtml(v) : "";
  };
  // JSON-LD 取 author / 文章标题（schema.org Article）
  let ldAuthor = "", ldTitle = "";
  try {
    $('script[type="application/ld+json"]').each((_, el) => {
      if (ldAuthor) return;
      try {
        const j = JSON.parse($(el).html() || "");
        const a = Array.isArray(j) ? j[0] : j;
        const author = a && a.author;
        if (author) ldAuthor = (typeof author === "string" ? author : (author.name || (Array.isArray(author) ? author[0] && author[0].name : ""))) || "";
        if (a && a.headline && !ldTitle) ldTitle = a.headline;
      } catch (_) { /* 忽略非法 JSON-LD */ }
    });
  } catch (_) {}
  const ogTitle = meta("og:title") || meta("twitter:title") || ldTitle;
  const titleTag = $("title").first().text().trim();
  const title = (ogTitle || titleTag || "").slice(0, 200);
  return {
    title: decodeHtml(title),
    author: meta("author") || meta("weixin:author") || meta("og:article:author") || ldAuthor,
    desc: (meta("og:description") || meta("twitter:description") || meta("description")).replace(/\s+/g, " ").slice(0, 300),
    image: meta("og:image") || meta("twitter:image") || meta("twitter:image:src"),
    site: meta("og:site_name") || "",
  };
}

async function fetchWeb(url) {
  const r = await httpGet(url);
  if (r.status >= 400) throw new Error("页面请求失败（HTTP " + r.status + "）");
  const m = fetchOgMeta(r.body);
  if (!m.title) throw new Error("无法识别该页面内容");
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (!m.site) m.site = host === "mp.weixin.qq.com" ? "微信公众号" : host;
  m.transport = r.transport || "直连";
  return m;
}

/* - 兜底解析：抓取失败（被墙 / 反爬 / 404 等）时从 URL 本身生成元数据 - */
function fallbackMeta(url, error) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  const segs = u.pathname.split("/").filter(Boolean);
  let title = "", author = "", site = "";

  if (host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")) {
    site = "X (Twitter)";
    const user = segs[0] || "";
    title = (segs[1] === "status" && user) ? `X 帖文 @${user}` : (user ? `X 用户 @${user}` : "X (Twitter)");
    author = user ? "@" + user : "";
  } else if (host === "b23.tv" || host.includes("bilibili.com")) {
    site = "B站视频"; title = "B站视频链接";
  } else if (host.includes("github.com")) {
    site = "GitHub"; title = segs.slice(0, 2).join("/") || "GitHub";
    author = segs[0] || "";
  } else if (host.includes("youtube.com") || host === "youtu.be") {
    site = "YouTube"; title = "YouTube 视频";
  } else if (host.includes("zhihu.com")) {
    site = "知乎"; title = segs[0] === "question" ? "知乎问题" : "知乎内容";
  } else if (host.includes("weibo.com") || host.includes("weibo.cn")) {
    site = "微博"; title = "微博动态";
  } else if (host.includes("douyin.com")) {
    site = "抖音"; title = "抖音视频";
  } else if (host.includes("mp.weixin.qq.com")) {
    site = "微信公众号"; title = "微信公众号文章";
  } else {
    site = host || "来源";
    const words = segs
      .filter(s => s.length <= 40 && !/^[a-z0-9_-]{12,}$/i.test(s))
      .slice(0, 2)
      .map(s => { try { return decodeURIComponent(s).replace(/[-_]+/g, " ").trim(); } catch (_) { return s; } })
      .filter(Boolean);
    title = [host].concat(words).join(" · ").slice(0, 200);
  }
  const warn = String(error || "抓取失败");
  return {
    title: title || host,
    author,
    desc: "未能抓取页面内容（" + warn.slice(0, 120) + "），已记录链接。",
    site,
    warning: warn,
  };
}

/* - 统一入口：抓取 + 自动分类；失败走兜底解析，绝不因网络问题报错 - */
async function fetchMeta(url, stage = "解析") {
  const parsed = parseUrl(url);
  let meta, mode;
  try {
    if (parsed.kind === "bilibili") meta = await fetchBilibili(parsed.bvid);
    else if (parsed.kind === "github") meta = await fetchGithub(parsed.repo);
    else meta = await fetchWeb(url);
    if (!meta || !meta.title) throw new Error("未能识别标题");
    mode = meta.transport || "直连";
    delete meta.transport;
  } catch (e) {
    meta = fallbackMeta(url, e.message);
    mode = "兜底";
  }
  const category = classify([meta.title, meta.desc, meta.categoryHint, meta.site, meta.stars ? String(meta.stars) : ""].join(" "));
  const m = Object.assign({ url, category, mode }, meta);
  appendLog({
    stage,
    result: mode === "兜底" ? "⚠️ 兜底" : "✅ 成功",
    title: m.title,
    url,
    mode,
    error: m.warning || "",
  });
  return m;
}

module.exports = { parseUrl, fetchMeta, httpGet, assertPublicUrl };
