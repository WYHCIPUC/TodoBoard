"use strict";

const assert = require("assert");
const github = require("./github");

function json(body, status = 200) { return { status, body: JSON.stringify(body) }; }

(async () => {
  const calls = [];
  github.setHttpGet(async (url, timeout, headers, maxBody) => {
    calls.push({ url, timeout, headers, maxBody });
    if (url.endsWith("/repos/acme/widget")) return json({
      full_name: "acme/widget",
      default_branch: "release",
      description: "A widget",
      language: "JavaScript",
      stargazers_count: 7,
      owner: { login: "acme", avatar_url: "https://avatars.githubusercontent.com/u/1" },
    });
    if (url.includes("/contents?ref=release")) return json([{ name: "docs", type: "dir" }, { name: "ReadMe.MD", path: "docs/ReadMe.MD", type: "file" }]);
    if (url.includes("raw.githubusercontent.com/acme/widget/release/docs/ReadMe.MD")) return { status: 200, body: "# Widget\n\n![logo](./logo.png)" };
    return { status: 404, body: "" };
  });
  const r = await github.scrape("acme/widget");
  assert.strictEqual(r.status, "succeeded");
  assert.strictEqual(r.metadata.defaultBranch, "release");
  assert.strictEqual(r.metadata.readmePath, "docs/ReadMe.MD");
  assert.ok(r.markdown.includes("# Widget"));
  assert.ok(r.imageCandidates.includes("https://raw.githubusercontent.com/acme/widget/release/docs/logo.png"));
  assert.ok(calls.every(call => call.timeout === 10000 && call.maxBody === 2 * 1024 * 1024));

  github.setHttpGet(async url => {
    if (url.endsWith("/repos/acme/limited")) return { status: 429, body: JSON.stringify({ message: "API rate limit exceeded" }) };
    if (url.includes("raw.githubusercontent.com/acme/limited/master/README.MD")) return { status: 200, body: "# Limited\n\nPublic fallback" };
    return { status: 404, body: "" };
  });
  const limited = await github.scrape("acme/limited");
  assert.strictEqual(limited.status, "succeeded");
  assert.strictEqual(limited.metadata.branch, "master");
  assert.ok(limited.reasons.some(reason => reason.includes("429")));

  github.setHttpGet(async url => {
    if (url.endsWith("/repos/acme/empty")) return json({ full_name: "acme/empty", default_branch: "main", owner: { login: "acme" } });
    return { status: 404, body: "" };
  });
  const partial = await github.scrape("acme/empty");
  assert.strictEqual(partial.status, "partial");
  assert.strictEqual(partial.metadata.repository, "acme/empty");
  assert.strictEqual(partial.markdown, "");
  assert.ok(partial.reasons.length > 0);

  github.setHttpGet(async () => { throw new Error("network down"); });
  const offline = await github.scrape("acme/offline");
  assert.strictEqual(offline.status, "manual_required");
  assert.ok(offline.reasons.some(reason => reason.includes("请求失败")));

  github.setHttpGet(async url => {
    if (url.endsWith("/repos/acme/server-error")) return { status: 500, body: "" };
    return { status: 404, body: "" };
  });
  const serverError = await github.scrape("acme/server-error");
  assert.ok(serverError.reasons.some(reason => reason.includes("HTTP 500")));

  const invalid = await github.scrape("not-a-repo");
  assert.strictEqual(invalid.status, "manual_required");
  assert.ok(invalid.metadata.url.includes("github.com"));

  assert.strictEqual(github._internals.safeRepo("acme/widget"), "acme/widget");
  assert.strictEqual(github._internals.safeRepo("bad repo"), "");
  assert.deepStrictEqual(github._internals.readmeImages(
    "![a](data:image/png;base64,abc) ![b](../img/a.png \"title\") <img src='/img/b.webp'> <img src='http://[bad'>",
    "https://raw.githubusercontent.com/acme/widget/main/docs/README.md",
  ), [
    "https://raw.githubusercontent.com/acme/widget/main/img/a.png",
    "https://raw.githubusercontent.com/img/b.webp",
  ]);

  github.setHttpGet(async url => {
    if (url.endsWith("/repos/acme/minimal")) return json({ full_name: "acme/minimal" });
    if (url.includes("/contents?ref=default")) return { status: 200, body: "not-json" };
    return { status: 404, body: "" };
  });
  const minimal = await github.scrape("acme/minimal");
  assert.strictEqual(minimal.status, "partial");
  assert.strictEqual(minimal.metadata.author, "acme");

  github.setHttpGet(async url => {
    if (url.endsWith("/repos/acme/truncated")) return json({ full_name: "acme/truncated", default_branch: "main" });
    if (url.includes("/contents?ref=main")) return { status: 403, body: "" };
    if (url.includes("raw.githubusercontent.com/acme/truncated/main/README.md")) return { status: 200, body: "x".repeat(100 * 1024 + 1) };
    return { status: 404, body: "" };
  });
  const truncated = await github.scrape("acme/truncated");
  assert.strictEqual(truncated.status, "succeeded");
  assert.strictEqual(truncated.markdown.length, 100 * 1024);
  assert.ok(truncated.reasons.some(reason => reason.includes("100 KB")));

  github.setHttpGet(async url => {
    if (url.endsWith("/repos/acme/contents-limited")) return { status: 200, body: JSON.stringify({ full_name: "acme/contents-limited" }) };
    if (url.includes("/contents?ref=")) return { status: 429, body: "" };
    return { status: 404, body: "" };
  });
  const contentsLimited = await github.scrape("acme/contents-limited");
  assert.strictEqual(contentsLimited.status, "partial");
  assert.ok(contentsLimited.reasons.some(reason => reason.includes("contents API") && reason.includes("429")));

  github.setHttpGet(async url => {
    if (url.endsWith("/repos/acme/empty-body")) return { status: 200, body: JSON.stringify({ full_name: "acme/empty-body" }) };
    if (url.includes("/contents?ref=")) return { status: 200, body: JSON.stringify([{ name: "README.md", type: "file", path: "README.md" }]) };
    if (url.includes("raw.githubusercontent.com")) return { status: 200, body: "   " };
    return { status: 404, body: "" };
  });
  assert.strictEqual((await github.scrape("acme/empty-body")).status, "partial");

  github.setHttpGet();
  console.log("github scraper: ALL PASS");
})().catch(error => { console.error("TEST ERROR:", error); process.exit(1); });
