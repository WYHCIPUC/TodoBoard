"use strict";

const path = require("path");
const defaultFetcher = require("./fetcher");
const defaultStore = require("./store");
const schema = require("./schema");
const { guessSource: defaultGuessSource } = require("./classifier");
const { createArchiveService } = require("./archive");

function createDefaultArchive() {
  const entriesDir = process.env.ENTRIES_DIR || path.join(__dirname, "..", "docs", "entries");
  const runtimeDir = path.join(path.dirname(defaultStore.README), ".linggan");
  return createArchiveService({
    paths: { entriesDir: path.resolve(entriesDir), runtimeDir },
  });
}

function hostTitle(url) {
  try { return new URL(url).hostname; } catch (_) { return "untitled"; }
}

function archiveFallback(id) {
  return { id: String(id), state: "queued", attempt: 0, nextRunAt: null, lastError: null };
}

function createCaptureService(deps) {
  deps = deps || {};
  const fetcher = deps.fetcher || defaultFetcher;
  const store = deps.store || defaultStore;
  const guessSource = deps.guessSource || defaultGuessSource;
  // Injected stores in unit tests intentionally run without a real archive.
  const archive = deps.archive === undefined
    ? (deps.store ? null : createDefaultArchive())
    : deps.archive;
  const singleLine = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

  async function addUrl(value, input) {
    input = input || {};
    const url = String(value || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      const error = new Error("请输入有效的 http(s) 链接");
      error.statusCode = 400;
      throw error;
    }
    let validationWarning = "";
    try { await fetcher.assertPublicUrl(url); }
    catch (cause) {
      if (input.allowUnresolved && !/private|localhost|内网|本地/i.test(String(cause.message || ""))) {
        validationWarning = "URL 暂时无法解析，已保存并交给归档重试";
      } else {
        cause.statusCode = 422;
        throw cause;
      }
    }

    // Save URL and caller-provided metadata before any external content fetch.
    const name = singleLine(input.name || input.title || hostTitle(url), 200);
    const category = singleLine(input.category || input.cat || "其他", 60).replace(/^#+\s*/, "") || "其他";
    const author = singleLine(input.author, 120);
    const desc = singleLine(input.desc, 500);
    const image = singleLine(input.image, 1000);
    const tags = singleLine(input.tags, 300);
    const whySaved = singleLine(input.whySaved, 300);
    const site = singleLine(input.site || guessSource(url), 120);
    const difficulty = Math.min(3, Math.max(1, parseInt(input.difficulty, 10) || 1));

    const result = await store.mutate(text => {
      const duplicate = !input.allowDuplicate && store.findDuplicateUrl(text, url);
      if (duplicate) {
        return {
          write: false,
          result: {
            ok: true,
            duplicate: true,
            id: duplicate.id,
            uid: duplicate.uid || "",
            title: duplicate.title,
            category,
            fetched: false,
            warning: validationWarning,
          },
        };
      }

      const id = store.nextIdIn(text, category);
      const snippet = store.buildSnippet({ id, name, url, author, desc, difficulty, image, site, tags, whySaved });
      return {
        text: store.insertSnippet(text, category, snippet),
        result: {
          ok: true,
          duplicate: false,
          id,
          title: name,
          category,
          author,
          fetched: false,
          warning: validationWarning,
          snippet,
        },
      };
    });

    // Keep explicitly injected legacy fetchers compatible, but only after the
    // durable save. The production path delegates enrichment to RA-1.
    if (!result.duplicate && !input.name && deps.fetcher && typeof fetcher.fetchMeta === "function") {
      try {
        const meta = await fetcher.fetchMeta(url, input.stage || "入库");
        if (meta && meta.title) {
          result.title = singleLine(meta.title, 200);
          if (result.snippet) {
            await store.mutate(text => ({
              text: text.replace(result.snippet, result.snippet.replace(hostTitle(url), result.title)),
              result: true,
            }));
          }
        }
      } catch (_) {}
    }

    if (result.duplicate) {
      result.archive = archive && archive.getStatus
        ? (archive.getStatus(result.id) || archiveFallback(result.id))
        : null;
      return result;
    }

    let uid = result.uid || "";
    if (!uid && typeof store.readAll === "function") {
      try {
        const entry = schema.findEntry(store.readAll(), result.id);
        uid = entry && entry.uid || "";
      } catch (_) {}
    }
    if (archive && typeof archive.enqueue === "function") {
      try {
        result.archive = archive.enqueue({
          id: result.id,
          uid: uid || result.id,
          url,
          title: name,
          author,
          summary: desc,
          desc,
          site,
          cover: image,
          source: input.source || input.stage || "capture",
          tags,
        });
      } catch (_) {
        // The saved entry remains durable if the archive queue is unavailable.
        result.archive = { id: result.id, state: "failed", error: "archive enqueue failed" };
        result.warning = "saved, but archive enqueue failed";
      }
    }
    return result;
  }

  async function archiveContent(id, content) {
    if (!archive || typeof archive.archiveContent !== "function") {
      const error = new Error("archive service unavailable");
      error.statusCode = 503;
      throw error;
    }
    queueExistingArchive(id, "manual");
    return archive.archiveContent(id, content);
  }

  function queueExistingArchive(id, source) {
    if (!archive || typeof archive.enqueue !== "function") {
      const error = new Error("archive service unavailable");
      error.statusCode = 503;
      throw error;
    }
    if (typeof archive.getStatus === "function" && archive.getStatus(id)) return archive.getStatus(id);
    const existing = typeof store.readAll === "function" ? schema.findEntry(store.readAll(), id) : null;
    if (!existing || !existing.url) {
      const error = new Error("unknown archive task: " + id);
      error.statusCode = 404;
      throw error;
    }
    return archive.enqueue({
      id: existing.id,
      uid: existing.uid || existing.id,
      url: existing.url,
      title: existing.title,
      source: source || "manual",
    });
  }

  return {
    addUrl,
    archive,
    start: () => archive && archive.queue && archive.queue.start && archive.queue.start(),
    stop: () => archive && archive.stop && archive.stop(),
    getArchiveStatus: id => archive && archive.getStatus ? archive.getStatus(id) : null,
    queueArchive: queueExistingArchive,
    retryArchive: id => archive && archive.retry ? archive.retry(id) : null,
    archiveContent,
  };
}

const service = createCaptureService();
module.exports = Object.assign({ createCaptureService }, service);
