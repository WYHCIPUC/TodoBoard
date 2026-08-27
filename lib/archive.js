"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { httpGet } = require("./fetcher");
const { assertPublicUrl } = require("./safeurl");
const { scrapeContent } = require("./scraper");
const { Readability } = require("@mozilla/readability");
const { parseHTML } = require("linkedom");
const TurndownService = require("turndown");
const { UUID_RE, sha256 } = require("./backup-format");
const { renameWithRetry } = require("./backup-transaction");
const { defaultCoordinator } = require("./maintenance");
const { atomicJson: durableJson, syncDirectory, writeFileDurable } = require("./idempotency");
const archiveQuality = require("./archive-quality");
const archiveIntegrity = require("./archive-integrity");
const canonicalContent = require("./archive-content");
const store = require("./store");

const STATES = ["queued", "running", "partial", "succeeded", "failed", "manual_required"];
const MAX_RAW_HTML = 20 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const EMPTY_CONTENT = "> 暂无可用正文，请手动补录内容。";
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
  return store.trustedWriteFile(file, Buffer.isBuffer(data) ? data : Buffer.from(String(data)), { action: "archive.atomic", controlDir: path.dirname(file) });
}

function imageExtension(value, contentType) {
  if (Buffer.isBuffer(value)) {
    if (value.length >= 8 && value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
    if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) return "jpg";
    if (value.length >= 6 && ["GIF87a", "GIF89a"].includes(value.subarray(0, 6).toString("ascii"))) return "gif";
    if (value.length >= 12 && value.subarray(0, 4).toString("ascii") === "RIFF" && value.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
    return "bin";
  }
  const type = String(contentType || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("gif")) return "gif";
  if (type.includes("webp")) return "webp";
  if (type.includes("svg")) return "svg";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
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

async function legacyReadabilityFetch(url, dependencies) {
  const get = dependencies.httpGet;
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
  return Object.assign({ rawHtml, markdown, source: "web(readability)", authority: "readability" }, meta);
}

async function defaultFetch(url, dependencies = {}) {
  // Keep the exported httpGet injection used by focused archive tests and
  // callers, while routing the production path through every site adapter.
  if (dependencies.httpGet && !dependencies.scrapeContent) {
    return legacyReadabilityFetch(url, dependencies);
  }
  const scrape = dependencies.scrapeContent || scrapeContent;
  const result = await scrape(url);
  if (!result || typeof result !== "object") throw new Error("抓取器返回无效结果");
  const metadata = result.metadata && typeof result.metadata === "object" ? result.metadata : {};
  const reasons = Array.isArray(result.reasons) ? result.reasons.filter(Boolean) : [];
  return Object.assign({}, metadata, result, {
    title: result.title || metadata.title || "",
    author: result.author || metadata.author || "",
    summary: result.summary || result.desc || metadata.summary || metadata.description || metadata.excerpt || "",
    images: result.images || result.keyImages || result.imageCandidates || [],
    warning: result.warning || reasons[0] || "",
    authority: result.authority || "site_scraper",
  });
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

function utf8Compare(left, right) { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }

function durableTree(root, files) {
  fs.mkdirSync(root, { recursive: true });
  for (const [relative, bytes] of files) {
    const file = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileDurable(file, bytes);
    syncDirectory(path.dirname(file));
  }
  syncDirectory(root);
}

function removeOwnedDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory()) throw new Error("拒绝删除非普通事务目录");
  fs.rmSync(directory, { recursive: true, force: false });
  syncDirectory(path.dirname(directory));
}

function archiveFiles(directory) {
  const validation = archiveIntegrity.validateArchiveDirectory(directory);
  if (!validation.valid) return null;
  return validation.manifest.files.map(record => [record.path, fs.readFileSync(path.join(directory, ...record.path.split("/"))), record]);
}

function buildManifest(snapshotId, createdAt, quality, files) {
  const records = files.map(([relative, bytes, provenance]) => ({
    path: relative,
    bytes: bytes.length,
    sha256: sha256(bytes),
    provenance,
  })).sort((left, right) => utf8Compare(left.path, right.path));
  const manifest = {
    version: 1,
    snapshotId,
    createdAt,
    quality: {
      manual: quality.manual,
      authority: quality.authority,
      state: quality.state,
      normalizedChars: quality.normalizedChars,
    },
    files: records,
  };
  return { manifest, bytes: Buffer.from(archiveIntegrity.canonicalManifest(manifest)) };
}

function updateExpectedIndex(runtimeDir, uid, snapshotId, manifestHash, options = {}) {
  const indexFile = path.join(runtimeDir, "archive-snapshots.json");
  const cacheFile = path.join(runtimeDir, "archive-integrity.json");
  let index = { version: 1, items: {} };
  let cache = { version: 1, items: {} };
  try { index = JSON.parse(fs.readFileSync(indexFile, "utf8")); } catch (_) {}
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch (_) {}
  if (!index.items || typeof index.items !== "object") index = { version: 1, items: {} };
  if (!cache.items || typeof cache.items !== "object") cache = { version: 1, items: {} };
  index.items[uid] = { snapshotId, manifestHash };
  delete cache.items[uid];
  store.trustedWriteSet([
    { file: indexFile, bytes: Buffer.from(JSON.stringify(index)) },
    { file: cacheFile, bytes: Buffer.from(JSON.stringify(cache)) },
  ], { action: "archive.index", coordinator: options.coordinator, leaseToken: options.leaseToken, controlDir: runtimeDir });
}

function recoverArchiveTransactions(options = {}) {
  const entriesDir = path.resolve(options.entriesDir || path.join(process.cwd(), "entries"));
  const runtimeDir = path.resolve(options.runtimeDir || path.join(process.cwd(), ".linggan"));
  if (!fs.existsSync(entriesDir)) return { recovered: 0, rolledBack: 0 };
  const coordinator = options.coordinator || defaultCoordinator;
  const lease = coordinator.acquireMutation(options.leaseToken);
  let recovered = 0;
  let rolledBack = 0;
  try {
    for (const entry of fs.readdirSync(entriesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const entryDir = path.join(entriesDir, entry.name);
      const markers = fs.readdirSync(entryDir).filter(name => /^\.archive-transaction-[0-9a-f-]{36}\.json$/.test(name)).sort();
      for (const name of markers) {
        const markerFile = path.join(entryDir, name);
        let marker;
        try { marker = JSON.parse(fs.readFileSync(markerFile, "utf8")); } catch (error) {
          throw Object.assign(new Error("归档事务 marker 不可读: " + name), { code: "manual_recovery_required", cause: error });
        }
        const snapshotId = name.slice(".archive-transaction-".length, -".json".length);
        const states = new Set(["stage_ready", "protected_ready", "old_ready", "live_ready", "verified", "completed", "old_restored", "rolled_back"]);
        if (!marker || marker.version !== 1 || marker.uid !== entry.name || marker.snapshotId !== snapshotId || !UUID_RE.test(snapshotId) || !states.has(marker.state) || !/^[0-9a-f]{64}$/.test(marker.stageManifestHash || "")) {
          throw Object.assign(new Error("归档事务 marker 字段非法: " + name), { code: "manual_recovery_required" });
        }
        const live = path.join(entryDir, "archive");
        const stage = path.join(entryDir, ".archive-stage-" + snapshotId);
        const old = path.join(entryDir, ".archive-old-" + snapshotId);
        const protectedRoot = path.join(entryDir, "protected-generations");
        const protectedStage = path.join(protectedRoot, ".stage-" + snapshotId);
        const protectedFinal = path.join(protectedRoot, snapshotId);
        const currentFile = path.join(protectedRoot, "current.json");
        const saveMarker = state => {
          marker.state = state;
          marker.updatedAt = nowIso(options.clock);
          durableJson(markerFile, marker);
        };
        const restoreCurrent = () => {
          const bytes = marker.previousCurrent === null || marker.previousCurrent === undefined
            ? null
            : Buffer.from(String(marker.previousCurrent));
          store.trustedWriteFile(currentFile, bytes, { action: "archive.current.recover", coordinator, leaseToken: lease, controlDir: runtimeDir });
        };
        const cleanCandidate = () => {
          for (const target of [stage, protectedStage, protectedFinal]) if (fs.existsSync(target)) removeOwnedDirectory(target);
        };
        const rollback = () => {
          if (fs.existsSync(old)) {
            if (fs.existsSync(live)) {
              const candidate = archiveIntegrity.validateArchiveDirectory(live, { uid: entry.name, snapshotId });
              if (candidate.valid && candidate.manifestHash === marker.stageManifestHash) {
                removeOwnedDirectory(live);
              } else {
                const failed = path.join(entryDir, ".archive-recovery-failed-" + snapshotId);
                if (fs.existsSync(failed)) throw Object.assign(new Error("归档失败代保存路径冲突"), { code: "manual_recovery_required" });
                renameWithRetry(live, failed);
                syncDirectory(entryDir);
              }
            }
            renameWithRetry(old, live);
            syncDirectory(entryDir);
          }
          if (marker.oldManifestHash) {
            const restored = archiveIntegrity.validateArchiveDirectory(live, { uid: entry.name });
            if (!restored.valid || restored.manifestHash !== marker.oldManifestHash) throw Object.assign(new Error("旧归档代无法验证"), { code: "manual_recovery_required" });
          }
          restoreCurrent();
          cleanCandidate();
          saveMarker("rolled_back");
          rolledBack++;
        };
        if (["completed", "rolled_back"].includes(marker.state)) {
          for (const target of [stage, old, protectedStage]) if (fs.existsSync(target)) removeOwnedDirectory(target);
          continue;
        }
        if (["stage_ready", "protected_ready"].includes(marker.state)) {
          cleanCandidate();
          saveMarker("rolled_back");
          rolledBack++;
          continue;
        }
        if (["old_ready", "old_restored"].includes(marker.state)) {
          rollback();
          continue;
        }
        const active = archiveIntegrity.validateArchiveDirectory(live, { uid: entry.name, snapshotId });
        const protectedCopy = archiveIntegrity.validateArchiveDirectory(path.join(protectedFinal, "archive"), { uid: entry.name, snapshotId });
        if (!active.valid || active.manifestHash !== marker.stageManifestHash || !protectedCopy.valid || protectedCopy.manifestHash !== marker.stageManifestHash) {
          if (fs.existsSync(old)) { rollback(); continue; }
          throw Object.assign(new Error("新归档代无法完成且没有可回滚旧代"), { code: "manual_recovery_required" });
        }
        const current = { version: 1, uid: entry.name, snapshotId, manifestSha256: marker.stageManifestHash, createdAt: active.manifest.createdAt };
        store.trustedWriteFile(currentFile, Buffer.from(JSON.stringify(current)), { action: "archive.current.recover", coordinator, leaseToken: lease, controlDir: runtimeDir });
        updateExpectedIndex(runtimeDir, entry.name, snapshotId, marker.stageManifestHash, { coordinator, leaseToken: lease });
        saveMarker("completed");
        if (fs.existsSync(old)) removeOwnedDirectory(old);
        recovered++;
      }
    }
    return { recovered, rolledBack };
  } finally {
    coordinator.releaseMutation(lease);
  }
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
      const data = Buffer.isBuffer(response.rawBody) ? response.rawBody : Buffer.from(response.body || "");
      return { data, contentType: response.contentType || "" };
    });
    this.validateUrl = options.validateUrl || assertPublicUrl;
    this.clock = options.clock || (() => Date.now());
    this.coordinator = options.coordinator || defaultCoordinator;
    this.entries = new Map();
    this.uidTails = new Map();
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

  enqueue(entry, options) {
    if (!entry || !entry.id && !entry.uid || !entry.url) throw new Error("归档入队需要已保存的 id 和 URL");
    const id = String(entry.id || entry.uid);
    const uid = safeUid(entry.uid || id);
    const snapshot = this._entrySnapshot(Object.assign({}, entry, { id, uid }));
    this.entries.set(id, snapshot);
    if (!this.queue) return { id, state: "queued" };
    return this.queue.enqueue(snapshot, options);
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
      return this.queue.runAndWait(id);
    }
    return this.archiveTask(Object.assign({}, task, { manualContent: String(content), attempt: 1 }));
  }

  _serializeUid(uid, work) {
    const previous = this.uidTails.get(uid) || Promise.resolve();
    const next = previous.then(work, work);
    const tail = next.catch(() => {});
    this.uidTails.set(uid, tail);
    return next.finally(() => {
      if (this.uidTails.get(uid) === tail) this.uidTails.delete(uid);
    });
  }

  async archiveTask(task) {
    const id = String(task.id);
    const uid = safeUid(task.uid || id);
    return this._serializeUid(uid, async () => {
      const startedAt = nowIso(this.clock);
      const entry = task.entry || task;
      const migration = task.migrationContent !== undefined;
      let manualBody = migration ? task.migrationContent : task.manualContent;
      if (!manualBody && task.manualDraftHash) {
        const draftFile = path.join(this.paths.entriesDir, uid, "drafts", "manual-" + task.manualDraftHash + ".md");
        const bytes = fs.readFileSync(draftFile);
        if (sha256(bytes) !== task.manualDraftHash) throw new Error("手动草稿 hash 不匹配");
        manualBody = bytes.toString("utf8");
      }
      const manual = Boolean(manualBody) && !migration;
      const errors = [];
      const degradationReasons = [];
      let fetched = {};
      let rawHtml = null;
      if (migration) {
        fetched = { markdown: String(manualBody), title: entry.title || task.title, source: "legacy migration", authority: "legacy_unknown" };
      } else if (manual) {
        fetched = { markdown: String(manualBody), title: entry.title || task.title, source: "manual", authority: "manual" };
      } else {
        try {
          fetched = await this.fetch(task.url, { id, entry });
          if (!fetched || typeof fetched !== "object") throw new Error("抓取器返回无效结果");
          rawHtml = fetched.rawHtml ?? fetched.html ?? fetched.body ?? null;
          const status = fetched.status || fetched.state || "";
          if (fetched.ok === false || fetched.warning || ["partial", "failed", "manual_required"].includes(status)) {
            errors.push(redact(fetched.warning || "抓取器返回降级结果"));
            degradationReasons.push("抓取器返回了降级结果");
          }
        } catch (error) {
          fetched = error.metadata || {};
          rawHtml = error.rawHtml || null;
          errors.push(redact(error.message));
          degradationReasons.push("外部页面不可用，已保留现有本地正文");
        }
      }
      const title = cleanText(fetched.title || entry.title || ("归档 " + id), 200);
      const author = cleanText(fetched.author || entry.author, 200);
      const summary = cleanText(fetched.summary || fetched.desc || entry.summary || entry.desc, 500);
      const body = String(fetched.markdown ?? fetched.content ?? "").trim();
      let markdown = `# ${title || "未命名条目"}\n\n`;
      if (!manual && task.url) markdown += `> 来源: ${task.url}\n\n`;
      if (author) markdown += `> 作者: ${author}\n\n`;
      if (summary) markdown += `> 摘要: ${summary}\n\n`;
      markdown += body || EMPTY_CONTENT;
      markdown += "\n";

      const candidateArtifacts = [];
      const cover = normalizeImage(fetched.cover || fetched.coverImage || entry.cover);
      const imageValues = (fetched.images || fetched.keyImages || entry.images || []).map(normalizeImage).filter(Boolean);
      const images = [];
      if (cover) images.push({ ...cover, kind: "cover" });
      for (const image of imageValues) if (!image.url || !images.some(item => item.url === image.url)) images.push({ ...image, kind: "key" });
      let keyIndex = 0;
      for (const image of images) {
        try {
          let data = image.data;
          let contentType = image.contentType;
          if (data && !Buffer.isBuffer(data)) data = Buffer.from(data, typeof data === "string" ? "base64" : undefined);
          if (!data && image.url) {
            await this.validateUrl(image.url);
            const imageResult = await this.fetchImage(image.url, { id, entry });
            const fetchedData = imageResult?.data ?? imageResult?.rawBody ?? imageResult?.body ?? "";
            data = Buffer.isBuffer(imageResult) ? imageResult : Buffer.isBuffer(fetchedData) ? fetchedData : Buffer.from(fetchedData);
            contentType = contentType || imageResult?.contentType || imageResult?.mimeType;
          }
          if (!data?.length) throw new Error("图片内容为空");
          if (data.length > MAX_IMAGE) throw new Error("图片超过 10MB 限制");
          const extension = imageExtension(data, contentType || image.url);
          if (!["png", "jpg", "gif", "webp"].includes(extension)) throw new Error("图片类型不受可信归档支持");
          const prefix = image.kind === "cover" ? "cover" : "key-" + String(++keyIndex).padStart(2, "0");
          candidateArtifacts.push(["images/" + prefix + "." + extension, data, "fresh"]);
        } catch (error) { errors.push("图片留存失败: " + redact(error.message)); }
      }
      if (rawHtml !== null && rawHtml !== undefined) {
        const raw = Buffer.isBuffer(rawHtml) ? rawHtml : Buffer.from(String(rawHtml));
        if (raw.length > MAX_RAW_HTML) degradationReasons.push("原始 HTML 超过20MB，已跳过 raw.html.gz");
        else {
          const compressed = zlib.gzipSync(raw);
          if (compressed.length > MAX_RAW_HTML) degradationReasons.push("压缩原始 HTML 超过20MB，已跳过 raw.html.gz");
          else candidateArtifacts.push(["raw.html.gz", compressed, "fresh"]);
        }
      } else if (!manual) {
        degradationReasons.push("未获得可保存的原始 HTML");
      }

      const authority = manual ? "manual" : (fetched.authority || "site_scraper");
      const captureState = manual ? "manual" : (errors.length || degradationReasons.length ? "partial" : "succeeded");
      let quality;
      try { quality = archiveQuality.assessCandidate({ content: markdown, title, authority, captureState }); }
      catch (error) {
        await this._recordAttempt(uid, { authority: String(authority), state: "unusable", normalizedChars: 0 }, "invalid_authority", false);
        return { state: "partial", retryable: false, reasonCode: "invalid_authority", error: error.message };
      }
      const entryDir = path.resolve(this.paths.entriesDir, uid);
      const liveDir = path.join(entryDir, "archive");
      let active = null;
      let activeFiles = null;
      if (fs.existsSync(liveDir)) {
        const manifestExists = fs.existsSync(path.join(liveDir, "manifest.json"));
        if (manifestExists) {
          const validation = archiveIntegrity.validateArchiveDirectory(liveDir, { uid });
          if (!validation.valid) return { state: "partial", retryable: false, reasonCode: validation.reasonCodes[0], error: "现有归档完整性损坏" };
          active = validation.manifest.quality;
          activeFiles = archiveFiles(liveDir);
        } else {
          let legacy = "";
          const legacyFile = path.join(liveDir, "content.md");
          try {
            if (fs.existsSync(legacyFile) && !fs.lstatSync(legacyFile).isFile()) return { state: "partial", retryable: false, reasonCode: "unsupported_file_type", error: "旧归档正文不是普通文件" };
            if (fs.existsSync(legacyFile)) legacy = fs.readFileSync(legacyFile, "utf8");
          } catch (_) { return { state: "partial", retryable: false, reasonCode: "unreadable", error: "旧归档正文不可读" }; }
          if (legacy.trim()) active = { ...archiveQuality.assessCandidate({ content: legacy, title, authority: "legacy_unknown", captureState: "succeeded" }), authority: "legacy_unknown" };
          else return { state: "partial", retryable: false, reasonCode: "unverified", error: "旧归档需先完成 canonical 迁移" };
        }
      }
      const comparison = migration ? { accepted: quality.usable, reasonCode: quality.usable ? null : "candidate_unusable" } : archiveQuality.compareCandidate(quality, active);
      if (!comparison.accepted) {
        const retryable = comparison.reasonCode === "candidate_unusable" && !active;
        await this._recordAttempt(uid, quality, comparison.reasonCode, retryable);
        return { state: "partial", retryable, reasonCode: comparison.reasonCode, contentPreserved: Boolean(active), errors, degradationReasons };
      }

      const snapshotId = crypto.randomUUID();
      const createdAt = nowIso(this.clock);
      const metadata = {
        archiveSchemaVersion: 2,
        snapshotId,
        entry: { uid, id, url: String(task.url || ""), title },
        capture: { state: captureState, authority, manual, capturedAt: createdAt, source: cleanText(fetched.source || task.source || authority, 200) },
        migrationWarnings: [...new Set(task.migrationWarnings || [])].sort(),
      };
      const files = [
        ["content.md", Buffer.from(markdown), manual ? "manual" : migration ? "legacy_unverified" : "fresh"],
        ["metadata.json", Buffer.from(JSON.stringify(metadata)), "fresh"],
        ...candidateArtifacts,
      ];
      if (activeFiles) {
        const present = new Set(files.map(item => item[0]));
        for (const [relative, bytes] of activeFiles) {
          if ((relative === "raw.html.gz" || relative.startsWith("images/")) && !present.has(relative)) files.push([relative, bytes, "inherited"]);
        }
      }
      files.sort((left, right) => utf8Compare(left[0], right[0]));
      const built = buildManifest(snapshotId, createdAt, quality, files);
      files.push(["manifest.json", built.bytes, "manifest"]);
      const committed = await this._commitCandidate(uid, snapshotId, files, built.manifest, task.leaseToken);
      const state = quality.state === "usable_clean" && !errors.length && !degradationReasons.length ? "succeeded" : "partial";
      return {
        state,
        retryable: false,
        snapshotId,
        operationId: committed.operationId,
        metadata: { ...metadata, errors, degradationReasons, artifacts: files.map(item => item[0]).filter(name => name !== "manifest.json") },
      };
    });
  }

  async _recordAttempt(uid, quality, reasonCode, retryable) {
    const file = path.join(this.paths.runtimeDir, "archive-attempts.json");
    let value = { version: 1, items: {} };
    try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
    if (!value || value.version !== 1 || !value.items || typeof value.items !== "object") value = { version: 1, items: {} };
    value.items[uid] = {
      attemptedAt: nowIso(this.clock),
      state: "partial",
      reasonCode,
      retryable: Boolean(retryable),
      candidate: { authority: quality.authority, state: quality.state, normalizedChars: quality.normalizedChars },
    };
    store.trustedWriteFile(file, Buffer.from(JSON.stringify(value)), { action: "archive.attempt", coordinator: this.coordinator, controlDir: this.paths.runtimeDir });
  }

  async _commitCandidate(uid, snapshotId, files, manifest, leaseToken) {
    const lease = this.coordinator.acquireMutation(leaseToken);
    const entryDir = path.resolve(this.paths.entriesDir, uid);
    const live = path.join(entryDir, "archive");
    const stage = path.join(entryDir, ".archive-stage-" + snapshotId);
    const old = path.join(entryDir, ".archive-old-" + snapshotId);
    const protectedRoot = path.join(entryDir, "protected-generations");
    const protectedStage = path.join(protectedRoot, ".stage-" + snapshotId);
    const protectedFinal = path.join(protectedRoot, snapshotId);
    const currentFile = path.join(protectedRoot, "current.json");
    const markerFile = path.join(entryDir, ".archive-transaction-" + snapshotId + ".json");
    const manifestHash = sha256(Buffer.from(archiveIntegrity.canonicalManifest(manifest)));
    const previousCurrent = fs.existsSync(currentFile) ? fs.readFileSync(currentFile) : null;
    const marker = {
      version: 1, uid, snapshotId, state: "stage_ready",
      stage: path.basename(stage), live: "archive", old: path.basename(old),
      stageManifestHash: manifestHash, oldManifestHash: null,
      protectedSnapshotId: snapshotId, protectedManifestHash: manifestHash,
      previousCurrent: previousCurrent ? previousCurrent.toString("utf8") : null,
      updatedAt: nowIso(this.clock),
    };
    const hadLive = fs.existsSync(live);
    let reusableCompletedMarker = false;
    if (fs.existsSync(markerFile)) {
      try {
        const previousMarker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
        reusableCompletedMarker = previousMarker.version === 1 &&
          previousMarker.uid === uid && previousMarker.snapshotId === snapshotId &&
          previousMarker.state === "completed" && previousMarker.stageManifestHash === manifestHash;
      } catch (_) {}
    }
    const saveMarker = state => {
      marker.state = state;
      marker.updatedAt = nowIso(this.clock);
      durableJson(markerFile, marker);
    };
    try {
      if ([stage, old, protectedStage, protectedFinal].some(target => fs.existsSync(target)) || fs.existsSync(markerFile) && !reusableCompletedMarker) {
        throw new Error("归档事务路径碰撞");
      }
      durableTree(stage, files.map(([relative, bytes]) => [relative, bytes]));
      let validation = archiveIntegrity.validateArchiveDirectory(stage, { uid, snapshotId });
      if (!validation.valid) throw new Error("候选 stage 验证失败: " + validation.reasonCodes.join(","));
      saveMarker("stage_ready");
      durableTree(path.join(protectedStage, "archive"), files.map(([relative, bytes]) => [relative, bytes]));
      validation = archiveIntegrity.validateArchiveDirectory(path.join(protectedStage, "archive"), { uid, snapshotId });
      if (!validation.valid) throw new Error("保护代 stage 验证失败");
      fs.mkdirSync(protectedRoot, { recursive: true });
      renameWithRetry(protectedStage, protectedFinal);
      syncDirectory(protectedRoot);
      saveMarker("protected_ready");
      if (fs.existsSync(live)) {
        const oldValidation = archiveIntegrity.validateArchiveDirectory(live, { uid });
        marker.oldManifestHash = oldValidation.valid ? oldValidation.manifestHash : null;
        renameWithRetry(live, old);
        syncDirectory(entryDir);
      }
      saveMarker("old_ready");
      renameWithRetry(stage, live);
      syncDirectory(entryDir);
      saveMarker("live_ready");
      validation = archiveIntegrity.validateArchiveDirectory(live, { uid, snapshotId });
      if (!validation.valid || validation.manifestHash !== manifestHash) throw new Error("活动归档写后验证失败");
      saveMarker("verified");
      const current = { version: 1, uid, snapshotId, manifestSha256: manifestHash, createdAt: manifest.createdAt };
      durableJson(currentFile, current);
      const protectedValidation = archiveIntegrity.validateArchiveDirectory(path.join(protectedFinal, "archive"), { uid, snapshotId });
      if (!protectedValidation.valid || protectedValidation.manifestHash !== manifestHash) throw new Error("current 保护代复验失败");
      this._updateExpectedIndex(uid, snapshotId, manifestHash, lease);
      saveMarker("completed");
      if (fs.existsSync(old)) removeOwnedDirectory(old);
      const generations = fs.readdirSync(protectedRoot, { withFileTypes: true })
        .filter(item => item.isDirectory() && /^[0-9a-f-]{36}$/.test(item.name) && item.name !== snapshotId)
        .map(item => item.name).sort().reverse();
      for (const name of generations.slice(1)) removeOwnedDirectory(path.join(protectedRoot, name));
      return { operationId: snapshotId, manifestHash };
    } catch (error) {
      if (fs.existsSync(old)) {
        if (fs.existsSync(live)) removeOwnedDirectory(live);
        renameWithRetry(old, live);
        syncDirectory(entryDir);
        saveMarker("old_restored");
        const restored = marker.oldManifestHash && archiveIntegrity.validateArchiveDirectory(live, { uid });
        if (marker.oldManifestHash && (!restored.valid || restored.manifestHash !== marker.oldManifestHash)) throw Object.assign(new Error("归档回滚验证失败"), { code: "manual_recovery_required", cause: error });
        store.trustedWriteFile(currentFile, previousCurrent, { action: "archive.current.rollback", coordinator: this.coordinator, leaseToken: lease, controlDir: this.paths.runtimeDir });
        saveMarker("completed");
      } else if (!hadLive && fs.existsSync(live)) {
        removeOwnedDirectory(live);
        store.trustedWriteFile(currentFile, previousCurrent, { action: "archive.current.rollback", coordinator: this.coordinator, leaseToken: lease, controlDir: this.paths.runtimeDir });
      }
      if (fs.existsSync(stage)) removeOwnedDirectory(stage);
      if (fs.existsSync(protectedStage)) removeOwnedDirectory(protectedStage);
      if (fs.existsSync(protectedFinal)) removeOwnedDirectory(protectedFinal);
      throw error;
    } finally {
      this.coordinator.releaseMutation(lease);
    }
  }

  _updateExpectedIndex(uid, snapshotId, manifestHash, leaseToken) {
    updateExpectedIndex(this.paths.runtimeDir, uid, snapshotId, manifestHash, { coordinator: this.coordinator, leaseToken });
  }

  consumeManualDraft(uidValue, digest) {
    const uid = safeUid(uidValue);
    if (!/^[0-9a-f]{64}$/.test(digest || "")) throw new Error("手动草稿 hash 非法");
    const directory = path.join(this.paths.entriesDir, uid, "drafts");
    store.trustedWriteSet([
      { file: path.join(directory, "manual-" + digest + ".md"), bytes: null },
      { file: path.join(directory, "manual-" + digest + ".json"), bytes: null },
    ], { action: "archive.draft.consume", coordinator: this.coordinator, controlDir: this.paths.runtimeDir });
  }

  async protectExisting(uidValue) {
    const uid = safeUid(uidValue);
    return this._serializeUid(uid, async () => {
      const live = path.join(this.paths.entriesDir, uid, "archive");
      const validation = archiveIntegrity.validateArchiveDirectory(live, { uid });
      if (!validation.valid) throw Object.assign(new Error("活动归档不能建立保护代"), { code: validation.reasonCodes[0] });
      const current = path.join(this.paths.entriesDir, uid, "protected-generations", "current.json");
      if (fs.existsSync(current)) {
        const value = JSON.parse(fs.readFileSync(current, "utf8"));
        if (value.snapshotId === validation.snapshotId && value.manifestSha256 === validation.manifestHash) return { protected: false, snapshotId: validation.snapshotId };
      }
      const protectedArchive = path.join(this.paths.entriesDir, uid, "protected-generations", validation.snapshotId, "archive");
      const protectedValidation = archiveIntegrity.validateArchiveDirectory(protectedArchive, { uid, snapshotId: validation.snapshotId });
      if (protectedValidation.valid && protectedValidation.manifestHash === validation.manifestHash) {
        const pointer = {
          version: 1,
          uid,
          snapshotId: validation.snapshotId,
          manifestSha256: validation.manifestHash,
          createdAt: validation.manifest.createdAt,
        };
        const result = store.trustedWriteFile(current, JSON.stringify(pointer), {
          action: "archive.protect.current",
          coordinator: this.coordinator,
          controlDir: this.paths.runtimeDir,
        });
        return { protected: true, snapshotId: validation.snapshotId, operationId: result.operationId };
      }
      const files = validation.manifest.files.map(record => [record.path, fs.readFileSync(path.join(live, ...record.path.split("/"))), record.provenance]);
      files.push(["manifest.json", fs.readFileSync(path.join(live, "manifest.json")), "manifest"]);
      return this._commitCandidate(uid, validation.snapshotId, files, validation.manifest);
    });
  }

  async addMigrationWarning(uidValue, warning) {
    const uid = safeUid(uidValue);
    return this._serializeUid(uid, async () => {
      const live = path.join(this.paths.entriesDir, uid, "archive");
      const validation = archiveIntegrity.validateArchiveDirectory(live, { uid });
      if (!validation.valid) throw new Error("活动归档损坏，不能记录迁移警告");
      if (validation.metadata.migrationWarnings.includes(warning)) return { changed: false, snapshotId: validation.snapshotId };
      const snapshotId = crypto.randomUUID();
      const createdAt = nowIso(this.clock);
      const metadata = {
        ...validation.metadata,
        snapshotId,
        capture: { ...validation.metadata.capture, capturedAt: createdAt },
        migrationWarnings: [...validation.metadata.migrationWarnings, warning].sort(),
      };
      const files = validation.manifest.files
        .filter(record => record.path !== "metadata.json")
        .map(record => [record.path, fs.readFileSync(path.join(live, ...record.path.split("/"))), "inherited"]);
      files.push(["metadata.json", Buffer.from(JSON.stringify(metadata)), "fresh"]);
      files.sort((left, right) => utf8Compare(left[0], right[0]));
      const quality = validation.manifest.quality;
      const built = buildManifest(snapshotId, createdAt, quality, files);
      files.push(["manifest.json", built.bytes, "manifest"]);
      return this._commitCandidate(uid, snapshotId, files, built.manifest);
    });
  }

  async restoreProtected(uidValue, currentValue) {
    const uid = safeUid(uidValue);
    return this._serializeUid(uid, async () => {
      const protectedArchive = path.join(this.paths.entriesDir, uid, "protected-generations", currentValue.snapshotId, "archive");
      const validation = archiveIntegrity.validateArchiveDirectory(protectedArchive, { uid, snapshotId: currentValue.snapshotId });
      if (!validation.valid || validation.manifestHash !== currentValue.manifestSha256) throw new Error("current 保护代不可恢复");
      const snapshotId = crypto.randomUUID();
      const createdAt = nowIso(this.clock);
      const metadata = {
        ...validation.metadata,
        snapshotId,
        capture: { ...validation.metadata.capture, capturedAt: createdAt },
        migrationWarnings: [...new Set([...validation.metadata.migrationWarnings, "downgrade_archive_rewritten"])].sort(),
      };
      const files = validation.manifest.files.filter(record => record.path !== "metadata.json").map(record => [
        record.path, fs.readFileSync(path.join(protectedArchive, ...record.path.split("/"))), "inherited",
      ]);
      files.push(["metadata.json", Buffer.from(JSON.stringify(metadata)), "fresh"]);
      files.sort((left, right) => utf8Compare(left[0], right[0]));
      const built = buildManifest(snapshotId, createdAt, validation.manifest.quality, files);
      files.push(["manifest.json", built.bytes, "manifest"]);
      return this._commitCandidate(uid, snapshotId, files, built.manifest);
    });
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
  recoverArchiveTransactions,
  atomicWrite,
  MAX_RAW_HTML,
  STATES,
};
