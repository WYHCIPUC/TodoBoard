"use strict";

/**
 * 服务异常日志：按大小轮换，保留上一份，避免长期异常把磁盘写满。
 * 日志内容只包含服务端错误与堆栈，不写入请求正文或凭据。
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_BYTES = 1024 * 1024;

function createErrorLog(options = {}) {
  const file = path.resolve(options.file);
  const maxBytes = Math.max(1024, Number(options.maxBytes) || DEFAULT_MAX_BYTES);

  function rotateIfNeeded(extraBytes) {
    try {
      if (!fs.existsSync(file)) return false;
      if (fs.statSync(file).size + extraBytes <= maxBytes) return false;
      fs.copyFileSync(file, file + ".previous");
      fs.writeFileSync(file, "", "utf8");
      return true;
    } catch (_) {
      // 轮换失败不能阻断错误记录；保留原文件继续追加。
      return false;
    }
  }

  function record(tag, error) {
    const line = new Date().toISOString() + " [" + tag + "] " + (error && error.stack || error) + "\n";
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      rotateIfNeeded(Buffer.byteLength(line));
      fs.appendFileSync(file, line, "utf8");
    } catch (_) {}
    console.error("[" + tag + "]", error && error.stack || error);
    return line;
  }

  return { file, maxBytes, record, rotateIfNeeded };
}

module.exports = { DEFAULT_MAX_BYTES, createErrorLog };
