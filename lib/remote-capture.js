"use strict";

/**
 * 远程采集统一契约：企业微信、钉钉等入口只能提交一个 http(s) 链接和来源名。
 * 去重、保存顺序、归档和失败降级由 capture.addUrl 统一负责，入口不得携带
 * 条目字段、读取数据或调用删除/修改接口。
 */

const SOURCE_MAX = 40;

function createRemoteCapture(capture) {
  if (!capture || typeof capture.addUrl !== "function") {
    throw new TypeError("远程采集需要 capture.addUrl");
  }
  return async function captureRemote(url, source) {
    const value = String(url || "").trim();
    if (!/^https?:\/\//i.test(value)) {
      const error = new Error("远程入口只接受 http(s) 链接");
      error.statusCode = 400;
      throw error;
    }
    const stage = String(source || "远程入口").replace(/\s+/g, " ").trim().slice(0, SOURCE_MAX) || "远程入口";
    return capture.addUrl(value, { stage });
  };
}

module.exports = { SOURCE_MAX, createRemoteCapture };
