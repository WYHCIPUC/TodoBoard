"use strict";

const assert = require("assert");
const { createRateLimiter, positiveInteger } = require("./ratelimit");

assert.strictEqual(positiveInteger("12", 3), 12);
assert.strictEqual(positiveInteger("bad", 3), 3);

let now = 1000;
const limiter = createRateLimiter({ limit: 2, windowMs: 5000, now: () => now });
assert.deepStrictEqual(limiter.check("a"), { allowed: true, limit: 2, remaining: 1, retryAfter: 5 });
assert.strictEqual(limiter.check("a").allowed, true);
assert.strictEqual(limiter.check("a").allowed, false);
assert.strictEqual(limiter.check("b").allowed, true, "不同客户端应使用独立配额");
now += 5000;
assert.strictEqual(limiter.check("a").allowed, true, "窗口结束后应重置");

console.log("ratelimit: ALL PASS");
