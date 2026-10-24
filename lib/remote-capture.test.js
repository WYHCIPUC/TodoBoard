"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createRemoteCapture, SOURCE_MAX } = require("./remote-capture");

(async () => {
  const calls = [];
  const capture = {
    async addUrl(url, options) {
      calls.push({ url, options });
      return { ok: true, duplicate: false, id: "1.1" };
    },
  };
  const remote = createRemoteCapture(capture);
  const saved = await remote("  https://example.com/item  ", " 企业微信 ");
  assert.strictEqual(saved.ok, true);
  assert.deepStrictEqual(calls[0], { url: "https://example.com/item", options: { stage: "企业微信" } });
  await remote("https://example.com/two");
  assert.deepStrictEqual(calls[1].options, { stage: "远程入口" });
  await remote("https://example.com/three", "x".repeat(80));
  assert.strictEqual(calls[2].options.stage.length, SOURCE_MAX);
  await assert.rejects(() => remote("javascript:alert(1)", "钉钉"), error => error.statusCode === 400);
  await assert.rejects(() => remote("", "钉钉"), error => error.statusCode === 400);
  assert.throws(() => createRemoteCapture(null), /capture\.addUrl/);

  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(serverSource.includes('remoteCapture(url, "企业微信")'), "企业微信入口必须复用统一远程采集契约");
  assert.ok(serverSource.includes('remoteCapture(url, "钉钉")'), "钉钉入口必须复用统一远程采集契约");
  assert.ok(serverSource.includes('remoteLimiter.check("dingtalk")'), "钉钉 Stream 必须限流");
  assert.ok(serverSource.includes('"/api/wecom/callback"'), "企业微信回调必须受抓取类限流约束");
  assert.ok(serverSource.includes("remoteCapture(url, \"企业微信\")") && !serverSource.includes('stage: "企业微信"'), "远程入口不得绕过统一契约直接写字段");

  console.log("remote-capture: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
