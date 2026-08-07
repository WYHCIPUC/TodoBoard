"use strict";

const fs = require("fs");
const path = require("path");
const store = require("./store");

const AUDIT_LOG_FILE = process.env.AUDIT_LOG_FILE
  ? path.resolve(process.env.AUDIT_LOG_FILE)
  : path.join(path.dirname(store.README), ".linggan", "audit.log");
const DEFAULT_MAX_BYTES = 1024 * 1024;

function safeText(value, max) {
  return String(value || "").replace(/[\r\n]/g, " ").slice(0, max || 120);
}

function createAudit(options) {
  options = options || {};
  const file = path.resolve(options.file || AUDIT_LOG_FILE);
  const maxBytes = Math.max(1024, Number(options.maxBytes) || DEFAULT_MAX_BYTES);

  function rotateIfNeeded(extraBytes) {
    if (!fs.existsSync(file) || fs.statSync(file).size + extraBytes <= maxBytes) return;
    fs.copyFileSync(file, file + ".previous");
    fs.writeFileSync(file, "", "utf8");
  }

  function record(event) {
    const entry = {
      time: new Date().toISOString(),
      method: safeText(event && event.method, 10),
      route: safeText(event && event.route, 160),
      status: Number(event && event.status) || 0,
      auth: safeText(event && event.auth, 20) || "none",
      local: Boolean(event && event.local),
    };
    const line = JSON.stringify(entry) + "\n";
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      rotateIfNeeded(Buffer.byteLength(line));
      fs.appendFileSync(file, line, "utf8");
      return true;
    } catch (_) {
      return false;
    }
  }

  return { file, record };
}

module.exports = Object.assign({ AUDIT_LOG_FILE, createAudit, safeText }, createAudit());
