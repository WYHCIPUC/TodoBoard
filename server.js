/* ============================================================
 * 灵感来袭 · 待办看板 本地服务
 * Node 本地服务：静态托管 + 链接元数据抓取 + 读写 DATA.md
 *
 * 启动：node server.js   （或双击 start.bat）
 *
 * 业务逻辑已下沉到 lib/：
 *   lib/fetcher.js      抓取 + 兜底解析 + 代理探测 + 解析日志
 *   lib/store.js        DATA.md 读写 / 备份 / 条目纯函数
 *   lib/classifier.js   分类 + 来源识别
 *   lib/constants.js    分类体系常量
 *
 * API：
 *   GET  /api/data                读取 DATA.md 内容
 *   GET  /api/fetch-meta?url=xxx  抓取链接元数据（预览，不写入）
 *   POST /api/add                 新增条目，直接写入 DATA.md
 *   POST /api/merge               合并重复条目的标签与收藏原因
 *   POST /api/delete              按编号删除条目
 *   POST /api/status              更新条目状态（⏳/🔄/✅）
 *   POST /api/note                更新条目研究要点
 *   POST /api/restore             从浏览器备份恢复 DATA.md
 *   POST /api/bookmarks/preview   预检浏览器书签 HTML
 *   POST /api/bookmarks/import    批量导入浏览器书签到收件箱
 *   其他                          静态服务 board.html
 *
 * 可用环境变量：
 *   PORT        端口（默认 3865）
 *   README_FILE 数据文件路径（默认同目录 DATA.md；首次运行自动从 DATA.example.md 初始化）
 *   HTML_FILE   看板页面路径（默认同目录 board.html）
 *   NO_OPEN=1   不自动打开浏览器
 *   FETCH_LOG_FILE 解析记录日志路径（默认 docs/fetch-log.md，由 lib/fetcher 使用）
 *   API_RATE_LIMIT 数据 API 每分钟请求上限（默认 300）
 *   EXPENSIVE_RATE_LIMIT 抓取类 API 每分钟请求上限（默认 30）
 *   AUDIT_LOG_FILE 操作审计日志路径（默认数据目录 .linggan/audit.log，不记录正文和 URL）
 * ============================================================ */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const fetcher = require("./lib/fetcher");
const store = require("./lib/store");
const entries = require("./lib/entries");
const migrate = require("./lib/migrate");
const schema = require("./lib/schema");
const trash = require("./lib/trash");
const auth = require("./lib/auth");
const search = require("./lib/search");
const backup = require("./lib/backup");
const packageInfo = require("./package.json");
const scraper = require("./lib/scraper");
const capture = require("./lib/capture");
const wecom = require("./lib/wecom");
const dingtalk = require("./lib/dingtalk");
const { createRateLimiter } = require("./lib/ratelimit");
const audit = require("./lib/audit");
const bookmarks = require("./lib/bookmarks");
const health = require("./lib/health");
const brainstorm = require("./lib/brainstorm");
const brainstormHistory = require("./lib/brainstorm-history");
const { openBrowser } = require("./scripts/open-browser");

const PORT = Number(process.env.PORT) || 3865;
const HOST = process.env.HOST || "127.0.0.1"; // 默认仅本机访问；非本机数据 API 仍需显式令牌
const JSON_BODY_LIMIT = Number(process.env.JSON_BODY_LIMIT) || 1024 * 1024;
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS) || 60 * 1000;
const apiLimiter = createRateLimiter({ limit: Number(process.env.API_RATE_LIMIT) || 300, windowMs: RATE_WINDOW_MS });
const expensiveLimiter = createRateLimiter({ limit: Number(process.env.EXPENSIVE_RATE_LIMIT) || 30, windowMs: RATE_WINDOW_MS });
const DIR = __dirname;
const README = process.env.README_FILE
  ? path.resolve(process.env.README_FILE)
  : path.join(DIR, "DATA.md");
const HTML_FILE = process.env.HTML_FILE
  ? path.resolve(process.env.HTML_FILE)
  : path.join(DIR, "board.html");

/* 首次运行：数据文件不存在时从 DATA.example.md 初始化 */
function ensureDataFile() {
  if (fs.existsSync(README)) return;
  const example = path.join(DIR, "DATA.example.md");
  if (!fs.existsSync(example)) return;
  try {
    fs.mkdirSync(path.dirname(README), { recursive: true });
    fs.copyFileSync(example, README);
    console.log("  数据文件不存在，已从 DATA.example.md 初始化");
  } catch (e) { recordError("initData", e); }
}

/* 服务错误日志跟随用户数据目录，升级程序时不会丢失。 */
const ERROR_LOG = process.env.SERVER_ERROR_LOG_FILE
  ? path.resolve(process.env.SERVER_ERROR_LOG_FILE)
  : path.join(path.dirname(README), ".linggan", "server-error.log");
function recordError(tag, e) {
  const line = new Date().toISOString() + " [" + tag + "] " + (e && e.stack || e) + "\n";
  try {
    fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
    fs.appendFileSync(ERROR_LOG, line, "utf-8");
  } catch (_) {}
  console.error("[" + tag + "]", e && e.stack || e);
}
/* ============================================================
 * HTTP 服务
 * ============================================================ */
function sendJson(res, code, obj, extraHeaders) {
  res.writeHead(code, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  }, extraHeaders || {}));
  res.end(JSON.stringify(obj));
}

function sendText(res, code, text) {
  res.writeHead(code, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  res.end(text);
}

function requestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readBody(req, limit) {
  limit = limit || 1024 * 1024;
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > limit) {
      req.resume();
      reject(requestError("请求内容超过限制", 413));
      return;
    }
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on("data", chunk => {
      total += chunk.length;
      if (total > limit) { tooLarge = true; return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) reject(requestError("请求内容超过限制", 413));
      else resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", reject);
  });
}

async function readJson(req, limit) {
  const body = await readBody(req, limit || JSON_BODY_LIMIT);
  try { return JSON.parse(body || "{}"); }
  catch (_) { throw requestError("请求 JSON 格式错误", 400); }
}

function handleJson(req, res, handler, limit) {
  readJson(req, limit)
    .then(handler)
    .catch(error => {
      if (!res.writableEnded) {
        sendJson(res, error.statusCode || 500, { ok: false, error: error.message || String(error) });
      }
    });
}

/* ===== multipart/form-data 解析(零依赖,支持单文件 + 文本字段) ===== */
function parseMultipart(req, cb) {
  const ct = req.headers["content-type"] || "";
  const bndM = ct.match(/boundary=([^;]+)/);
  if (!bndM) { cb(new Error("非 multipart 请求")); return; }
  const boundary = Buffer.from("--" + bndM[1].trim().replace(/^["']|["']$/g, ""));
  const chunks = [];
  let totalLen = 0;
  let tooLarge = false;
  let finished = false;
  const LIMIT = 6 * 1024 * 1024; // 文件上限 5MB，额外预留 multipart 头部
  const done = (error, value) => {
    if (finished) return;
    finished = true;
    cb(error, value);
  };
  req.on("data", c => {
    totalLen += c.length;
    if (totalLen > LIMIT) { tooLarge = true; return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (tooLarge) { done(new Error("上传超过 5MB 限制")); return; }
    try {
      const buf = Buffer.concat(chunks);
      let fileBuffer = null, caption = "";
      let pos = 0;
      while (pos < buf.length) {
        const next = buf.indexOf(boundary, pos);
        if (next < 0) break;
        // 跳过 boundary + \r\n
        let partStart = next + boundary.length;
        if (buf.slice(partStart, partStart + 2).toString() === "\r\n") partStart += 2;
        else break; // -- 结束标记
        const partEnd = buf.indexOf(boundary, partStart);
        if (partEnd < 0) break;
        // 找 part 内的 header/body 分界 \r\n\r\n
        const headerEnd = buf.indexOf("\r\n\r\n", partStart);
        if (headerEnd < 0 || headerEnd >= partEnd) { pos = partEnd; continue; }
        const header = buf.slice(partStart, headerEnd).toString("utf-8");
        let bodyBuf = buf.slice(headerEnd + 4, partEnd - 2); // 去尾 \r\n
        if (/name="file"/.test(header)) {
          // 去 filename 后的内容(已是二进制,直接取)
          fileBuffer = bodyBuf;
        } else {
          const nameM = header.match(/name="([^"]+)"/);
          if (nameM && nameM[1] === "caption") caption = bodyBuf.toString("utf-8");
        }
        pos = partEnd;
      }
      if (!fileBuffer) { done(new Error("未找到文件")); return; }
      done(null, { fileBuffer, caption });
    } catch (e) { done(e); }
  });
  req.on("error", e => done(e));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:" + PORT);
  const p = u.pathname;
  const clientKey = req.socket && req.socket.remoteAddress || "unknown";
  const authKind = auth.authorizationKind(req);

  if (p.startsWith("/api/")) {
    const rate = apiLimiter.check(clientKey);
    if (!rate.allowed) {
      sendJson(res, 429, { ok: false, error: "请求过于频繁，请稍后重试", retryAfter: rate.retryAfter }, { "Retry-After": String(rate.retryAfter) });
      return;
    }
    if (["/api/fetch-meta", "/api/add", "/api/entry/scrape", "/api/wecom/callback"].includes(p)) {
      const expensiveRate = expensiveLimiter.check(clientKey);
      if (!expensiveRate.allowed) {
        sendJson(res, 429, { ok: false, error: "抓取请求过于频繁，请稍后重试", retryAfter: expensiveRate.retryAfter }, { "Retry-After": String(expensiveRate.retryAfter) });
        return;
      }
    }
  }

  if (p.startsWith("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    res.once("finish", () => audit.record({
      method: req.method,
      route: p,
      status: res.statusCode,
      auth: authKind,
      local: auth.isLocalHost(req),
    }));
  }

  /* 所有数据 API 默认需要本地会话；企业微信回调依赖自身签名校验。 */
  if (p.startsWith("/api/") && p !== "/api/wecom/callback" && authKind === "none") {
    sendJson(res, 401, { ok: false, error: "未授权访问，请从本机看板页面重新进入" });
    return;
  }

  /* 写接口 CSRF 防护：会话 Cookie 必须与当前 Host/端口精确同源；显式 API 令牌与平台签名入口不依赖浏览器 Origin。 */
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !p.startsWith("/api/wecom/") && authKind === "session" && !auth.isTrustedOrigin(req)) {
    sendJson(res, 403, { ok: false, error: "拒绝跨站请求（来源必须与看板端口完全一致）" });
    return;
  }

  /* 读取数据 */
  if (p === "/api/data") {
    try {
      const content = store.readAll();
      sendJson(res, 200, { ok: true, name: path.basename(README), content });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e) });
    }
    return;
  }

  /* 抓取链接元数据（预览） */
  if (p === "/api/fetch-meta") {
    const url = (u.searchParams.get("url") || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) { sendJson(res, 400, { ok: false, error: "请填写有效的 http(s) 链接" }); return; }
    fetcher.assertPublicUrl(url)
      .then(() => fetcher.fetchMeta(url, "预览"))
      .then(meta => sendJson(res, 200, { ok: true, meta }))
      .catch(e => sendJson(res, 422, { ok: false, error: e.message }));
    return;
  }

  /* 新增条目：抓取（或直接传字段）+ 写入 DATA.md */
  if (p === "/api/add" && req.method === "POST") {
    handleJson(req, res, async data => {
      const result = await capture.addUrl(data.url, data);
      sendJson(res, 200, result);
    });
    return;
  }

  if (p === "/api/archive/status" && req.method === "GET") {
    const id = (u.searchParams.get("id") || "").trim();
    if (!id) { sendJson(res, 400, { ok: false, error: "缺少归档任务 id" }); return; }
    const status = capture.getArchiveStatus(id);
    if (!status) { sendJson(res, 404, { ok: false, error: "未知归档任务: " + id }); return; }
    sendJson(res, 200, { ok: true, archive: status, status });
    return;
  }

  if (p === "/api/archive/retry" && req.method === "POST") {
    handleJson(req, res, data => {
      const id = String(data.id || "").trim();
      if (!id) throw requestError("缺少归档任务 id", 400);
      const current = capture.getArchiveStatus(id);
      if (!current) { sendJson(res, 404, { ok: false, error: "未知归档任务: " + id }); return; }
      if (current.state === "queued" || current.state === "running") {
        sendJson(res, 409, { ok: false, error: "归档任务已在处理中", archive: current });
        return;
      }
      try {
        const archive = capture.retryArchive(id);
        sendJson(res, 202, { ok: true, archive });
      } catch (error) {
        sendJson(res, error.message.includes("正在执行") ? 409 : 400, { ok: false, error: "归档重试失败" });
      }
    });
    return;
  }

  if (p === "/api/merge" && req.method === "POST") {
    handleJson(req, res, async data => {
      const id = String(data.id || "").trim();
      const tags = String(data.tags || "").trim();
      const whySaved = String(data.whySaved || "").trim();
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      if (!tags && !whySaved) { sendJson(res, 400, { ok: false, error: "没有可合并的字段" }); return; }
      const result = await store.mutate(text => {
        const updated = store.mergeEntryFields(text, id, { tags, whySaved });
        if (updated === null) return { write: false, result: { found: false, changed: false } };
        return { text: updated, write: updated !== text, result: { found: true, changed: updated !== text } };
      });
      if (!result.found) { sendJson(res, 404, { ok: false, error: "未找到条目 " + id }); return; }
      sendJson(res, 200, { ok: true, id, merged: result.changed });
    });
    return;
  }

  if (p === "/api/search" && req.method === "GET") {
    try {
      const query = (u.searchParams.get("q") || "").trim();
      const results = query ? search.searchData(store.readAll(), query) : [];
      sendJson(res, 200, { ok: true, query, results });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  /* 需求驱动头脑风暴：从待研究事项中抽取长处并生成可解释的融合方案 */
  if (p === "/api/brainstorm" && req.method === "GET") {
    try {
      const mode = (u.searchParams.get("mode") || "fusion").trim();
      const goal = (u.searchParams.get("goal") || "").trim().slice(0, 400);
      const result = brainstorm.analyze(store.readAll(), { entriesDir: entries.ENTRIES_DIR, mode, goal });
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (p === "/api/brainstorm/history" && req.method === "GET") {
    try { sendJson(res, 200, { ok: true, items: brainstormHistory.listReports(12) }); }
    catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (p === "/api/brainstorm/report" && req.method === "GET") {
    try {
      const id = (u.searchParams.get("id") || "").trim();
      const content = brainstormHistory.readReport(id);
      res.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="brainstorm-${id}.md"`,
        "Content-Length": Buffer.byteLength(content),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(content);
    } catch (e) { sendJson(res, e.statusCode || 400, { ok: false, error: e.message }); }
    return;
  }

  if (p === "/api/brainstorm/save" && req.method === "POST") {
    handleJson(req, res, data => {
      const goal = String(data.goal || "").trim().slice(0, 400);
      const allowedModes = new Set(["fusion", "panorama", "opportunities", "challenges", "roadmap"]);
      const mode = allowedModes.has(data.mode) ? data.mode : "fusion";
      if (!goal) throw requestError("请先输入一个实际需求", 400);
      const analysis = brainstorm.analyze(store.readAll(), { entriesDir: entries.ENTRIES_DIR, mode, goal });
      const saved = brainstormHistory.saveReport(analysis);
      sendJson(res, 201, { ok: true, saved });
    });
    return;
  }

  if (p === "/api/backup" && req.method === "GET") {
    try {
      const payload = JSON.stringify(backup.exportBundle());
      const filename = "linggan-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": Buffer.byteLength(payload),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(payload);
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (p === "/api/backup/import" && req.method === "POST") {
    readBody(req, 80 * 1024 * 1024).then(async body => {
      let bundle;
      try { bundle = JSON.parse(body || "{}"); }
      catch (_) { throw requestError("备份包 JSON 格式错误", 400); }
      const result = await backup.importBundle(bundle);
      sendJson(res, 200, result);
    }).catch(error => {
      if (!res.writableEnded) sendJson(res, error.statusCode || 400, { ok: false, error: error.message });
    });
    return;
  }

  if (p === "/api/bookmarks/preview" && req.method === "POST") {
    handleJson(req, res, data => {
      const content = String(data.content || "");
      if (!content) throw requestError("书签 HTML 为空", 400);
      sendJson(res, 200, { ok: true, preview: bookmarks.preview(content) });
    }, 7 * 1024 * 1024);
    return;
  }

  if (p === "/api/bookmarks/import" && req.method === "POST") {
    handleJson(req, res, async data => {
      const content = String(data.content || "");
      if (!content) throw requestError("书签 HTML 为空", 400);
      sendJson(res, 200, await bookmarks.importHtml(content));
    }, 7 * 1024 * 1024);
    return;
  }

  if (p === "/api/diagnostics" && req.method === "GET") {
    try {
      const dataText = store.readAll();
      const dataName = path.parse(README);
      const escapedName = dataName.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedExt = (dataName.ext || ".md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const backupPattern = new RegExp("^" + escapedName + "\\.backup-\\d{17}(?:-\\d+)?" + escapedExt + "$");
      const backupFiles = fs.readdirSync(path.dirname(README))
        .filter(name => backupPattern.test(name))
        .map(name => ({ name, mtimeMs: fs.statSync(path.join(path.dirname(README), name)).mtimeMs }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      let writable = true;
      try { fs.accessSync(README, fs.constants.R_OK | fs.constants.W_OK); }
      catch (_) { writable = false; }
      sendJson(res, 200, {
        ok: true,
        appVersion: packageInfo.version,
        dataVersion: schema.getDataVersion(dataText),
        entries: schema.scanEntries(dataText).length,
        backups: backupFiles.length,
        latestBackupAt: backupFiles.length ? new Date(backupFiles[0].mtimeMs).toISOString() : null,
        writable,
        health: health.inspectData(dataText),
        trash: trash.listEntries().length,
        node: process.version,
        platform: process.platform,
        integrations: { wecom: wecom.isEnabled(), dingtalk: dingtalk.isEnabled() },
        brainstormReports: brainstormHistory.listReports(50).length,
      });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  /* 删除条目（按编号，如 2.1） */
  if (p === "/api/delete" && req.method === "POST") {
    handleJson(req, res, async data => {
      const id = String(data.id || "").trim();
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      const archived = await trash.archiveEntry(id);
      if (!archived) { sendJson(res, 404, { ok: false, error: "未找到条目 " + id }); return; }
      sendJson(res, 200, { ok: true, id, archived: true, record: archived.record });
    });
    return;
  }

  /* 更新条目状态（⏳/🔄/✅） */
  if (p === "/api/status" && req.method === "POST") {
    handleJson(req, res, async data => {
      const id = String(data.id || "").trim();
      const st = String(data.status || "").trim();
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      if (!["⏳", "🔄", "✅"].includes(st)) { sendJson(res, 400, { ok: false, error: "无效状态" }); return; }
      const found = await store.mutate(text => {
        const updated = store.updateStatus(text, id, st);
        return updated === null
          ? { write: false, result: false }
          : { text: updated, result: true };
      });
      if (!found) { sendJson(res, 404, { ok: false, error: "未找到条目 " + id }); return; }
      sendJson(res, 200, { ok: true, id, status: st });
    });
    return;
  }

  /* 更新条目研究要点（笔记写回） */
  if (p === "/api/note" && req.method === "POST") {
    handleJson(req, res, async data => {
      const id = String(data.id || "").trim();
      const note = String(data.note || "").trim().replace(/\r?\n/g, " ");
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      const found = await store.mutate(text => {
        const updated = store.updateNote(text, id, note);
        return updated === null
          ? { write: false, result: false }
          : { text: updated, result: true };
      });
      if (!found) { sendJson(res, 404, { ok: false, error: "未找到条目 " + id }); return; }
      sendJson(res, 200, { ok: true, id });
    });
    return;
  }

  /* - 从浏览器备份恢复 DATA.md */
  if (p === "/api/restore" && req.method === "POST") {
    handleJson(req, res, async data => {
      const content = String(data.content || "");
      if (!content) { sendJson(res, 400, { ok: false, error: "备份内容为空" }); return; }
      const currentEntries = new Map(schema.scanEntries(store.readAll()).map(entry => [entry.id, entry.uid]));
      const migrated = schema.migrateText(content, info => currentEntries.get(info && info.id) || schema.newUid());
      await store.mutate(() => ({ text: migrated.text, result: true }));
      sendJson(res, 200, { ok: true, migrated: migrated.fromVersion < migrated.toVersion });
    });
    return;
  }

  /* ===== 研究档案路由 ===== */

  /* 读取研究档案(首访自动建空模板) */
  if (p === "/api/entry" && req.method === "GET") {
    const id = (u.searchParams.get("id") || "").trim();
    try {
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      const entry = entries.getEntry(id, { archive: capture.archive });
      sendJson(res, 200, { ok: true, entry });
    } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
    return;
  }

  /* 保存档案字段 */
  if (p === "/api/entry/notes" && req.method === "POST") {
    handleJson(req, res, data => {
      if (!/^\d+\.\d+$/.test(data.id || "")) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      entries.saveNotes(data.id, data);
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  /* 上传截图(multipart/form-data) */
  if (p === "/api/entry/screenshot" && req.method === "POST") {
    const id = (u.searchParams.get("id") || "").trim();
    if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
    parseMultipart(req, (err, { fileBuffer, caption } = {}) => {
      if (err) { sendJson(res, 400, { ok: false, error: err.message }); return; }
      try {
        const r = entries.uploadScreenshot(id, fileBuffer, caption);
        sendJson(res, 200, { ok: true, file: r.file });
      } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
    });
    return;
  }

  /* 删除截图 */
  if (p === "/api/entry/screenshot/delete" && req.method === "POST") {
    handleJson(req, res, data => {
      if (!/^\d+\.\d+$/.test(data.id || "")) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      entries.deleteScreenshot(data.id, data.file);
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  /* 读取截图文件(供前端显示) */
  if (p === "/api/entry/screenshot/file") {
    const id = (u.searchParams.get("id") || "").trim();
    const file = (u.searchParams.get("file") || "").trim();
    try {
      if (!/^\d+\.\d+$/.test(id) || !/^\d{8}-\d{6}\.(png|jpe?g)$/i.test(file)) {
        sendText(res, 400, "无效参数"); return;
      }
      const fp = entries.safePath(id, "screenshots", file);
      if (!fs.existsSync(fp)) { sendText(res, 404, "Not Found"); return; }
      const data = fs.readFileSync(fp);
      const ext = path.extname(file).toLowerCase();
      const type = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(data);
    } catch (e) { sendText(res, 400, e.message); }
    return;
  }

  /* 抓取条目正文 → content.md */
  if (p === "/api/entry/scrape" && req.method === "POST") {
    handleJson(req, res, async data => {
      const id = String(data.id || "").trim();
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      const url = entries.entryUrl(id);
      if (!url) { sendJson(res, 422, { ok: false, error: "该条目无来源链接,无法抓取" }); return; }
      const result = await scraper.scrapeContent(url);
      entries.saveContent(id, result);
      sendJson(res, 200, { ok: result.ok, warning: result.warning, title: result.title, source: result.source });
    });
    return;
  }

  /* 读取已抓正文 */
  if (p === "/api/entry/content" && req.method === "GET") {
    const id = (u.searchParams.get("id") || "").trim();
    try {
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      const content = entries.getContent(id);
      sendJson(res, 200, { ok: true, content, hasContent: !!content });
    } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
    return;
  }

  if (p === "/api/entry/content" && req.method === "POST") {
    handleJson(req, res, async data => {
      const id = String(data.id || "").trim();
      const content = String(data.content || data.markdown || "");
      if (!/^\d+\.\d+$/.test(id)) throw requestError("无效编号", 400);
      if (!content.trim()) throw requestError("手动归档内容不能为空", 400);
      if (Buffer.byteLength(content, "utf8") > 20 * 1024 * 1024) {
        throw requestError("手动归档内容超过 20MB 限制", 413);
      }
      try {
        const archive = await capture.archiveContent(id, content);
        sendJson(res, 200, { ok: true, id, archive });
      } catch (error) {
        sendJson(res, error.statusCode || 400, { ok: false, error: "手动归档失败" });
      }
    }, 21 * 1024 * 1024);
    return;
  }

  /* ===== 企业微信消息回调：转发链接即入库 ===== */
  if (p === "/api/wecom/callback") {
    // 未配置企业微信时给出提示（不影响看板主功能）
    if (!wecom.isEnabled()) {
      sendJson(res, 503, { ok: false, error: "未配置企业微信（需设置 WECOM_CORP_ID/SECRET/TOKEN/ENCODING_AES 等环境变量）" });
      return;
    }
    const q = u.searchParams;
    // GET：企业微信 URL 验证（echostr 回显）
    if (req.method === "GET") {
      const sig = q.get("msg_signature") || "";
      const ts = q.get("timestamp") || "";
      const nonce = q.get("nonce") || "";
      const echostr = q.get("echostr") || "";
      if (wecom.verifySignature(sig, ts, nonce, echostr)) {
        const plain = wecom.decrypt(echostr);
        sendText(res, 200, plain);
      } else {
        sendText(res, 403, "签名校验失败");
      }
      return;
    }
    // POST：接收消息（用户转发的内容）
    if (req.method === "POST") {
      readBody(req, 256 * 1024).then(body => {
        return (async () => {
          const sig = q.get("msg_signature") || "";
          const ts = q.get("timestamp") || "";
          const nonce = q.get("nonce") || "";
          const encrypt = wecom.xmlField(body, "Encrypt");
          // 签名校验 + 解密
          if (!encrypt || !wecom.verifySignature(sig, ts, nonce, encrypt)) {
            sendJson(res, 403, { ok: false, error: "消息签名校验失败" });
            return;
          }
          const xml = wecom.decrypt(encrypt);
          const fromUser = wecom.xmlField(xml, "FromUserName");
          const url = wecom.extractUrl(xml);
          // 无链接：提示用法
          if (!url) {
            try { await wecom.sendText(fromUser, "请直接转发或粘贴一个 http(s) 链接给我，我会自动抓取并记录到看板。"); } catch (_) {}
            sendJson(res, 200, { ok: true, skipped: true });
            return;
          }
          try {
            const result = await capture.addUrl(url, { stage: "企业微信" });
            const callbackReply = result.duplicate
              ? `已保存\n${result.id} ${result.title}`
              : `已保存\n${result.id} ${result.title}` + (result.archive && result.archive.state === "queued" ? "\n正在归档" : "");
            try { await wecom.sendText(fromUser, callbackReply); } catch (_) {}
            sendJson(res, 200, result);
          } catch (e) {
            try { await wecom.sendText(fromUser, "❌ 记录失败，请稍后重试"); } catch (_) {}
            sendJson(res, 500, { ok: false, error: "记录失败，请稍后重试" });
          }
        })();
      }).catch(error => {
        if (!res.writableEnded) sendJson(res, error.statusCode || 500, { ok: false, error: error.message });
      });
      return;
    }
  }

  /* 回收站：删除默认归档，可按记录恢复 */
  if (p === "/api/trash" && req.method === "GET") {
    try { sendJson(res, 200, { ok: true, entries: trash.listEntries() }); }
    catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (p === "/api/trash/restore" && req.method === "POST") {
    handleJson(req, res, async data => {
      const restored = await trash.restoreEntry(String(data.record || ""));
      sendJson(res, 200, { ok: true, restored });
    });
    return;
  }

  /* 静态：board.html / board.css / board.js */
  const STATIC = {
    "/": { file: "board.html", type: "text/html; charset=utf-8" },
    "/board.html": { file: "board.html", type: "text/html; charset=utf-8" },
    "/board.css": { file: "board.css", type: "text/css; charset=utf-8" },
    "/board.js": { file: "board.js", type: "application/javascript; charset=utf-8" },
  };
  if (STATIC[p]) {
    try {
      const fp = path.join(DIR, STATIC[p].file);
      const data = fs.readFileSync(fp, "utf-8");
      const headers = {
        "Content-Type": STATIC[p].type,
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
      };
      if ((p === "/" || p === "/board.html") && auth.isLocalHost(req)) {
        headers["Set-Cookie"] = auth.sessionCookie();
      }
      res.writeHead(200, headers);
      res.end(data);
    } catch (e) {
      sendText(res, 404, STATIC[p].file + " 不存在");
    }
    return;
  }

  sendText(res, 404, "Not Found");
});

server.on("error", e => {
  if (e && e.code === "EADDRINUSE") {
    console.error("\n  [错误] 端口 " + PORT + " 已被占用（可能服务已在运行？）\n  可先关闭旧服务，或用 PORT=xxxx node server.js 换端口启动。");
    process.exit(1);
  }
  recordError("listenError", e);
  process.exit(1);
});

/* 未捕获异常后不再继续提供可能不一致的服务；先停止接入并等待现有请求结束。 */
let shuttingDown = false;
function shutdown(reason, exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reason) console.log("\n  正在停止服务：" + reason);
  try { dingtalk.stop(); } catch (error) { recordError("integrationStop", error); }
  try { capture.stop(); } catch (error) { recordError("archiveStop", error); }
  const forceExit = setTimeout(() => process.exit(exitCode), 3000);
  forceExit.unref();
  if (!server.listening) {
    clearTimeout(forceExit);
    process.exit(exitCode);
    return;
  }
  server.close(error => {
    clearTimeout(forceExit);
    if (error) recordError("serverClose", error);
    process.exit(exitCode);
  });
}
process.on("SIGINT", () => shutdown("收到 Ctrl+C", 0));
process.on("SIGTERM", () => shutdown("收到退出信号", 0));
process.on("uncaughtException", error => {
  recordError("uncaughtException", error);
  shutdown("发生未捕获异常", 1);
});
process.on("unhandledRejection", reason => {
  recordError("unhandledRejection", reason);
  shutdown("发生未处理的异步异常", 1);
});

/* 统一入库辅助：抓取元数据 + 写入 DATA.md（供企业微信/钉钉等外部入口复用） */
async function addUrlToBoard(url) {
  return capture.addUrl(url, { stage: "外部入口" });
}

ensureDataFile();
let migrationSummary;
try {
  migrationSummary = migrate.migrateData({ dataFile: README, entriesDir: entries.ENTRIES_DIR });
} catch (e) {
  recordError("dataMigration", e);
  console.error("\n  [错误] 数据升级失败，服务未启动。" + e.message);
  process.exit(1);
}
try { capture.start(); } catch (e) { recordError("archiveStart", e); }

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  灵感来袭 · 待办看板");
  console.log("  http://localhost:" + PORT);
  console.log("  数据文件: " + README);
  if (migrationSummary && migrationSummary.changed) {
    console.log("  数据格式: 已升级到 v" + migrationSummary.toVersion);
    console.log("  迁移备份: " + migrationSummary.backupDir);
  }

  console.log("  企业微信转发入库: " + (wecom.isEnabled() ? "已启用 (/api/wecom/callback)" : "未配置（设置 WECOM_* 环境变量启用）"));
  console.log("  钉钉转发入库: " + (dingtalk.isEnabled() ? "启动中..." : "未配置（设置 DINGTALK_* 环境变量启用）"));
  console.log("  按 Ctrl+C 停止服务");
  console.log("");
  // 钉钉 Stream 模式：自动连接接收消息（无需公网/域名）
  if (dingtalk.isEnabled()) {
    dingtalk.start(addUrlToBoard).then(ok => {
      if (ok) console.log("  钉钉 Stream 已就绪，给机器人发链接即可入库");
      else console.log("  [警告] 钉钉 Stream 连接失败，请检查 DINGTALK_CLIENT_ID/SECRET");
    }).catch(e => console.log("  [警告] 钉钉启动异常:", e.message));
  }
  try {
    if (process.platform === "win32" && !process.env.NO_OPEN) {
      openBrowser("http://127.0.0.1:" + PORT + "/");
    }
  } catch (_) { /* 打开浏览器失败不阻塞 */ }
});
