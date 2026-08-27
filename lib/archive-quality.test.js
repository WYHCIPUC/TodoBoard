"use strict";
const assert = require("assert");
const quality = require("./archive-quality");

const body = "这是足够长的正文内容，用于验证归档质量比较不会因为可选图片或原始页面缺失而覆盖更好的本地正文。";
assert.strictEqual(quality.normalizeContent(`# 标题\r\n\r\n> 来源: x\r\n\r\n> 作者: y\r\n\r\n${body}`, "标题"), body);
assert.strictEqual(quality.codePointLength("a😀"), 2);
assert.strictEqual(quality.codePointLength(), 0);
assert.strictEqual(quality.normalizeContent(), "");
assert.strictEqual(quality.normalizeContent("# other\n\nbody", "title"), "# other body");
assert.strictEqual(quality.validateAuthority("official_api"), "official_api");
assert.throws(() => quality.validateAuthority("legacy_unknown"), error => error.code === "invalid_authority");
assert.strictEqual(quality.assessCandidate({ content: "短文", title: "", authority: "manual", captureState: "manual" }).state, "usable_clean");
assert.strictEqual(quality.assessCandidate({ content: "", title: "", authority: "manual" }).state, "unusable");
assert.strictEqual(quality.assessCandidate({ content: "短文", title: "", authority: "readability" }).state, "unusable");
assert.strictEqual(quality.assessCandidate({ content: body, title: "", authority: "official_raw", captureState: "partial" }).state, "usable_partial");
assert.strictEqual(quality.assessCandidate({ content: body, title: "", authority: "official_raw", missingOptional: true }).state, "usable_partial");
assert.strictEqual(quality.assessCandidate({ content: body, title: "", authority: "official_raw", captureState: "failed" }).state, "unusable");
assert.strictEqual(quality.assessCandidate({ content: quality.EMPTY_CONTENT, title: "", authority: "manual" }).state, "unusable");
assert.throws(() => quality.assessCandidate({ content: body, authority: "guessed" }), error => error.code === "invalid_authority");

const current = { state: "usable_clean", authority: "site_scraper", normalizedChars: 100, manual: false };
assert.strictEqual(quality.compareCandidate({ state: "usable_clean", authority: "site_scraper", normalizedChars: 60, manual: false }, current).accepted, true, "恰好 60% 允许");
assert.strictEqual(quality.compareCandidate({ state: "usable_clean", authority: "site_scraper", normalizedChars: 59, manual: false }, current).accepted, false);
assert.strictEqual(quality.compareCandidate({ state: "usable_partial", authority: "official_raw", normalizedChars: 100, manual: false }, current).accepted, false);
assert.strictEqual(quality.compareCandidate({ state: "usable_clean", authority: "readability", normalizedChars: 100, manual: false }, current).accepted, false);
assert.strictEqual(quality.compareCandidate({ state: "usable_clean", authority: "manual", normalizedChars: 1, manual: true }, current).accepted, true);
assert.strictEqual(quality.compareCandidate({ state: "usable_clean", authority: "official_raw", normalizedChars: 100, manual: false }, { ...current, manual: true, authority: "manual" }).accepted, false);
assert.strictEqual(quality.compareCandidate({ state: "usable_clean", authority: "official_raw", normalizedChars: 100, manual: false }, { ...current, authority: "legacy_unknown" }).accepted, false);
assert.strictEqual(quality.compareCandidate({ content: body, authority: "official_raw" }, null).accepted, true);
assert.strictEqual(quality.compareCandidate({ content: "short", authority: "readability" }, null).reasonCode, "candidate_unusable");
assert.strictEqual(quality.compareCandidate({ state: "usable_clean", authority: "manual", normalizedChars: 1, manual: true }, { ...current, normalizedChars: 0 }).ratio, null);
assert.strictEqual(quality.compareCandidate({ state: "usable_clean", authority: "site_scraper", normalizedChars: 1, manual: false }, { ...current, normalizedChars: 0 }).ratio, 1);

console.log("archive-quality: ALL PASS");
