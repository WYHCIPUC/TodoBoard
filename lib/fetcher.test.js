"use strict";

const assert = require("assert");
const crypto = require("crypto");
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
  const binaryPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0xff, 0x80, 0x7f, 0x01, 0x02, 0x03,
  ]);
  let crossOriginHeaders = null;
  const redirectTarget = http.createServer((req, res) => {
    crossOriginHeaders = req.headers;
    res.end("redirected");
  });
  await new Promise(resolve => redirectTarget.listen(0, "127.0.0.1", resolve));
  const redirectPort = redirectTarget.address().port;
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
    if (req.url === "/zip-bomb") {
      const body = zlib.gzipSync(Buffer.alloc(32 * 1024, 65));
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(body);
      return;
    }
    if (req.url === "/binary") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(binaryPng);
      return;
    }
    if (req.url === "/cross-origin") {
      res.writeHead(302, { location: `http://127.0.0.1:${redirectPort}/target` });
      res.end();
      return;
    }
    if (req.url === "/same-origin") {
      res.writeHead(302, { location: "/same-origin-target" });
      res.end();
      return;
    }
    if (req.url === "/same-origin-target") {
      res.end(req.headers.cookie || "missing");
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
    await assert.rejects(fetcher.httpGet(`http://127.0.0.1:${port}/zip-bomb`, 1000, {}, 1024), /解压后超过大小限制/);

    const binary = await fetcher.httpGet(`http://127.0.0.1:${port}/binary`, 1000, {}, 1024);
    assert.ok(Buffer.isBuffer(binary.rawBody));
    assert.strictEqual(binary.contentType, "image/png");
    assert.strictEqual(
      crypto.createHash("sha256").update(binary.rawBody).digest("hex"),
      crypto.createHash("sha256").update(binaryPng).digest("hex"),
    );

    const sensitiveHeaders = {
      Cookie: "session=secret",
      Authorization: "Bearer secret",
      "Proxy-Authorization": "Basic secret",
      "X-Api-Key": "secret",
    };
    const redirected = await fetcher.httpGet(`http://127.0.0.1:${port}/cross-origin`, 1000, sensitiveHeaders, 1024);
    assert.strictEqual(redirected.body, "redirected");
    assert.strictEqual(crossOriginHeaders.cookie, undefined);
    assert.strictEqual(crossOriginHeaders.authorization, undefined);
    assert.strictEqual(crossOriginHeaders["proxy-authorization"], undefined);
    assert.strictEqual(crossOriginHeaders["x-api-key"], undefined);
    const sameOrigin = await fetcher.httpGet(`http://127.0.0.1:${port}/same-origin`, 1000, sensitiveHeaders, 1024);
    assert.strictEqual(sameOrigin.body, "session=secret");

    await assert.rejects(fetcher.httpGet(`http://127.0.0.1:${port}/slow`, 20), /超时/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => redirectTarget.close(resolve));
  }
  console.log("fetcher: ALL PASS");
})().catch(error => { console.error("TEST ERROR:", error); process.exit(1); });
