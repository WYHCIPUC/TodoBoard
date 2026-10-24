"use strict";
const assert = require("assert");
const { EventEmitter } = require("events");
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

function fakeRequest(mode, state) {
  return (options, callback) => {
    const req = new EventEmitter();
    req.destroy = () => { state.destroyed = true; };
    req.write = () => {};
    req.end = () => {
      if (mode === "success" || mode === "large") {
        const res = new EventEmitter();
        res.statusCode = 200;
        callback(res);
        process.nextTick(() => {
          res.emit("data", Buffer.from(mode === "large" ? "x".repeat(64) : "ok"));
          if (mode === "success") res.emit("end");
        });
      } else if (mode === "timeout") {
        process.nextTick(() => req.emit("timeout"));
      } else if (mode === "error") {
        process.nextTick(() => req.emit("error", new Error("boom")));
      }
    };
    state.request = req;
    return req;
  };
}

(async () => {
  const successState = {};
  const success = dingtalk.createReply({ request: fakeRequest("success", successState), timeoutMs: 50 });
  assert.strictEqual(await success("https://example.com/hook", "hello"), true);

  const timeoutState = {};
  const timeout = dingtalk.createReply({ request: fakeRequest("timeout", timeoutState), timeoutMs: 5 });
  assert.strictEqual(await timeout("https://example.com/hook", "hello"), false);
  assert.strictEqual(timeoutState.destroyed, true, "超时必须销毁请求");

  const errorState = {};
  const failed = dingtalk.createReply({ request: fakeRequest("error", errorState), timeoutMs: 50 });
  assert.strictEqual(await failed("https://example.com/hook", "hello"), false);

  const largeState = {};
  const large = dingtalk.createReply({ request: fakeRequest("large", largeState), timeoutMs: 50, maxBodyBytes: 8 });
  assert.strictEqual(await large("https://example.com/hook", "hello"), false, "超过响应上限必须失败");
  assert.strictEqual(largeState.destroyed, true);

  const invalid = dingtalk.createReply({ request: fakeRequest("success", {}), timeoutMs: 50 });
  assert.strictEqual(await invalid("not-a-url", "hello"), false);
  assert.strictEqual(await invalid("", "hello"), false);
  assert.ok(dingtalk.REPLY_TIMEOUT_MS >= 1000);
  assert.ok(dingtalk.REPLY_MAX_BYTES > 0);

  console.log("dingtalk: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
