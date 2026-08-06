"use strict";
const assert = require("assert");
const dingtalk = require("./dingtalk");

assert.strictEqual(
  dingtalk.extractUrl("看看这个 https://github.com/mozilla/readability"),
  "https://github.com/mozilla/readability"
);
assert.strictEqual(
  dingtalk.extractUrl("链接：https://example.com/path?a=1&b=2，稍后研究"),
  "https://example.com/path?a=1&b=2"
);
assert.strictEqual(dingtalk.extractUrl("没有链接"), "");
assert.strictEqual(dingtalk.extractUrl("javascript:alert(1)"), "");
assert.strictEqual(dingtalk.extractUrl(""), "");

console.log("dingtalk: ALL PASS");
