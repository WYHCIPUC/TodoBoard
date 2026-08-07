"use strict";

const { spawn } = require("child_process");

function validateLocalUrl(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port) {
    throw new Error("Only a local Linggan Board URL can be opened");
  }
  return url.toString();
}

function browserCommand(platform, url) {
  if (platform === "win32") return { command: "explorer.exe", args: [url] };
  if (platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

function openBrowser(value, options) {
  options = options || {};
  const url = validateLocalUrl(value);
  const launch = options.spawn || spawn;
  const target = browserCommand(options.platform || process.platform, url);
  const child = launch(target.command, target.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  if (child && typeof child.unref === "function") child.unref();
  return { ok: true, command: target.command, url };
}

if (require.main === module) {
  try {
    const result = openBrowser(process.argv[2]);
    console.log("Opened " + result.url);
  } catch (error) {
    console.error("[OPEN FAILED] " + error.message);
    process.exitCode = 1;
  }
}

module.exports = { browserCommand, openBrowser, validateLocalUrl };
