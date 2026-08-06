"use strict";
const assert = require("assert");
const github = require("./github");

(async () => {
  // 真实抓取测试(roboflow/supervision,项目里已有这个条目)
  const r = await github.scrape("roboflow/supervision");
  console.log("状态:", r.ok ? "OK" : "FAIL");
  console.log("title:", r.title);
  console.log("content 前80字符:", r.content.slice(0, 80));
  console.log("warning:", r.warning || "(无)");

  // 断言:要么成功有内容,要么失败有 warning(网络问题不阻断)
  if (r.ok) {
    assert.ok(r.content.length > 50, "成功时 content 应非空");
    assert.ok(r.source.includes("GitHub"), "source 应含 GitHub");
  } else {
    assert.ok(r.warning && r.warning.length > 0, "失败时应有 warning");
  }

  // 不存在的仓库应优雅失败
  const r2 = await github.scrape("thisuser/no-such-repo-xyz123");
  assert.strictEqual(r2.ok, false);
  assert.ok(r2.warning.length > 0);
  console.log("\n不存在仓库降级 OK:", r2.warning.slice(0, 50));

  console.log("\ngithub scraper: ALL PASS");
})().catch(e => { console.error("TEST ERROR:", e.message); process.exit(1); });
