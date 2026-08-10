"use strict";
/* ============================================================
 * 钉钉机器人 Stream 模式接入（零公网、零域名、零 cpolar）
 *
 * 原理：通过 WebSocket 长连接接收钉钉机器人消息，收到链接后抓取并入库，
 *       再通过 sessionWebhook 回复结果。无需公网 IP/域名/回调地址。
 *
 * 配置（环境变量）：
 *   DINGTALK_CLIENT_ID     应用的 AppKey（ClientID）
 *   DINGTALK_CLIENT_SECRET 应用的 AppSecret（ClientSecret）
 *
 * 用法：在 server.js 启动时调用 start()，停止时调用 stop()
 * ============================================================ */
const { DWClient, TOPIC_ROBOT } = require("dingtalk-stream-sdk-nodejs");
const https = require("https");

const CLIENT_ID = process.env.DINGTALK_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DINGTALK_CLIENT_SECRET || "";

let client = null;

/** 是否已配置钉钉 */
function isEnabled() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

/** 从钉钉消息文本提取链接 */
function extractUrl(text) {
  if (!text) return "";
  const m = String(text).match(/https?:\/\/[^\s<，。！？、\u0000-\u001F]+/i);
  return m ? m[0] : "";
}

/** 通过 sessionWebhook 回复消息（钉钉机器人回复机制） */
function reply(sessionWebhook, text) {
  return new Promise((resolve) => {
    if (!sessionWebhook) return resolve(false);
    try {
      const u = new URL(sessionWebhook);
      const body = JSON.stringify({
        msgKey: "sampleText",
        msgParam: JSON.stringify({ content: text }),
      });
      const req = https.request({
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode === 200));
      });
      req.on("error", () => resolve(false));
      req.write(body);
      req.end();
    } catch (_) { resolve(false); }
  });
}

/**
 * 启动钉钉 Stream 客户端
 * @param {(url: string) => Promise<{ok, id?, category?, title?, author?, warning?}>} onUrl 收到链接时的入库回调
 */
async function start(onUrl) {
  if (!isEnabled()) return false;
  if (client) return true;
  client = new DWClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    debug: false,
  });
  client.registerCallbackListener(TOPIC_ROBOT, async (res) => {
    try {
      const { text, sessionWebhook } = JSON.parse(res.data || "{}");
      const content = (text && text.content) || "";
      const url = extractUrl(content);
      if (!url) {
        await reply(sessionWebhook, "请发送一个 http(s) 链接，我会自动抓取并记录到看板。");
        return;
      }
      await reply(sessionWebhook, "⏳ 正在抓取并记录...");
      const result = await onUrl(url);
      if (result.ok) {
        const msg = result.warning
          ? `✅ 已记录（兜底解析）\n${result.id} ${result.title}\n分类：${result.category}\n⚠️ ${result.warning}`
          : `✅ 已记录\n${result.id} ${result.title}\n分类：${result.category}${result.author ? "\n作者：" + result.author : ""}`;
        const archiveReply = result.archive && result.archive.state === "queued"
          ? `已保存\n${result.id} ${result.title}\n正在归档`
          : msg;
        await reply(sessionWebhook, archiveReply);
      } else {
        await reply(sessionWebhook, "❌ 记录失败：" + (result.error || "未知错误"));
      }
    } catch (e) {
      console.error("[dingtalk] 处理消息失败:", e.message);
    }
  });
  try {
    await client.connect();
    console.log("[dingtalk] Stream 客户端已连接，等待消息...");
    return true;
  } catch (e) {
    console.error("[dingtalk] 连接失败:", e.message);
    client = null;
    return false;
  }
}

function stop() {
  if (client) {
    try { client.disconnect(); } catch (_) {}
    client = null;
  }
}

module.exports = { isEnabled, start, stop, extractUrl };
