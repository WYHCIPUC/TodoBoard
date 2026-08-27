"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");
const wecom = require("./wecom");

function fakeTransport(responses, calls) {
  return {
    request(options, onResponse) {
      const response = responses.shift() || {};
      const call = { options, body: "", requestTimeout: null, responseTimeout: null };
      calls.push(call);
      const req = new EventEmitter();
      let destroyed = false;
      req.setTimeout = (ms, callback) => {
        call.requestTimeout = ms;
        if (response.requestTimeout) process.nextTick(callback);
      };
      req.write = chunk => { call.body += String(chunk); };
      req.destroy = error => {
        if (destroyed) return;
        destroyed = true;
        process.nextTick(() => req.emit("error", error));
      };
      req.end = () => {
        if (response.requestTimeout) return;
        process.nextTick(() => {
          if (response.error) return req.emit("error", response.error);
          const res = new EventEmitter();
          res.statusCode = response.statusCode === undefined ? 200 : response.statusCode;
          res.headers = response.headers || {};
          res.setTimeout = (ms, callback) => {
            call.responseTimeout = ms;
            if (response.responseTimeout) process.nextTick(callback);
          };
          res.destroy = error => process.nextTick(() => res.emit("error", error));
          onResponse(res);
          if (response.responseTimeout) return;
          const chunks = response.chunks || [response.body || ""];
          for (const chunk of chunks) res.emit("data", chunk);
          res.emit("end");
        });
      };
      return req;
    },
  };
}

const xml = "<xml><Content><![CDATA[请保存 https://example.com/item，稍后查看]]></Content><FromUserName><![CDATA[user-1]]></FromUserName></xml>";
assert.strictEqual(wecom.extractUrl(xml), "https://example.com/item");
assert.strictEqual(wecom.xmlField(xml, "FromUserName"), "user-1");
assert.strictEqual(wecom.extractUrl("<xml><Content>没有链接</Content></xml>"), "");
assert.strictEqual(typeof wecom.isEnabled(), "boolean");

(async () => {
  const calls = [];
  const client = wecom.createWecom({
    env: {
      WECOM_CORP_ID: "corp/id",
      WECOM_AGENT_ID: "42",
      WECOM_SECRET: "secret?value",
      WECOM_TOKEN: "callback-token",
      WECOM_ENCODING_AES: "aes-key",
    },
    transport: fakeTransport([
      { body: JSON.stringify({ errcode: 0, access_token: "token-1", expires_in: 7200 }) },
      { body: JSON.stringify({ errcode: 0, errmsg: "ok" }) },
    ], calls),
    requestTimeoutMs: 1234,
    responseTimeoutMs: 2345,
    maxResponseBytes: 1024,
    now: () => 1000,
  });
  assert.strictEqual(client.isEnabled(), true);
  assert.deepStrictEqual(client.config, { CORP_ID: "corp/id", AGENT_ID: "42" });
  assert.strictEqual(Object.hasOwn(client.config, "SECRET"), false);
  assert.strictEqual(Object.hasOwn(client.config, "TOKEN"), false);
  assert.deepStrictEqual(await client.sendText("user-1", "已保存"), { errcode: 0, errmsg: "ok" });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].options.protocol, "https:");
  assert.strictEqual(calls[0].options.method, "GET");
  assert.match(calls[0].options.path, /corpid=corp%2Fid/);
  assert.match(calls[0].options.path, /corpsecret=secret%3Fvalue/);
  assert.strictEqual(calls[1].options.protocol, "https:");
  assert.strictEqual(calls[1].options.method, "POST");
  assert.deepStrictEqual(JSON.parse(calls[1].body), {
    touser: "user-1",
    msgtype: "text",
    agentid: 42,
    text: { content: "已保存" },
  });
  assert.deepStrictEqual(calls.map(call => call.requestTimeout), [1234, 1234]);
  assert.deepStrictEqual(calls.map(call => call.responseTimeout), [2345, 2345]);

  const statusClient = wecom.createWecom({
    env: { WECOM_CORP_ID: "corp", WECOM_SECRET: "secret" },
    transport: fakeTransport([{ statusCode: 503, body: "unavailable" }], []),
  });
  await assert.rejects(() => statusClient.getAccessToken(), /HTTP 503/);

  const sizeClient = wecom.createWecom({
    env: { WECOM_CORP_ID: "corp", WECOM_SECRET: "secret" },
    transport: fakeTransport([{
      headers: { "content-length": "100" },
      body: JSON.stringify({ errcode: 0, access_token: "too-large", expires_in: 7200 }),
    }], []),
    maxResponseBytes: 16,
  });
  await assert.rejects(() => sizeClient.getAccessToken(), /响应过大/);

  const requestTimeoutClient = wecom.createWecom({
    env: { WECOM_CORP_ID: "corp", WECOM_SECRET: "secret" },
    transport: fakeTransport([{ requestTimeout: true }], []),
    requestTimeoutMs: 10,
  });
  await assert.rejects(() => requestTimeoutClient.getAccessToken(), /请求超时/);

  const responseTimeoutClient = wecom.createWecom({
    env: { WECOM_CORP_ID: "corp", WECOM_SECRET: "secret" },
    transport: fakeTransport([{ responseTimeout: true }], []),
    responseTimeoutMs: 10,
  });
  await assert.rejects(() => responseTimeoutClient.getAccessToken(), /响应超时/);

  console.log("wecom: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
