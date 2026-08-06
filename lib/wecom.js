"use strict";
/* ============================================================
 * 企业微信消息加解密 + API 调用（零依赖，仅用 Node 内置 crypto/http）
 *
 * 协议参考：企业微信「接收消息」加解密方案（AES-CBC-PKCS7 + SHA1 签名）
 * 配置（环境变量）：
 *   WECOM_CORP_ID      企业 ID（企业微信管理后台 → 我的企业）
 *   WECOM_AGENT_ID     自建应用 AgentId
 *   WECOM_SECRET        自建应用 Secret
 *   WECOM_TOKEN         接收消息的 Token（自建应用 → 接收消息 → 设置 API 接收）
 *   WECOM_ENCODING_AES  接收消息的 EncodingAESKey（43 位）
 *
 * 用法见 server.js 的 /api/wecom/callback 路由
 * ============================================================ */
const crypto = require("crypto");
const http = require("http");

const CORP_ID = process.env.WECOM_CORP_ID || "";
const AGENT_ID = process.env.WECOM_AGENT_ID || "";
const SECRET = process.env.WECOM_SECRET || "";
const TOKEN = process.env.WECOM_TOKEN || "";
const AES_KEY = process.env.WECOM_ENCODING_AES || "";

let accessTokenCache = { token: "", expireAt: 0 };

/** 是否已配置企业微信（未配置时回调路由返回提示，不影响看板主功能） */
function isEnabled() {
  return !!(CORP_ID && SECRET && TOKEN && AES_KEY);
}

/** Base64 解码 EncodingAESKey → 32 字节 AES 密钥 */
function aesKey() {
  return Buffer.from(AES_KEY + "=", "base64");
}

/** PKCS7 去填充 */
function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  return buf.slice(0, buf.length - pad);
}

/** 签名校验：sort(token, timestamp, nonce, encrypt) → sha1 */
function verifySignature(signature, timestamp, nonce, encrypt) {
  const arr = [TOKEN, timestamp, nonce, encrypt].sort();
  const sha1 = crypto.createHash("sha1").update(arr.join("")).digest("hex");
  return sha1 === signature;
}

/**
 * 解密企业微信消息
 * @returns {{msg: string, fromUser: string}} 明文 XML 的 body 文本 + 发送者
 */
function decrypt(encrypt) {
  const key = aesKey();
  const iv = key.slice(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([decipher.update(encrypt, "base64"), decipher.final()]);
  decrypted = pkcs7Unpad(decrypted);
  // 明文格式：16 字节随机串 + 4 字节 msg_len(大端) + msg + corp_id
  const msgLen = decrypted.readUInt32BE(16);
  const msg = decrypted.slice(20, 20 + msgLen).toString("utf8");
  return msg;
}

/** 提取 XML 标签内容（简易解析，避免引入 xml 解析库） */
function xmlField(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`))
    || xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : "";
}

/** 从消息 XML 中提取链接 */
function extractUrl(xml) {
  const content = xmlField(xml, "Content");
  // 匹配 http(s) 链接（取第一个）
  const m = content.match(/https?:\/\/[^\s<，。！？、]+/i);
  return m ? m[0] : "";
}

/** 获取 access_token（缓存，过期前 5 分钟刷新） */
function getAccessToken() {
  if (accessTokenCache.token && Date.now() < accessTokenCache.expireAt) {
    return Promise.resolve(accessTokenCache.token);
  }
  return new Promise((resolve, reject) => {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(CORP_ID)}&corpsecret=${encodeURIComponent(SECRET)}`;
    http.get(url, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const j = JSON.parse(data);
          if (j.errcode !== 0) return reject(new Error("获取 access_token 失败：" + j.errmsg));
          accessTokenCache = { token: j.access_token, expireAt: Date.now() + (j.expires_in - 300) * 1000 };
          resolve(j.access_token);
        } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

/** 主动发消息给某用户（用于回复入库结果） */
async function sendText(toUser, content) {
  const token = await getAccessToken();
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      touser: toUser,
      msgtype: "text",
      agentid: parseInt(AGENT_ID, 10) || undefined,
      text: { content },
    });
    const req = http.request({
      hostname: "qyapi.weixin.qq.com",
      path: `/cgi-bin/message/send?access_token=${token}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = {
  isEnabled, verifySignature, decrypt, xmlField, extractUrl, sendText,
  config: { CORP_ID, AGENT_ID, SECRET, TOKEN },
};
