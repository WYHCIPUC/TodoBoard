"use strict";
const assert = require("assert");
const { parseUrl } = require("./fetcher");

assert.deepStrictEqual(parseUrl("https://www.bilibili.com/video/BV1bcNZ6xEK3/"), { kind: "bilibili", bvid: "BV1bcNZ6xEK3" });
assert.deepStrictEqual(parseUrl("https://github.com/roboflow/supervision"), { kind: "github", repo: "roboflow/supervision" });
assert.deepStrictEqual(parseUrl("https://github.com/roboflow/supervision.git"), { kind: "github", repo: "roboflow/supervision" });
assert.deepStrictEqual(parseUrl("https://example.com/page"), { kind: "web" });
assert.strictEqual(typeof require("./fetcher").fetchMeta, "function");

console.log("fetcher: ALL PASS");
