"use strict";

const path = require("path");
const net = require("net");
const defaultFetcher = require("./fetcher");
const defaultStore = require("./store");
const schema = require("./schema");
const { isPrivateIP } = require("./safeurl");
const { guessSource: defaultGuessSource } = require("./classifier");
const { createArchiveService } = require("./archive");
const { defaultCoordinator } = require("./maintenance");

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

function assertPublicLookingUrl(url) {
  let parsed;
  try { parsed = new URL(url); }
  catch (_) {
    const error = new Error("请输入有效的 http(s) 链接");
    error.statusCode = 400;
    throw error;
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    const error = new Error("请输入有效的 http(s) 链接");
    error.statusCode = 400;
    throw error;
  }
  if (parsed.username || parsed.password) {
    const error = new Error("链接不能包含用户名或密码");
    error.statusCode = 400;
    throw error;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const address = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (hostname === "localhost" || hostname.endsWith(".localhost")
    || hostname === "local" || hostname.endsWith(".local")
    || (net.isIP(address) && isPrivateIP(address))) {
    const error = new Error("出于安全考虑，禁止抓取本地/内网地址");
    error.statusCode = 422;
    throw error;
  }
}

function createCaptureService(deps) {
  deps = deps || {};
  const fetcher = deps.fetcher || defaultFetcher;
  const store = deps.store || defaultStore;
  const guessSource = deps.guessSource || defaultGuessSource;
  const coordinator = deps.coordinator || defaultCoordinator;
  // Injected stores in unit tests intentionally run without a real archive.
  const archive = deps.archive === undefined
    ? (deps.store ? null : createDefaultArchive())
    : deps.archive;
  const singleLine = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

  async function addUrlWithLease(value, input, leaseToken) {
    input = input || {};
    const url = String(value || "").trim();
    assertPublicLookingUrl(url);
    const validationWarning = "";

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
    }, { leaseToken, coordinator, action: "capture.save" });

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
            }), { leaseToken, coordinator, action: "capture.enrich" });
          }
        }
      } catch (_) {}
    }

    if (result.duplicate) {
      const archiveStatus = archive && typeof archive.getStatus === "function"
        ? archive.getStatus(result.id)
        : null;
      if (archiveStatus) {
        result.archive = archiveStatus;
      } else if (archive && typeof archive.enqueue === "function") {
        try {
          result.archive = archive.enqueue({
            id: result.id,
            uid: result.uid || result.id,
            url,
            title: result.title,
            source: input.source || input.stage || "capture",
          }, { leaseToken, coordinator });
        } catch (_) {
          result.archive = { id: result.id, state: "failed", error: "archive enqueue failed" };
          result.warning = "saved, but archive enqueue failed";
        }
      } else {
        result.archive = null;
      }
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
        }, { leaseToken, coordinator });
      } catch (_) {
        // The saved entry remains durable if the archive queue is unavailable.
        result.archive = { id: result.id, state: "failed", error: "archive enqueue failed" };
        result.warning = "saved, but archive enqueue failed";
      }
    }
    return result;
  }

  async function addUrl(value, input) {
    const lease = coordinator.acquireMutation(input && input.leaseToken);
    try {
      return await addUrlWithLease(value, input, lease);
    } finally {
      coordinator.releaseMutation(lease);
    }
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
