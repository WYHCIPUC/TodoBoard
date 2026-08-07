"use strict";

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function createRateLimiter(options) {
  options = options || {};
  const limit = positiveInteger(options.limit, 300);
  const windowMs = positiveInteger(options.windowMs, 60 * 1000);
  const maxKeys = positiveInteger(options.maxKeys, 1000);
  const now = options.now || Date.now;
  const buckets = new Map();
  let checks = 0;

  function cleanup(current) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= current) buckets.delete(key);
    }
    while (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value);
  }

  function check(key, weight) {
    const current = now();
    const cost = positiveInteger(weight, 1);
    checks++;
    if (checks % 100 === 0 || buckets.size > maxKeys) cleanup(current);

    key = String(key || "unknown");
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + windowMs };
      buckets.set(key, bucket);
    }

    const allowed = bucket.count + cost <= limit;
    if (allowed) bucket.count += cost;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000)),
    };
  }

  return { check };
}

module.exports = { createRateLimiter, positiveInteger };
