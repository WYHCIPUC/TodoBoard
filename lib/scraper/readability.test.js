"use strict";
const assert = require("assert");
const { extract } = require("./readability");

(async () => {
  // 测试真实网页
  const r = await extract("https://www.eyedex.org/");
  console.log("状态:", r.ok ? "OK" : "FAIL");
  console.log("title:", r.title);
  console.log("content 长度:", r.content.length);
  console.log("content 前100字符:", r.content.slice(0, 100));
  console.log("warning:", r.warning || "(无)");

  // 断言:要么成功有内容,要么失败有 warning
  if (r.ok) {
    assert.ok(r.content.length > 50, "成功时 content 应非空");
  } else {
    assert.ok(r.warning.length > 0, "失败时应有 warning");
  }
  console.log("\nreadability: ALL PASS");
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
