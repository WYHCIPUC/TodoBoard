"use strict";
const crypto = require("crypto");

const COOKIE_NAME = "linggan_session";

function isLoopbackAddress(value) {
  const address = String(value || "").toLowerCase();
  return address === "::1" || /^(?:::ffff:)?127(?:\.\d{1,3}){3}$/.test(address);
}

function createAuth(options) {
  options = options || {};
  const token = String(options.token || crypto.randomBytes(32).toString("hex"));

  function hostName(req) {
    const raw = String(req.headers && req.headers.host || "");
    try { return new URL("http://" + raw).hostname; }
    catch (_) { return ""; }
  }

  function isLocalHost(req) {
    const localHostHeader = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostName(req));
    return localHostHeader && isLoopbackAddress(req.socket && req.socket.remoteAddress);
  }

  function cookieValue(req) {
    const header = String(req.headers && req.headers.cookie || "");
    for (const part of header.split(";")) {
      const index = part.indexOf("=");
      if (index < 0) continue;
      if (part.slice(0, index).trim() === COOKIE_NAME) return part.slice(index + 1).trim();
    }
    return "";
  }

  function safeEqual(a, b) {
    const left = Buffer.from(String(a || ""));
    const right = Buffer.from(String(b || ""));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  function isAuthorized(req) {
    return authorizationKind(req) !== "none";
  }

  function authorizationKind(req) {
    const header = req.headers && req.headers["x-linggan-token"];
    if (safeEqual(header, token)) return "token";
    if (safeEqual(cookieValue(req), token)) return "session";
    return "none";
  }

  function isTrustedOrigin(req) {
    const origin = String(req.headers && req.headers.origin || "");
    const host = String(req.headers && req.headers.host || "");
    if (!origin || !host) return false;
    try {
      const parsed = new URL(origin);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host.toLowerCase() === host.toLowerCase();
    } catch (_) {
      return false;
    }
  }

  function sessionCookie() {
    return COOKIE_NAME + "=" + token + "; HttpOnly; SameSite=Strict; Path=/";
  }

  return { authorizationKind, isLocalHost, isAuthorized, isTrustedOrigin, sessionCookie };
}

const auth = createAuth({ token: process.env.LINGGAN_API_TOKEN });
module.exports = Object.assign({ createAuth, COOKIE_NAME, isLoopbackAddress }, auth);
