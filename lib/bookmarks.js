"use strict";

const cheerio = require("cheerio");
const defaultStore = require("./store");
const defaultSchema = require("./schema");
const defaultCapture = require("./capture");

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_BOOKMARKS = 1000;

function singleLine(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function folderPathFor($, anchor) {
  const folders = [];
  $(anchor).parents("dl").each((_, list) => {
    const folder = singleLine($(list).parent("dt").children("h3").first().text(), 40);
    if (folder) folders.unshift(folder);
  });
  return [...new Set(folders)].slice(-5);
}

function parseBookmarks(html, options) {
  options = options || {};
  html = String(html || "");
  if (Buffer.byteLength(html) > (options.maxBytes || MAX_HTML_BYTES)) {
    const error = new Error("书签 HTML 超过 5MB 限制");
    error.statusCode = 413;
    throw error;
  }

  const maxBookmarks = options.maxBookmarks || MAX_BOOKMARKS;
  const $ = cheerio.load(html);
  const anchors = $("a[href]").toArray();
  const seen = new Set();
  const items = [];
  let invalid = 0;
  let repeated = 0;

  for (const anchor of anchors) {
    const rawUrl = singleLine($(anchor).attr("href"), 2000);
    if (!/^https?:\/\//i.test(rawUrl)) { invalid++; continue; }
    let normalized;
    let fallbackTitle;
    try {
      const parsed = new URL(rawUrl);
      normalized = parsed.toString();
      fallbackTitle = parsed.hostname;
    } catch (_) {
      invalid++;
      continue;
    }
    const dedupeKey = normalized.replace(/\/$/, "");
    if (seen.has(dedupeKey)) { repeated++; continue; }
    seen.add(dedupeKey);
    if (items.length >= maxBookmarks) continue;

    const folders = folderPathFor($, anchor);
    const sourceTags = singleLine($(anchor).attr("tags"), 240)
      .split(/[,，]/).map(value => singleLine(value, 40)).filter(Boolean);
    const tags = [...new Set(["浏览器书签"].concat(folders, sourceTags))].join(", ").slice(0, 300);
    items.push({
      url: normalized,
      name: singleLine($(anchor).text(), 200) || fallbackTitle || "未命名书签",
      tags,
      folder: folders.join(" / "),
      site: fallbackTitle || "浏览器书签",
    });
  }

  return {
    items,
    totalAnchors: anchors.length,
    invalid,
    repeated,
    truncated: seen.size > maxBookmarks,
  };
}

function createBookmarkService(deps) {
  deps = deps || {};
  const store = deps.store || defaultStore;
  const schema = deps.schema || defaultSchema;
  // Production uses the same save-first adapter as every other URL entry.
  // The injected-store fallback keeps the old pure batch unit tests isolated.
  const capture = deps.capture === undefined
    ? (deps.store ? null : defaultCapture)
    : deps.capture;

  function analyze(html, dataText) {
    const parsed = parseBookmarks(html);
    const existingUrls = new Set(schema.scanEntries(dataText).map(entry => schema.normalizeUrl(entry.url)).filter(Boolean));
    const importable = parsed.items.filter(item => !existingUrls.has(schema.normalizeUrl(item.url)));
    return {
      parsed,
      importable,
      duplicateCount: parsed.items.length - importable.length,
      summary: {
        found: parsed.items.length,
        importable: importable.length,
        duplicates: parsed.items.length - importable.length,
        invalid: parsed.invalid,
        repeated: parsed.repeated,
        truncated: parsed.truncated,
        samples: importable.slice(0, 5).map(item => ({
          name: item.name,
          url: item.url,
          folder: item.folder,
        })),
      },
    };
  }

  function preview(html) {
    return analyze(html, store.readAll()).summary;
  }

  async function importHtml(html) {
    if (capture && typeof capture.addUrl === "function") {
      const analysis = analyze(html, store.readAll());
      const saved = [];
      for (const item of analysis.importable) {
        saved.push(await capture.addUrl(item.url, {
          name: item.name,
          category: "收件箱",
          site: item.site,
          tags: item.tags,
          whySaved: "从浏览器书签导入",
          source: "bookmarks",
          allowUnresolved: true,
        }));
      }
      const imported = saved.filter(item => !item.duplicate).length;
      return Object.assign({
        ok: true,
        imported,
        entries: saved,
      }, analysis.summary, imported ? {
        firstId: saved.find(item => !item.duplicate)?.id || "",
        lastId: [...saved].reverse().find(item => !item.duplicate)?.id || "",
      } : {});
    }

    return store.mutate(text => {
      const result = analyze(html, text);
      if (!result.importable.length) {
        return { write: false, result: Object.assign({ ok: true, imported: 0 }, result.summary) };
      }

      const firstId = store.nextIdIn(text, "收件箱");
      const parts = firstId.split(".").map(Number);
      const snippets = result.importable.map((item, index) => store.buildSnippet({
        id: parts[0] + "." + (parts[1] + index),
        name: item.name,
        url: item.url,
        difficulty: 1,
        site: item.site,
        tags: item.tags,
        whySaved: "从浏览器书签导入",
      }));
      const updated = store.insertSnippet(text, "收件箱", snippets.join("\n\n"));
      return {
        text: updated,
        result: Object.assign({
          ok: true,
          imported: result.importable.length,
          firstId,
          lastId: parts[0] + "." + (parts[1] + result.importable.length - 1),
        }, result.summary),
      };
    });
  }

  return { analyze, preview, importHtml };
}

const service = createBookmarkService();
module.exports = {
  MAX_BOOKMARKS,
  MAX_HTML_BYTES,
  createBookmarkService,
  parseBookmarks,
  preview: service.preview,
  importHtml: service.importHtml,
};
