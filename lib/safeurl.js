"use strict";
/* ============================================================
 * 出站请求安全校验（防 SSRF）
 *  - 拒绝非 http(s) 协议
 *  - 拒绝解析到内网/回环/链路本地/组播/保留地址的域名（含 DNS rebinding 防护）
 *  - 逃生阀：设置环境变量 ALLOW_PRIVATE_NETWORK=1 可放行（本地可信网络自用时）
 * ============================================================ */
const dns = require("dns");
const net = require("net");

const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_NETWORK === "1";

/** IPv4 是否内网/保留地址 */
function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127
    || (a === 169 && b === 254)               // 链路本地
    || (a === 172 && b >= 16 && b <= 31)      // 私有 172.16/12
    || (a === 192 && b === 168)               // 私有 192.168/16
    || (a === 100 && b >= 64 && b <= 127)     // CGNAT 100.64/10
    || (a === 198 && (b === 18 || b === 19))  // 基准测试 198.18/15
    || a >= 224                               // 组播 + 保留
  );
}

/** 判断 IP（v4/v6）是否为内网/保留地址 */
function isPrivateIP(ip) {
  if (!ip) return true;
  if (ip.includes(":")) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fc") || low.startsWith("fd")) return true;             // fc00::/7
    if (low.startsWith("fe8") || low.startsWith("fe9") || low.startsWith("fea") || low.startsWith("feb")) return true; // fe80::/10
    if (low.startsWith("::ffff:")) return isPrivateIPv4(low.slice(7));         // IPv4 映射
    if (/^0:/.test(low) && low !== "::") return true;                          // 未指定/保留
    return false;
  }
  return isPrivateIPv4(ip);
}

/** 校验 URL 可公开访问（resolve 通过 / reject Error） */
function assertPublicUrl(url) {
  if (ALLOW_PRIVATE) return Promise.resolve();
  let u;
  try { u = new URL(url); }
  catch (_) { return Promise.reject(new Error("无效 URL")); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return Promise.reject(new Error("仅支持 http(s) 链接"));
  }
  const host = u.hostname;
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") {
    return Promise.reject(new Error("出于安全考虑，禁止抓取本机/内网地址"));
  }
  // 直接 IP：就地校验
  if (net.isIP(host)) {
    if (isPrivateIP(host)) return Promise.reject(new Error("出于安全考虑，禁止抓取本机/内网地址"));
    return Promise.resolve();
  }
  // 域名：解析全部结果，任一命中内网即拒绝（防 DNS rebinding）
  return new Promise((resolve, reject) => {
    dns.lookup(host, { all: true }, (err, addrs) => {
      if (err || !addrs || !addrs.length) return reject(new Error("域名解析失败：" + (err && err.code || "EMPTY")));
      if (addrs.some(a => isPrivateIP(a.address))) {
        return reject(new Error("出于安全考虑，禁止抓取本机/内网地址"));
      }
      resolve();
    });
  });
}

module.exports = { assertPublicUrl, isPrivateIP };
