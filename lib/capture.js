"use strict";
const defaultFetcher = require("./fetcher");
const defaultStore = require("./store");
const { guessSource: defaultGuessSource } = require("./classifier");

function createCaptureService(deps) {
  deps = deps || {};
  const fetcher = deps.fetcher || defaultFetcher;
  const store = deps.store || defaultStore;
  const guessSource = deps.guessSource || defaultGuessSource;
  const singleLine = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

  async function addUrl(value, input) {
    input = input || {};
    const url = String(value || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      const error = new Error("请填写有效的 http(s) 链接");
      error.statusCode = 400;
      throw error;
    }
    try { await fetcher.assertPublicUrl(url); }
    catch (cause) {
      cause.statusCode = 422;
      throw cause;
    }

    let meta = {};
    try { meta = await fetcher.fetchMeta(url, input.stage || "入库"); }
    catch (error) { meta = { url, error: error.message }; }

    const name = singleLine(input.name || meta.title, 200);
    const category = singleLine(input.category || input.cat || meta.category || "其他", 60).replace(/^#+\s*/, "") || "其他";
    const author = singleLine(input.author || meta.author, 120);
    const desc = singleLine(input.desc || meta.desc, 500);
    const image = singleLine(input.image || meta.image, 1000);
    const tags = singleLine(input.tags, 300);
    const whySaved = singleLine(input.whySaved, 300);
    const site = singleLine(input.site || meta.site || guessSource(url), 120);
    const difficulty = Math.min(3, Math.max(1, parseInt(input.difficulty, 10) || 1));

    if (!name) {
      const error = new Error("未能自动识别标题" + (meta.error ? "（" + meta.error + "）" : "") + "，请手动填写标题");
      error.statusCode = 422;
      throw error;
    }

    return store.mutate(text => {
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
            fetched: !meta.error,
            warning: meta.warning || "",
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
          fetched: !meta.error,
          warning: meta.warning || "",
          snippet,
        },
      };
    });
  }

  return { addUrl };
}

const service = createCaptureService();
module.exports = { createCaptureService, addUrl: service.addUrl };
