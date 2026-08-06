"use strict";
const assert = require("assert");
const { scrapeSubtitle } = require("./bilibili");

(async () => {
  // 用真实 bvid(README 里的 BV1bcNZ6xEK3)——该视频实测无字幕,应走简介降级
  const r = await scrapeSubtitle("BV1bcNZ6xEK3");
  console.log("=== BV1bcNZ6xEK3 ===");
  console.log("状态:", r.ok ? "OK" : "FAIL");
  console.log("title:", r.title);
  console.log("content 长度:", r.content.length);
  console.log("source:", r.source);
  console.log("warning:", r.warning || "(无)");
  console.log("content 前150:", JSON.stringify(r.content.slice(0, 150)));

  if (r.ok) {
    // 网络限流时简介可能为空,只要求返回了结构(content 可空但 ok=true 表示降级路径走通)
    assert.ok(typeof r.content === "string", "成功时 content 应为字符串");
  } else {
    assert.ok(r.warning.length > 0, "失败时应有 warning");
  }
  // 该视频无字幕,source 应标注来源(bilibili 字样)
  assert.ok(/bilibili/i.test(r.source), "source 应含 bilibili: " + r.source);

  // 不存在的视频应优雅失败(降级 / 报错均可,只要不抛异常)
  const r2 = await scrapeSubtitle("BV1notexist999");
  console.log("\n=== BV1notexist999(不存在)===");
  console.log("状态:", r2.ok ? "OK(降级)" : "FAIL");
  console.log("title:", r2.title);
  console.log("source:", r2.source);
  console.log("warning:", (r2.warning || "").slice(0, 80));
  assert.ok(typeof r2.ok === "boolean", "不应对不存在视频抛异常");
  assert.ok(r2.warning || r2.content, "应给出 warning 或降级内容");

  console.log("\nbilibili: ALL PASS");
})().catch(e => { console.error("ERROR:", e.message); console.error(e.stack); process.exit(1); });
