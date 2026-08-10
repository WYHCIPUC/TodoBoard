"use strict";

const assert = require("assert");
const http = require("http");
const zlib = require("zlib");

process.env.ALLOW_PRIVATE_NETWORK = "1";
const fetcher = require("./fetcher");

assert.deepStrictEqual(fetcher.parseUrl("https://www.bilibili.com/video/BV1bcNZ6xEK3/"), { kind: "bilibili", bvid: "BV1bcNZ6xEK3" });
assert.deepStrictEqual(fetcher.parseUrl("https://github.com/roboflow/supervision"), { kind: "github", repo: "roboflow/supervision" });
assert.deepStrictEqual(fetcher.parseUrl("https://github.com/roboflow/supervision.git"), { kind: "github", repo: "roboflow/supervision" });
assert.deepStrictEqual(fetcher.parseUrl("https://twitter.com/alice/status/123"), { kind: "x", username: "alice", statusId: "123", canonicalUrl: "https://x.com/alice/status/123" });
assert.deepStrictEqual(fetcher.parseUrl("https://example.com/page"), { kind: "web" });
assert.deepStrictEqual(fetcher.parseUrl("https://github.com.evil.example/acme/repo"), { kind: "web" });
assert.strictEqual(typeof fetcher.fetchMeta, "function");

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/gzip") {
      const body = zlib.gzipSync("压缩响应");
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(body);
      return;
    }
    if (req.url === "/large") {
      res.writeHead(200);
      res.end("1234567890");
      return;
    }
    if (req.url === "/slow") {
      setTimeout(() => res.end("late"), 100);
      return;
    }
    res.end("ok");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const compressed = await fetcher.httpGet(`http://127.0.0.1:${port}/gzip`, 1000, {}, 1024);
    assert.strictEqual(compressed.body, "压缩响应");
    await assert.rejects(fetcher.httpGet(`http://127.0.0.1:${port}/large`, 1000, {}, 4), /响应体超过大小限制/);
    await assert.rejects(fetcher.httpGet(`http://127.0.0.1:${port}/slow`, 20), /超时/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log("fetcher: ALL PASS");
})().catch(error => { console.error("TEST ERROR:", error); process.exit(1); });
