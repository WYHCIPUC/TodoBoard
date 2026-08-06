/* ============================================================
 * 灵感来袭 · 待办看板 本地服务
 * 零依赖 Node 服务：静态托管 + 链接元数据抓取 + 读写 README.md
 *
 * 启动：node server.js   （或双击 start.bat）
 *
 * 业务逻辑已下沉到 lib/：
 *   lib/fetcher.js      抓取 + 兜底解析 + 代理探测 + 解析日志
 *   lib/store.js        README 读写 / 备份 / 条目纯函数
 *   lib/classifier.js   分类 + 来源识别
 *   lib/constants.js    分类体系常量
 *
 * API：
 *   GET  /api/data                读取 README.md 内容
 *   GET  /api/fetch-meta?url=xxx  抓取链接元数据（预览，不写入）
 *   POST /api/add                 新增条目，直接写入 README.md
 *   POST /api/delete              按编号删除条目
 *   POST /api/status              更新条目状态（⏳/🔄/✅）
 *   POST /api/note                更新条目研究要点
 *   POST /api/restore             从浏览器备份恢复 README
 *   其他                          静态服务 board.html
 *
 * 可用环境变量：
 *   PORT        端口（默认 3865）
 *   README_FILE 数据文件路径（默认同目录 DATA.md；首次运行自动从 DATA.example.md 初始化）
 *   HTML_FILE   看板页面路径（默认同目录 board.html）
 *   NO_OPEN=1   不自动打开浏览器
 *   FETCH_LOG_FILE 解析记录日志路径（默认 docs/fetch-log.md，由 lib/fetcher 使用）
 * ============================================================ */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const fetcher = require("./lib/fetcher");
const store = require("./lib/store");
const entries = require("./lib/entries");
const scraper = require("./lib/scraper");
const wecom = require("./lib/wecom");
const { guessSource } = require("./lib/classifier");

const PORT = Number(process.env.PORT) || 3865;
const HOST = process.env.HOST || "127.0.0.1"; // 默认仅本机访问；HOST=0.0.0.0 可开放局域网（无认证，仅可信网络）
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
    fs.copyFileSync(example, README);
    console.log("  数据文件不存在，已从 DATA.example.md 初始化");
  } catch (e) { recordError("initData", e); }
}

/* 本地服务兜底：任何未捕获异常 / 未处理 Promise 拒绝只记录，不让整个服务退出 */
const ERROR_LOG = path.join(DIR, "docs", "server-error.log");
function recordError(tag, e) {
  const line = new Date().toISOString() + " [" + tag + "] " + (e && e.stack || e) + "\n";
  try {
    fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
    fs.appendFileSync(ERROR_LOG, line, "utf-8");
  } catch (_) {}
  console.error("[" + tag + "]", e && e.stack || e);
}
process.on("uncaughtException", e => recordError("uncaughtException", e));
process.on("unhandledRejection", reason => recordError("unhandledRejection", reason));

/* ============================================================
 * HTTP 服务
 * ============================================================ */
function sendJson(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

function sendText(res, code, text) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

/* ===== multipart/form-data 解析(零依赖,支持单文件 + 文本字段) ===== */
function parseMultipart(req, cb) {
  const ct = req.headers["content-type"] || "";
  const bndM = ct.match(/boundary=([^;]+)/);
  if (!bndM) { cb(new Error("非 multipart 请求")); return; }
  const boundary = Buffer.from("--" + bndM[1].trim().replace(/^["']|["']$/g, ""));
  const chunks = [];
  let totalLen = 0;
  const LIMIT = 5 * 1024 * 1024; // 与 lib/entries.js 的 5MB 上限一致
  req.on("data", c => {
    chunks.push(c);
    totalLen += c.length;
    if (totalLen > LIMIT) { req.destroy(); cb(new Error("上传超过 5MB 限制")); }
  });
  req.on("end", () => {
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
      if (!fileBuffer) { cb(new Error("未找到文件")); return; }
      cb(null, { fileBuffer, caption });
    } catch (e) { cb(e); }
  });
  req.on("error", e => cb(e));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:" + PORT);
  const p = u.pathname;

  /* 写接口 CSRF 防护：浏览器跨站请求必带 Origin，非本地来源一律拒绝（curl / 企业微信服务器等无 Origin 客户端放行） */
  if (req.method === "POST" && !p.startsWith("/api/wecom/")) {
    const origin = req.headers.origin;
    if (origin) {
      let oh;
      try { oh = new URL(origin).hostname; } catch (_) { oh = ""; }
      if (oh !== "localhost" && oh !== "127.0.0.1" && oh !== "[::1]") {
        sendJson(res, 403, { ok: false, error: "拒绝跨站请求（来源校验失败）" });
        return;
      }
    }
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

  /* 新增条目：抓取（或直接传字段）+ 写入 README.md */
  if (p === "/api/add" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      (async () => {
        try {
          const data = JSON.parse(body || "{}");
          const url = String(data.url || "").trim();
          const difficulty = Math.min(3, Math.max(1, parseInt(data.difficulty, 10) || 1));
          if (!/^https?:\/\//i.test(url)) { sendJson(res, 400, { ok: false, error: "请填写有效的 http(s) 链接" }); return; }
          try { await fetcher.assertPublicUrl(url); }
          catch (e) { sendJson(res, 422, { ok: false, error: e.message }); return; }

          // 抓取元数据；失败时回退到前端传入的字段
          let meta = {};
          try { meta = await fetcher.fetchMeta(url, "入库"); }
          catch (e) { meta = { url, error: e.message }; }

          const name = (data.name || meta.title || "").trim();
          const cat = (data.category || data.cat || meta.category || "其他").trim();
          const author = (data.author || meta.author || "").trim();
          const desc = (data.desc || meta.desc || "").trim();
          const image = (data.image || meta.image || "").trim();
          const site = (meta.site || guessSource(url));

          if (!name) {
            sendJson(res, 422, { ok: false, error: "未能自动识别标题" + (meta.error ? "（" + meta.error + "）" : "") + "，请手动填写标题" });
            return;
          }

          const text = store.readAll();
          const id = store.nextIdIn(text, cat);
          const snippet = store.buildSnippet({ id, name, url, author, desc, difficulty, image, site });
          const updated = store.insertSnippet(text, cat, snippet);
          store.writeWithBackup(updated);
          sendJson(res, 200, { ok: true, id, category: cat, fetched: !meta.error, snippet });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: String(e) });
        }
      })();
    });
    return;
  }

  /* 删除条目（按编号，如 2.1） */
  if (p === "/api/delete" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        const id = String(data.id || "").trim();
        if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
        const text = store.readAll();
        const updated = store.deleteEntry(text, id);
        if (updated === null) { sendJson(res, 404, { ok: false, error: "未找到条目 " + id }); return; }
        store.writeWithBackup(updated);
        sendJson(res, 200, { ok: true, id });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e) });
      }
    });
    return;
  }

  /* 更新条目状态（⏳/🔄/✅） */
  if (p === "/api/status" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        const id = String(data.id || "").trim();
        const st = String(data.status || "").trim();
        if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
        if (!["⏳", "🔄", "✅"].includes(st)) { sendJson(res, 400, { ok: false, error: "无效状态" }); return; }
        const text = store.readAll();
        const updated = store.updateStatus(text, id, st);
        if (updated === null) { sendJson(res, 404, { ok: false, error: "未找到条目 " + id }); return; }
        store.writeWithBackup(updated);
        sendJson(res, 200, { ok: true, id, status: st });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e) });
      }
    });
    return;
  }

  /* 更新条目研究要点（笔记写回） */
  if (p === "/api/note" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        const id = String(data.id || "").trim();
        const note = String(data.note || "").trim().replace(/\r?\n/g, " ");
        if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
        const text = store.readAll();
        const updated = store.updateNote(text, id, note);
        if (updated === null) { sendJson(res, 404, { ok: false, error: "未找到条目 " + id }); return; }
        store.writeWithBackup(updated);
        sendJson(res, 200, { ok: true, id });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e) });
      }
    });
    return;
  }

  /* - 从浏览器备份恢复 README */
  if (p === "/api/restore" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        const content = String(data.content || "");
        if (!content) { sendJson(res, 400, { ok: false, error: "备份内容为空" }); return; }
        store.writeAtomic(content);
        sendJson(res, 200, { ok: true });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e) });
      }
    });
    return;
  }

  /* ===== 研究档案路由 ===== */

  /* 读取研究档案(首访自动建空模板) */
  if (p === "/api/entry") {
    const id = (u.searchParams.get("id") || "").trim();
    try {
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      const entry = entries.getEntry(id);
      sendJson(res, 200, { ok: true, entry });
    } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
    return;
  }

  /* 保存档案字段 */
  if (p === "/api/entry/notes" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        if (!/^\d+\.\d+$/.test(data.id || "")) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
        entries.saveNotes(data.id, data);
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
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
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        if (!/^\d+\.\d+$/.test(data.id || "")) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
        entries.deleteScreenshot(data.id, data.file);
        sendJson(res, 200, { ok: true });
      } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
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
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      (async () => {
        try {
          const data = JSON.parse(body || "{}");
          const id = String(data.id || "").trim();
          if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
          const url = entries.entryUrl(id);
          if (!url) { sendJson(res, 422, { ok: false, error: "该条目无来源链接,无法抓取" }); return; }
          const result = await scraper.scrapeContent(url);
          entries.saveContent(id, result);
          sendJson(res, 200, { ok: result.ok, warning: result.warning, title: result.title, source: result.source });
        } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      })();
    });
    return;
  }

  /* 读取已抓正文 */
  if (p === "/api/entry/content") {
    const id = (u.searchParams.get("id") || "").trim();
    try {
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      const content = entries.getContent(id);
      sendJson(res, 200, { ok: true, content, hasContent: !!content });
    } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
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
      let body = "";
      req.on("data", c => { body += c; });
      req.on("end", () => {
        (async () => {
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
          // 抓取 + 入库（复用现有流程）
          let meta = {};
          try { meta = await fetcher.fetchMeta(url, "企业微信"); }
          catch (e) { meta = { url, error: e.message }; }
          const name = meta.title || url;
          const cat = meta.category || "其他";
          const site = meta.site || guessSource(url);
          try {
            const text = store.readAll();
            const id = store.nextIdIn(text, cat);
            const snippet = store.buildSnippet({ id, name, url, author: meta.author || "", desc: meta.desc || "", difficulty: 1, image: meta.image || "", site });
            store.writeWithBackup(store.insertSnippet(text, cat, snippet));
            // 回复入库结果
            const reply = meta.warning
              ? `✅ 已记录（兜底解析）\n${id} ${name}\n分类：${cat}\n⚠️ ${meta.warning}`
              : `✅ 已记录\n${id} ${name}\n分类：${cat}${meta.author ? "\n作者：" + meta.author : ""}`;
            try { await wecom.sendText(fromUser, reply); } catch (_) {}
            sendJson(res, 200, { ok: true, id, category: cat });
          } catch (e) {
            try { await wecom.sendText(fromUser, "❌ 记录失败：" + e.message); } catch (_) {}
            sendJson(res, 500, { ok: false, error: String(e) });
          }
        })();
      });
      return;
    }
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
      res.writeHead(200, { "Content-Type": STATIC[p].type, "Cache-Control": "no-store" });
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

/* 优雅退出 */
process.on("SIGINT", () => {
  console.log("\n  服务已停止");
  process.exit(0);
});
process.on("SIGTERM", () => process.exit(0));

server.listen(PORT, HOST, () => {
  ensureDataFile();
  console.log("");
  console.log("  灵感来袭 · 待办看板");
  console.log("  http://localhost:" + PORT);
  console.log("  数据文件: " + README);
  console.log("  企业微信转发入库: " + (wecom.isEnabled() ? "已启用 (/api/wecom/callback)" : "未配置（设置 WECOM_* 环境变量启用）"));
  console.log("  按 Ctrl+C 停止服务");
  console.log("");
  try {
    if (process.platform === "win32" && !process.env.NO_OPEN) {
      execSync("start http://localhost:" + PORT, { stdio: "ignore" });
    }
  } catch (_) { /* 打开浏览器失败不阻塞 */ }
});
