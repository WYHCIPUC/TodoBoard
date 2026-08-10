"use strict";

const assert = require("assert");
const readability = require("./readability");

(async () => {
  readability.setHttpGet(async () => ({
    status: 200,
    body: '<html><head><title>Example</title><meta property="og:description" content="Summary"><meta property="og:image" content="/cover.png"></head><body><article><h1>Article</h1><p>This is the main article text.</p></article></body></html>',
  }));
  const full = await readability.extract("https://example.com/article");
  assert.strictEqual(full.status, "succeeded");
  assert.ok(full.markdown.includes("main article text"));
  assert.ok(full.rawHtml.includes("<article>"));
  assert.deepStrictEqual(full.imageCandidates, ["https://example.com/cover.png"]);
  assert.ok(full.metadata.title);

  readability.setHttpGet(async () => ({
    status: 200,
    body: '<html><head><meta name="description" content="Only a summary"><title>Summary page</title></head><body><div id="app"></div></body></html>',
  }));
  const partial = await readability.extract("https://example.com/summary");
  assert.strictEqual(partial.status, "partial");
  assert.ok(partial.markdown.includes("Only a summary"));
  assert.ok(partial.reasons[0].includes("降级"));

  readability.setHttpGet(async () => ({ status: 200, body: "<html><head><title>Login</title></head><body><script>app()</script></body></html>" }));
  const manual = await readability.extract("https://example.com/login");
  assert.strictEqual(manual.status, "manual_required");
  assert.ok(manual.rawHtml.length > 0);

  readability.setHttpGet(async () => { throw new Error("timeout"); });
  const failed = await readability.extract("https://example.com/fail");
  assert.strictEqual(failed.status, "manual_required");
  assert.ok(failed.metadata.url.endsWith("/fail"));

  readability.setHttpGet(async () => ({ status: 503, body: "temporarily unavailable" }));
  const httpFailed = await readability.extract("https://example.com/503");
  assert.strictEqual(httpFailed.status, "manual_required");
  assert.ok(httpFailed.reasons[0].includes("503"));
  readability.setHttpGet();
  console.log("readability: ALL PASS");
})().catch(error => { console.error("TEST ERROR:", error); process.exit(1); });
