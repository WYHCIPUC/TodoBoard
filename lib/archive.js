"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { httpGet } = require("./fetcher");
const { assertPublicUrl } = require("./safeurl");
const { Readability } = require("@mozilla/readability");
const { parseHTML } = require("linkedom");
const TurndownService = require("turndown");

const STATES = ["queued", "running", "partial", "succeeded", "failed", "manual_required"];
const MAX_RAW_HTML = 20 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });

function nowIso(clock) {
  const value = typeof clock === "function" ? clock() : Date.now();
  return new Date(value).toISOString();
}

function redact(value) {
  let text = String(value || "");
  const cookie = process.env.X_COOKIE;
  if (cookie) text = text.split(cookie).join("[redacted]");
  return text.replace(/(?:x[-_ ]?cookie|cookie)\s*[:=]\s*[^\s,;]+/ig, "$1=[redacted]").slice(0, 500);
}

function safeUid(value) {
  const uid = String(value || "").trim();
  if (!uid || uid === "." || uid === ".." || !/^[a-zA-Z0-9._-]+$/.test(uid)) {
    throw new Error("非法归档条目标识");
  }
  return uid;
}

function cleanText(value, max = 1000) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  let fd;
  try {
    fd = fs.openSync(tmp, "w");
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    try { fs.renameSync(tmp, file); }
    catch (error) {
      // Windows cannot replace an existing file with renameSync. The fallback is
      // only used for an already-known artifact, never for a user-selected path.
      if (!fs.existsSync(file)) throw error;
      fs.unlinkSync(file);
      fs.renameSync(tmp, file);
    }
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    if (fs.existsSync(tmp)) try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function imageExtension(value, contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("png") || (Buffer.isBuffer(value) && value.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))) return "png";
  if (type.includes("gif")) return "gif";
  if (type.includes("webp")) return "webp";
  if (type.includes("svg")) return "svg";
  if (type.includes("jpeg") || type.includes("jpg") || (Buffer.isBuffer(value) && value[0] === 0xff && value[1] === 0xd8)) return "jpg";
  try {
    const ext = path.extname(new URL(String(value)).pathname).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  } catch (_) {}
  return "bin";
}

function metadataFromHtml(html, url) {
  let document;
  try { document = parseHTML(html).document; } catch (_) { return {}; }
  const meta = name => document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.getAttribute("content") || "";
  const title = meta("og:title") || meta("twitter:title") || document.title || "";
  const author = meta("author") || meta("article:author") || meta("og:article:author");
  const summary = meta("og:description") || meta("twitter:description") || meta("description");
  const cover = meta("og:image") || meta("twitter:image") || "";
  const images = [...document.querySelectorAll("img")].map(img => img.getAttribute("src") || "").filter(Boolean).slice(0, 8);
  return { title, author, summary, cover, images, url };
}

async function defaultFetch(url, dependencies = {}) {
  const get = dependencies.httpGet || httpGet;
  const response = await get(url, 10000, {
    "User-Agent": "linggankanban/2.0 archive",
    "Accept-Language": "zh-CN,zh;q=0.9",
  }, MAX_RAW_HTML + 1);
  const rawHtml = Buffer.isBuffer(response.body) ? response.body.toString("utf8") : String(response.body || "");
  if (response.status >= 400) throw new Error("页面请求失败（HTTP " + response.status + "）");
  const meta = metadataFromHtml(rawHtml, url);
  let markdown = "";
  try {
    const document = parseHTML(rawHtml).document;
    const article = new Readability(document, { charThreshold: 100 }).parse();
    if (article?.content) markdown = turndown.turndown(article.content).trim();
    if (!markdown) {
      const text = meta.summary || document.querySelector("article p, main p, p")?.textContent || "";
      if (text) markdown = turndown.turndown(text).trim();
    }
    if (!markdown) throw new Error("无法识别页面正文");
    meta.title = article?.title || meta.title;
  } catch (error) {
    throw Object.assign(new Error(redact(error.message)), { rawHtml, metadata: meta });
  }
  return Object.assign({ rawHtml, markdown, source: "web(readability)" }, meta);
}

function normalizeImage(value) {
  if (!value) return null;
  if (typeof value === "string") return { url: value };
  if (Buffer.isBuffer(value)) return { data: value };
  if (typeof value === "object") return {
    url: value.url || value.src,
    data: value.data || value.buffer,
    contentType: value.contentType || value.type,
  };
  return null;
}

class ArchiveService {
  constructor(options = {}) {
    this.paths = Object.assign({
      entriesDir: path.join(__dirname, "..", "docs", "entries"),
      runtimeDir: path.join(__dirname, "..", ".linggan"),
    }, options.paths || {});
    this.fetch = options.fetch || defaultFetch;
    this.fetchImage = options.fetchImage || (async url => {
      const response = await httpGet(url, 10000, { "User-Agent": "linggankanban/2.0 archive" }, MAX_IMAGE);
      if (response.status >= 400) throw new Error("图片请求失败（HTTP " + response.status + "）");
      return { data: Buffer.from(response.body || ""), contentType: response.contentType || "" };
    });
    this.validateUrl = options.validateUrl || assertPublicUrl;
    this.clock = options.clock || (() => Date.now());
    this.entries = new Map();
    this.queue = options.queue || null;
    if (!this.queue && options.useQueue !== false) {
      // Lazy require keeps archive.js usable by direct artifact tests and avoids
      // a module cycle while the queue attaches itself to this service.
      const { createArchiveQueue } = require("./archive-queue");
      this.queue = createArchiveQueue({
        archive: this,
        file: this.paths.queueFile || path.join(this.paths.runtimeDir, "archive-jobs.json"),
        clock: options.queueClock || options.clock,
        autoStart: options.autoStart !== false,
      });
    }
    if (this.queue && typeof this.queue.attachArchive === "function") this.queue.attachArchive(this);
  }

  enqueue(entry) {
    if (!entry || !entry.id && !entry.uid || !entry.url) throw new Error("归档入队需要已保存的 id 和 URL");
    const id = String(entry.id || entry.uid);
    const uid = safeUid(entry.uid || id);
    const snapshot = this._entrySnapshot(Object.assign({}, entry, { id, uid }));
    this.entries.set(id, snapshot);
    if (!this.queue) return { id, state: "queued" };
    return this.queue.enqueue(snapshot);
  }

  getStatus(id) {
    if (this.queue) return this.queue.getStatus(id);
    const entry = this.entries.get(String(id));
    return entry ? { id: String(id), state: "queued", attempt: 0, nextRunAt: null } : null;
  }

  retry(id) {
    if (!this.queue) throw new Error("归档队列不可用");
    return this.queue.retry(id);
  }

  async archiveContent(id, content) {
    if (!String(content || "").trim()) throw new Error("手动归档内容不能为空");
    const task = this.queue?.getTask(id) || this.entries.get(String(id));
    if (!task) throw new Error("未知归档条目: " + id);
    if (this.queue) {
      this.queue.setManualContent(id, String(content));
      return this.queue.runDue();
    }
    return this.archiveTask(Object.assign({}, task, { manualContent: String(content), attempt: 1 }));
  }

  async archiveTask(task) {
    const id = String(task.id);
    const uid = safeUid(task.uid || id);
    const archiveDir = path.resolve(this.paths.entriesDir, uid, "archive");
    const imagesDir = path.join(archiveDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    const startedAt = nowIso(this.clock);
    const errors = [];
    const degradationReasons = [];
    const artifactPaths = { markdown: "content.md", metadata: "metadata.json", images: [], rawHtml: null };
    const sources = {};
    let fetched = {};
    let rawHtml = null;
    let manual = Boolean(task.manualContent);

    if (manual) {
      fetched = { markdown: String(task.manualContent), title: task.entry?.title || task.title, source: "manual" };
      sources.markdown = "manual";
    } else {
      try {
        fetched = await this.fetch(task.url, { id, entry: task.entry || task });
        if (!fetched || typeof fetched !== "object") throw new Error("抓取器返回无效结果");
        rawHtml = fetched.rawHtml ?? fetched.html ?? fetched.body ?? null;
        sources.markdown = fetched.source || "fetch";
        if (fetched.ok === false || fetched.warning) {
          errors.push(redact(fetched.warning || "抓取器未返回可用正文"));
          degradationReasons.push("抓取器返回了降级结果");
        }
      } catch (error) {
        fetched = error.metadata || {};
        rawHtml = error.rawHtml || null;
        errors.push(redact(error.message));
        degradationReasons.push("外部页面不可用，已保留 URL 和已有元数据");
      }
    }

    const entry = task.entry || task;
    const title = cleanText(fetched.title || entry.title || ("归档 " + id), 200);
    const author = cleanText(fetched.author || entry.author, 200);
    const summary = cleanText(fetched.summary || fetched.desc || entry.summary || entry.desc, 500);
    const markdownBody = String(fetched.markdown ?? fetched.content ?? "").trim();
    let markdown = `# ${title || "未命名条目"}\n\n> 来源: ${task.url}\n\n`;
    if (author) markdown += `> 作者: ${author}\n\n`;
    if (summary) markdown += `> 摘要: ${summary}\n\n`;
    markdown += markdownBody || "> 暂无可用正文，请手动补录内容。\n";
    try { atomicWrite(path.join(archiveDir, "content.md"), markdown + "\n"); }
    catch (error) { errors.push("Markdown 写入失败: " + redact(error.message)); }

    const cover = normalizeImage(fetched.cover || fetched.coverImage || entry.cover);
    const imageValues = (fetched.images || fetched.keyImages || entry.images || []).map(normalizeImage).filter(Boolean);
    const images = [];
    if (cover) images.push(Object.assign({ kind: "cover" }, cover));
    for (const image of imageValues) {
      if (image.url && images.some(item => item.url === image.url)) continue;
      images.push(Object.assign({ kind: "key" }, image));
    }
    let keyIndex = 0;
    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      try {
        let data = image.data;
        let contentType = image.contentType;
        if (data && !Buffer.isBuffer(data)) data = Buffer.from(data, typeof data === "string" ? "base64" : undefined);
        if (!data && image.url) {
          await this.validateUrl(image.url);
          const fetchedImage = await this.fetchImage(image.url, { id, entry });
          data = Buffer.isBuffer(fetchedImage) ? fetchedImage : Buffer.from(fetchedImage.data || fetchedImage.body || "");
          contentType = contentType || fetchedImage.contentType || fetchedImage.mimeType;
        }
        if (!data || !data.length) throw new Error("图片内容为空");
        if (data.length > MAX_IMAGE) throw new Error("图片超过 10MB 限制");
        const prefix = image.kind === "cover" ? "cover" : "key-" + String(++keyIndex).padStart(2, "0");
        const file = prefix + "." + imageExtension(data, contentType || image.url);
        atomicWrite(path.join(imagesDir, file), data);
        artifactPaths.images.push("images/" + file);
      } catch (error) {
        errors.push("图片写入失败: " + redact(error.message));
      }
    }

    if (rawHtml !== null && rawHtml !== undefined) {
      const raw = Buffer.isBuffer(rawHtml) ? rawHtml : Buffer.from(String(rawHtml));
      if (raw.length > MAX_RAW_HTML) {
        degradationReasons.push("原始 HTML 超过20MB，已跳过 raw.html.gz");
        artifactPaths.rawHtml = null;
      } else {
        try {
          atomicWrite(path.join(archiveDir, "raw.html.gz"), zlib.gzipSync(raw));
          artifactPaths.rawHtml = "raw.html.gz";
        } catch (error) { errors.push("原始 HTML 写入失败: " + redact(error.message)); }
      }
    }

    if (!rawHtml && !manual) degradationReasons.push("未获得可保存的原始 HTML");
    const hasMarkdown = fs.existsSync(path.join(archiveDir, "content.md"));
    let state = hasMarkdown && errors.length === 0 && degradationReasons.length === 0 ? "succeeded" : "partial";
    const metadata = {
      id,
      uid,
      url: task.url,
      title,
      author,
      summary,
      createdAt: task.createdAt || startedAt,
      updatedAt: nowIso(this.clock),
      state,
      fieldSources: Object.assign({ title: fetched.title ? "fetch" : "entry", author: fetched.author ? "fetch" : "entry", summary: fetched.summary || fetched.desc ? "fetch" : "entry" }, sources),
      artifacts: artifactPaths,
      errors,
      degradationReasons,
      rawHtmlBytes: rawHtml === null || rawHtml === undefined ? null : (Buffer.isBuffer(rawHtml) ? rawHtml.length : Buffer.byteLength(String(rawHtml))),
    };
    try { atomicWrite(path.join(archiveDir, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n"); }
    catch (error) {
      errors.push("metadata 写入失败: " + redact(error.message));
      state = "partial";
    }
    return { state, retryable: !manual && (errors.length > 0 || degradationReasons.some(reason => !reason.includes("超过 20MB"))), metadata };
  }

  _entrySnapshot(entry) {
    const allowed = ["id", "uid", "url", "title", "author", "summary", "desc", "site", "cover", "images", "source", "tags"];
    const snapshot = {};
    for (const key of allowed) if (entry[key] !== undefined) snapshot[key] = entry[key];
    return snapshot;
  }

  stop() { if (this.queue?.stop) return this.queue.stop(); }
  async drain() { if (this.queue?.drain) return this.queue.drain(); }
}

function createArchiveService(options) { return new ArchiveService(options); }

module.exports = {
  ArchiveService,
  createArchiveService,
  defaultFetch,
  atomicWrite,
  MAX_RAW_HTML,
  STATES,
};
