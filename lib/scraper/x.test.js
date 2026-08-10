"use strict";

const assert = require("assert");
const x = require("./x");
const { parseHTML } = require("linkedom");
const { normalizeResult, SCRAPER_RESULT_FIELDS, scrapeContent } = require("./index");
const readability = require("./readability");

(async () => {
  assert.deepStrictEqual(x.parseStatusUrl("https://twitter.com/alice/status/123?ref=share"), {
    id: "123", username: "alice", canonicalUrl: "https://x.com/alice/status/123",
  });
  assert.deepStrictEqual(x.parseStatusUrl("https://x.com/i/status/124"), {
    id: "124", username: "", canonicalUrl: "https://x.com/i/status/124",
  });
  assert.strictEqual(x.parseStatusUrl("https://x.com/alice/likes/123"), null);
  assert.strictEqual(x.parseStatusUrl("https://example.com/alice/status/123"), null);

  const secret = ["session", "secret", "should", "not", "escape"].join("-");
  process.env.X_COOKIE = secret;
  const pageCalls = [];
  x.setHttpGet(async (url, timeout, headers) => {
    pageCalls.push({ url, timeout, headers });
    if (url === "https://x.com/alice/status/123") return {
      status: 200,
      body: `<html><head><meta property="og:title" content="Alice on X"><meta property="og:description" content="A static tweet"><meta property="og:image" content="https://img.example/cover.jpg"></head><body><script type="application/json">${JSON.stringify({ tweet_results: { result: { legacy: { full_text: "Hydrated tweet text", id_str: "123", created_at: "today", entities: { media: [{ media_url_https: "https://img.example/tweet.jpg" }] } }, core: { user_results: { result: { legacy: { screen_name: "alice", name: "Alice" } } } } } } })}</script><!-- ${secret} --></body></html>`,
    };
    throw new Error("fallback should not run");
  });
  const staticResult = await x.scrape("https://x.com/alice/status/123");
  assert.strictEqual(staticResult.status, "succeeded");
  assert.strictEqual(staticResult.markdown, "Hydrated tweet text");
  assert.strictEqual(staticResult.metadata.canonicalUrl, "https://x.com/alice/status/123");
  assert.ok(staticResult.imageCandidates.includes("https://img.example/tweet.jpg"));
  assert.ok(pageCalls[0].headers.Cookie === secret);
  assert.ok(!JSON.stringify(staticResult).includes(secret));
  assert.deepStrictEqual(SCRAPER_RESULT_FIELDS, ["url", "metadata", "markdown", "imageCandidates", "rawHtml", "status", "reasons"]);
  const routed = await scrapeContent("https://x.com/alice/status/123");
  assert.strictEqual(routed.status, "succeeded");
  assert.strictEqual(normalizeResult({ ok: false, content: "partial text", warning: "degraded" }, "https://example.com" ).status, "partial");

  x.setHttpGet(async (url, timeout, headers) => {
    if (url === "https://x.com/bob/status/456") return { status: 429, body: "" };
    assert.strictEqual(headers.Cookie, undefined, "fallback hosts must not receive X_COOKIE");
    if (url.startsWith("https://cdn.syndication.twimg.com/")) return { status: 200, body: JSON.stringify({ text: "Syndicated text", user: { screen_name: "bob", name: "Bob" }, id_str: "456" }) };
    throw new Error("oEmbed should not run after syndication");
  });
  const syndicated = await x.scrape("https://x.com/bob/status/456");
  assert.strictEqual(syndicated.status, "succeeded");
  assert.strictEqual(syndicated.metadata.author, "@bob");
  assert.ok(syndicated.reasons.some(reason => reason.includes("syndication")));

  x.setHttpGet(async (url) => {
    if (url === "https://x.com/removed/status/789") return { status: 403, body: "" };
    return { status: 429, body: "" };
  });
  const unavailable = await x.scrape("https://x.com/removed/status/789");
  assert.strictEqual(unavailable.status, "manual_required");
  assert.strictEqual(unavailable.metadata.canonicalUrl, "https://x.com/removed/status/789");
  assert.strictEqual(unavailable.metadata.tweetId, "789");
  assert.ok(!JSON.stringify(unavailable).includes(secret));

  x.setHttpGet(async url => {
    if (url === "https://x.com/embed/status/999") throw new Error("connection timeout");
    if (url.startsWith("https://cdn.syndication.twimg.com/")) return { status: 503, body: "" };
    if (url.startsWith("https://publish.twitter.com/oembed")) return { status: 200, body: JSON.stringify({ author_name: "embed", html: "<blockquote>oEmbed text</blockquote>" }) };
    return { status: 404, body: "" };
  });
  const embedded = await x.scrape("https://x.com/embed/status/999");
  assert.strictEqual(embedded.status, "succeeded");
  assert.strictEqual(embedded.markdown, "oEmbed text");
  assert.ok(embedded.reasons.some(reason => reason.includes("oEmbed")));

  readability.setHttpGet(async () => ({ status: 200, body: "<html><head><title>Web</title></head><body><article><p>Web content</p></article></body></html>" }));
  const web = await scrapeContent("https://example.com/web");
  assert.strictEqual(web.status, "succeeded");
  assert.ok(web.markdown.includes("Web content"));

  const invalid = await x.scrape("https://x.com/home");
  assert.strictEqual(invalid.status, "manual_required");

  const meta = x._internals.metaFromDocument(parseHTML(
    '<html><head><title>fallback title</title><link rel="canonical" href="https://x.com/canonical/status/1"><meta name="twitter:title" content="Twitter title"><meta name="twitter:description" content="Twitter description"><meta name="twitter:image" content="https://img.example/twitter.jpg"><meta name="twitter:image:src" content="https://img.example/src.jpg"></head></html>',
  ).document, "https://x.com/input/status/1");
  assert.deepStrictEqual(meta, {
    title: "Twitter title",
    description: "Twitter description",
    author: "",
    canonicalUrl: "https://x.com/canonical/status/1",
    imageCandidates: ["https://img.example/twitter.jpg", "https://img.example/src.jpg"],
  });

  const metaFallback = x._internals.metaFromDocument(parseHTML(
    '<html><head><title>document title</title><meta name="description" content="plain description"></head></html>',
  ).document, "https://x.com/input/status/2");
  assert.strictEqual(metaFallback.title, "document title");
  assert.strictEqual(metaFallback.description, "plain description");
  assert.strictEqual(metaFallback.canonicalUrl, "https://x.com/input/status/2");

  const noTweet = x._internals.hydrationFromDocument(parseHTML(
    "<html><body><script></script><script>status but not json</script><script>{\"other\":true}</script></body></html>",
  ).document);
  assert.deepStrictEqual(noTweet, { markdown: "", metadata: {}, imageCandidates: [] });

  const arrayHydrated = x._internals.hydrationFromDocument(parseHTML(`<html><body><script>${JSON.stringify([{
    legacy: { text: "array tweet", id: "12", entities: {}, extended_entities: { media: [{ media_url: "https://img.example/array.gif" }] } },
    user: { name: "Array User" },
  }])}</script></body></html>`).document);
  assert.strictEqual(arrayHydrated.markdown, "array tweet");
  assert.strictEqual(arrayHydrated.metadata.author, "");
  assert.strictEqual(arrayHydrated.metadata.authorName, "Array User");
  assert.strictEqual(arrayHydrated.metadata.tweetId, "12");
  assert.deepStrictEqual(arrayHydrated.imageCandidates, ["https://img.example/array.gif"]);

  const hydrated = x._internals.hydrationFromDocument(parseHTML(`<html><body>
    <script>not JSON</script><script>{"wrapper":[{"legacy":{"text":"text tweet","entities":{"media":[{"media_url":"https://img.example/one.jpg"}]}},"user_results":{"result":{"legacy":{"screen_name":"fallback","name":"Fallback"}}}}]}</script>
  </body></html>`).document);
  assert.strictEqual(hydrated.markdown, "text tweet");
  assert.strictEqual(hydrated.metadata.author, "@fallback");
  assert.strictEqual(hydrated.metadata.authorName, "Fallback");
  assert.deepStrictEqual(hydrated.imageCandidates, ["https://img.example/one.jpg"]);

  const hydratedMedia = x._internals.hydrationFromDocument(parseHTML(`<html><body><script type="application/json">${JSON.stringify({
    legacy: { full_text: "media tweet", id_str: "10", created_at: "yesterday", extended_entities: { media: [{ media_url_https: "https://img.example/two.webp" }] } },
    user: { screen_name: "media-user", name: "Media User" },
  })}</script></body></html>`).document);
  assert.strictEqual(hydratedMedia.metadata.author, "@media-user");
  assert.deepStrictEqual(hydratedMedia.imageCandidates, ["https://img.example/two.webp"]);

  assert.deepStrictEqual(x._internals.fromSyndication({ full_text: "full fallback", id: "11", user: { name: "Name only" }, media_details: [{ media_url: "https://img.example/three.jpg" }] }), {
    markdown: "full fallback",
    metadata: { author: "Name only", authorName: "Name only", publishedAt: "", tweetId: "11" },
    imageCandidates: ["https://img.example/three.jpg"],
  });
  assert.deepStrictEqual(x._internals.fromSyndication({ text: "details", user: {}, mediaDetails: [{ media_url_https: "https://img.example/four.jpg" }] }).imageCandidates, ["https://img.example/four.jpg"]);
  assert.strictEqual(x._internals.fromSyndication(null), null);
  assert.strictEqual(x.parseStatusUrl("not a url"), null);

  delete process.env.X_COOKIE;
  x.setHttpGet(async url => {
    if (url === "https://x.com/no-fallback/status/100") return { status: 200, body: "" };
    if (url.startsWith("https://cdn.syndication.twimg.com/")) return { status: 200, body: "not-json" };
    if (url.startsWith("https://publish.twitter.com/oembed")) return { status: 200, body: "not-json" };
    return { status: 404, body: "" };
  });
  const noFallback = await x.scrape("https://x.com/no-fallback/status/100");
  assert.strictEqual(noFallback.status, "manual_required");
  assert.ok(noFallback.reasons.length > 0);

  x.setHttpGet(async () => { throw new Error("fallback network down"); });
  const fallbackError = await x.scrape("https://x.com/fallback-error/status/101");
  assert.strictEqual(fallbackError.status, "manual_required");
  assert.ok(fallbackError.reasons.some(reason => reason.includes("请求失败")));
  x.setHttpGet(async url => {
    if (url === "https://x.com/static-only/status/102") return { status: 200, body: "<html><head><meta name=\"description\" content=\"static only\"></head></html>" };
    throw new Error("should not use fallback");
  });
  const staticOnly = await x.scrape("https://x.com/static-only/status/102");
  assert.strictEqual(staticOnly.markdown, "static only");

  x.setHttpGet(async url => {
    if (url === "https://x.com/not-found/status/103") return { status: 404, body: "" };
    if (url.startsWith("https://cdn.syndication.twimg.com/")) return { status: 404, body: "" };
    if (url.startsWith("https://publish.twitter.com/oembed")) return { status: 200, body: JSON.stringify({}) };
    throw new Error("unexpected URL");
  });
  const notFound = await x.scrape("https://x.com/not-found/status/103");
  assert.strictEqual(notFound.status, "manual_required");

  x.setHttpGet(async url => {
    if (url === "https://x.com/oembed-body/status/104") return { status: 404, body: "" };
    if (url.startsWith("https://cdn.syndication.twimg.com/")) return { status: 404, body: "" };
    if (url.startsWith("https://publish.twitter.com/oembed")) return { status: 200, body: JSON.stringify({ html: "<div>body text</div>" }) };
    throw new Error("unexpected URL");
  });
  const oembedBody = await x.scrape("https://x.com/oembed-body/status/104");
  assert.strictEqual(oembedBody.status, "succeeded");
  assert.strictEqual(oembedBody.markdown, "body text");

  x.setHttpGet("not a function");

  readability.setHttpGet();
  x.setHttpGet();
  console.log("x scraper: ALL PASS");
})().catch(error => { console.error("TEST ERROR:", error); process.exit(1); });
