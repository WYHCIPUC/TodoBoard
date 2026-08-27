"use strict";
/* ============================================================
 * 企业微信消息加解密 + API 调用（零依赖，仅用 Node 内置 crypto/https）
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
const https = require("https");

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

/** PKCS7 去填充 */
function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  return buf.slice(0, buf.length - pad);
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
  const m = content.match(/https?:\/\/[^\s<，。！？、]+/i);
  return m ? m[0] : "";
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createWecom(options = {}) {
  const env = options.env || process.env;
  const supplied = options.config || {};
  const settings = {
    CORP_ID: supplied.CORP_ID ?? options.corpId ?? env.WECOM_CORP_ID ?? "",
    AGENT_ID: supplied.AGENT_ID ?? options.agentId ?? env.WECOM_AGENT_ID ?? "",
    SECRET: supplied.SECRET ?? options.secret ?? env.WECOM_SECRET ?? "",
    TOKEN: supplied.TOKEN ?? options.token ?? env.WECOM_TOKEN ?? "",
    AES_KEY: supplied.AES_KEY ?? options.aesKey ?? env.WECOM_ENCODING_AES ?? "",
  };
  const transport = options.transport || https;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const requestTimeoutMs = positiveNumber(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  const responseTimeoutMs = positiveNumber(options.responseTimeoutMs, DEFAULT_RESPONSE_TIMEOUT_MS);
  const maxResponseBytes = positiveNumber(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
  let accessTokenCache = { token: "", expireAt: 0 };
  let accessTokenRequest = null;

  function isEnabled() {
    return !!(settings.CORP_ID && settings.SECRET && settings.TOKEN && settings.AES_KEY);
  }

  function decodeAesKey() {
    return Buffer.from(settings.AES_KEY + "=", "base64");
  }

  /** 签名校验：sort(token, timestamp, nonce, encrypt) → sha1 */
  function verifySignature(signature, timestamp, nonce, encrypt) {
    const arr = [settings.TOKEN, timestamp, nonce, encrypt].sort();
    const sha1 = crypto.createHash("sha1").update(arr.join("")).digest("hex");
    return sha1 === signature;
  }

  /** 解密企业微信消息，返回明文 XML。 */
  function decrypt(encrypt) {
    const key = decodeAesKey();
    const iv = key.slice(0, 16);
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(encrypt, "base64"), decipher.final()]);
    decrypted = pkcs7Unpad(decrypted);
    const msgLen = decrypted.readUInt32BE(16);
    return decrypted.slice(20, 20 + msgLen).toString("utf8");
  }

  function requestJson(requestOptions, body) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      };
      let req;
      try {
        req = transport.request(requestOptions, res => {
          const chunks = [];
          let bytes = 0;
          res.on("aborted", () => finish(new Error("企业微信响应中断")));
          res.on("error", error => finish(error));
          const contentLength = Number(res.headers && res.headers["content-length"]);
          if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
            const error = new Error("企业微信响应过大");
            finish(error);
            if (typeof res.destroy === "function") res.destroy(error);
            return;
          }
          if (typeof res.setTimeout === "function") {
            res.setTimeout(responseTimeoutMs, () => {
              const error = new Error("企业微信响应超时");
              finish(error);
              if (typeof res.destroy === "function") res.destroy(error);
            });
          }
          res.on("data", chunk => {
            if (settled) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            bytes += buffer.length;
            if (bytes > maxResponseBytes) {
              const error = new Error("企业微信响应过大");
              finish(error);
              if (typeof res.destroy === "function") res.destroy(error);
              return;
            }
            chunks.push(buffer);
          });
          res.on("end", () => {
            if (settled) return;
            if (res.statusCode < 200 || res.statusCode >= 300) {
              finish(new Error("企业微信请求失败：HTTP " + res.statusCode));
              return;
            }
            try {
              finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (_) {
              finish(new Error("企业微信响应不是有效 JSON"));
            }
          });
        });
      } catch (error) {
        finish(error);
        return;
      }
      req.on("error", error => finish(error));
      if (typeof req.setTimeout === "function") {
        req.setTimeout(requestTimeoutMs, () => {
          const error = new Error("企业微信请求超时");
          finish(error);
          if (typeof req.destroy === "function") req.destroy(error);
        });
      }
      if (body) req.write(body);
      req.end();
    });
  }

  /** 获取 access_token（缓存，过期前 5 分钟刷新） */
  async function getAccessToken() {
    if (accessTokenCache.token && now() < accessTokenCache.expireAt) return accessTokenCache.token;
    if (accessTokenRequest) return accessTokenRequest;
    const path = "/cgi-bin/gettoken?corpid=" + encodeURIComponent(settings.CORP_ID)
      + "&corpsecret=" + encodeURIComponent(settings.SECRET);
    const pending = requestJson({
      protocol: "https:",
      hostname: "qyapi.weixin.qq.com",
      port: 443,
      path,
      method: "GET",
      headers: { Accept: "application/json" },
    }).then(result => {
      if (!result || result.errcode !== 0 || !result.access_token) {
        throw new Error("获取 access_token 失败：" + (result && result.errmsg || "响应无效"));
      }
      const expiresIn = positiveNumber(result.expires_in, 7200);
      accessTokenCache = {
        token: result.access_token,
        expireAt: now() + Math.max(1, expiresIn - 300) * 1000,
      };
      return result.access_token;
    });
    accessTokenRequest = pending;
    try { return await pending; }
    finally { if (accessTokenRequest === pending) accessTokenRequest = null; }
  }

  /** 主动发消息给某用户（用于回复入库结果） */
  async function sendText(toUser, content) {
    const token = await getAccessToken();
    const body = JSON.stringify({
      touser: toUser,
      msgtype: "text",
      agentid: parseInt(settings.AGENT_ID, 10) || undefined,
      text: { content },
    });
    const result = await requestJson({
      protocol: "https:",
      hostname: "qyapi.weixin.qq.com",
      port: 443,
      path: "/cgi-bin/message/send?access_token=" + encodeURIComponent(token),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Accept: "application/json",
      },
    }, body);
    if (!result || result.errcode !== 0) {
      throw new Error("企业微信消息发送失败：" + (result && result.errmsg || "响应无效"));
    }
    return result;
  }

  return {
    isEnabled,
    verifySignature,
    decrypt,
    xmlField,
    extractUrl,
    getAccessToken,
    sendText,
    config: {
      CORP_ID: settings.CORP_ID,
      AGENT_ID: settings.AGENT_ID,
    },
  };
}

const service = createWecom();
module.exports = Object.assign({
  createWecom,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RESPONSE_TIMEOUT_MS,
  DEFAULT_MAX_RESPONSE_BYTES,
}, service);
