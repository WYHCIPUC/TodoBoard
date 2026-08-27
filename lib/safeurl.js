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

function parseIPv6Words(ip) {
  let value = String(ip || "").toLowerCase().split("%", 1)[0];
  if (!value.includes(":")) return null;
  if (value.includes(".")) {
    const split = value.lastIndexOf(":");
    const dotted = value.slice(split + 1);
    const parts = dotted.split(".").map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    value = value.slice(0, split + 1)
      + ((parts[0] << 8) | parts[1]).toString(16) + ":"
      + ((parts[2] << 8) | parts[3]).toString(16);
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right];
  if (words.length !== 8 || words.some(word => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.map(word => parseInt(word, 16));
}

function ipv4FromWords(high, low) {
  const value = (high * 0x10000 + low) >>> 0;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

/** 判断 IP（v4/v6）是否为内网/保留地址 */
function isPrivateIP(ip) {
  if (!ip) return true;
  if (ip.includes(":")) {
    const words = parseIPv6Words(ip);
    if (!words) return true;
    if (words.every(word => word === 0)) return true;                            // ::/128
    if (words.slice(0, 7).every(word => word === 0) && words[7] === 1) return true; // ::1/128
    if ((words[0] & 0xfe00) === 0xfc00) return true;                             // fc00::/7
    if ((words[0] & 0xffc0) === 0xfe80) return true;                             // fe80::/10
    if ((words[0] & 0xffc0) === 0xfec0) return true;                             // 已弃用站点本地范围
    if ((words[0] & 0xff00) === 0xff00) return true;                             // ff00::/8
    if (words[0] === 0x2001 && words[1] === 0x0db8) return true;                 // 文档地址
    if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
      return isPrivateIPv4(ipv4FromWords(words[6], words[7]));                   // IPv4 映射
    }
    if (words.slice(0, 4).every(word => word === 0) && words[4] === 0xffff && words[5] === 0) {
      return isPrivateIPv4(ipv4FromWords(words[6], words[7]));                   // IPv4 转换地址
    }
    if (words.slice(0, 6).every(word => word === 0)) return true;                // 已弃用 IPv4 兼容范围
    const nat64 = words[0] === 0x0064 && words[1] === 0xff9b
      && ((words[2] === 0 && words.slice(3, 6).every(word => word === 0))
        || (words[2] === 1 && words.slice(3, 6).every(word => word === 0)));
    if (nat64 && isPrivateIPv4(ipv4FromWords(words[6], words[7]))) return true;
    if (words[0] === 0x2002 && isPrivateIPv4(ipv4FromWords(words[1], words[2]))) return true; // 6to4
    return false;
  }
  return isPrivateIPv4(ip);
}

/** 校验 URL 可公开访问（resolve 通过 / reject Error） */
function assertPublicUrl(url) {
  let u;
  try { u = new URL(url); }
  catch (_) { return Promise.reject(new Error("无效 URL")); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return Promise.reject(new Error("仅支持 http(s) 链接"));
  }
  if (u.username || u.password) {
    return Promise.reject(new Error("链接不能包含用户名或密码"));
  }
  if (ALLOW_PRIVATE) return Promise.resolve();
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const address = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") {
    return Promise.reject(new Error("出于安全考虑，禁止抓取本机/内网地址"));
  }
  // 直接 IP：就地校验
  if (net.isIP(address)) {
    if (isPrivateIP(address)) return Promise.reject(new Error("出于安全考虑，禁止抓取本机/内网地址"));
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
