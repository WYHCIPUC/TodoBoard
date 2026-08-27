"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const repo = path.join(__dirname, "..");
const CHILD_EXIT_TIMEOUT_MS = 5_000;
const CHROME_CLOSE_TIMEOUT_MS = 3_000;
const WINDOWS_CLEANUP_MAX_ATTEMPTS = 10;
const WINDOWS_CLEANUP_RETRY_DELAY_MS = 100;
const WINDOWS_RETRYABLE_CLEANUP_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("server timeout\n" + output)), 10_000);
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("灵感来袭 · 待办看板")) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("exit", code => { clearTimeout(timer); reject(new Error("server exited " + code + "\n" + output)); });
  });
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const found = candidates.find(file => fs.existsSync(file));
  if (!found) throw new Error("未找到 Chrome/Edge；请设置 CHROME_PATH");
  return found;
}

async function json(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}

async function waitForDebug(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const pages = await json("http://127.0.0.1:" + port + "/json/list");
      const page = pages.find(item => item.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Chrome DevTools 启动超时");
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("Chrome DevTools 连接已关闭"));
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "browser evaluation failed");
    return result.result.value;
  }

  close() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}

async function waitFor(cdp, expression, message) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

function childHasExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = exited => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

async function stopChild(child) {
  if (childHasExited(child)) return;
  child.kill("SIGTERM");
  if (await waitForChildExit(child, CHILD_EXIT_TIMEOUT_MS)) return;
  child.kill("SIGKILL");
  if (!await waitForChildExit(child, CHILD_EXIT_TIMEOUT_MS)) {
    throw new Error("子进程未能在强制终止后退出: " + child.pid);
  }
}

async function stopChrome(cdp, chrome) {
  if (!cdp) return stopChild(chrome);
  if (cdp) {
    try {
      await withTimeout(cdp.send("Browser.close"), CHROME_CLOSE_TIMEOUT_MS, "Chrome DevTools 关闭超时");
    } catch (error) {
      if (childHasExited(chrome)) return;
    } finally {
      cdp.close();
    }
  }
  if (await waitForChildExit(chrome, CHILD_EXIT_TIMEOUT_MS)) return;
  await stopChild(chrome);
}

async function removeTemporaryRoot(root, runtime = {}) {
  const platform = runtime.platform || process.platform;
  const remove = runtime.remove || (target => fs.rmSync(target, { recursive: true, force: true }));
  const wait = runtime.wait || delay;
  const maxAttempts = platform === "win32" ? WINDOWS_CLEANUP_MAX_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      remove(root);
      return;
    } catch (error) {
      const retryable = platform === "win32" && WINDOWS_RETRYABLE_CLEANUP_CODES.has(error.code);
      if (!retryable || attempt === maxAttempts) throw error;
      await wait(WINDOWS_CLEANUP_RETRY_DELAY_MS * attempt);
    }
  }
}

async function runBrowserSmoke() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-e2e-cdp-"));
  const dataFile = path.join(root, "DATA.md");
  const realData = path.join(repo, "DATA.md");
  const hash = file => fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null;
  const realBefore = hash(realData);
  fs.writeFileSync(dataFile, "# E2E\n\n## 1. AI 工具\n\n### ⏳ 1.1 键盘恢复 &lt;img src=x onerror=alert(1)&gt;\n- **作者 / 来源**：[fixture](https://example.invalid)\n- **研究要点**：待补充\n", "utf8");
  const serverPort = await freePort();
  const debugPort = await freePort();
  const server = spawn(process.execPath, [path.join(repo, "server.js")], {
    cwd: repo,
    env: {
      ...process.env,
      PORT: String(serverPort), HOST: "127.0.0.1", NO_OPEN: "1", README_FILE: dataFile,
      ENTRIES_DIR: path.join(root, "entries"), TRASH_DIR: path.join(root, "trash"),
      BRAINSTORM_DIR: path.join(root, "brainstorms"), RECOVERED_ORPHANS_DIR: path.join(root, "recovered-orphans"),
      AUDIT_LOG_FILE: path.join(root, "audit.log"), SERVER_ERROR_LOG_FILE: path.join(root, "server-error.log"),
      DINGTALK_CLIENT_ID: "", DINGTALK_CLIENT_SECRET: "", WECOM_CORP_ID: "", WECOM_SECRET: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let chrome;
  let cdp;
  let functionalError;
  const cleanupErrors = [];
  try {
    await waitForServer(server);
    chrome = spawn(chromeExecutable(), [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--remote-debugging-port=" + debugPort, "--user-data-dir=" + path.join(root, "chrome-profile"), "about:blank",
    ], { stdio: "ignore", windowsHide: true });
    cdp = new Cdp(await waitForDebug(debugPort));
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + serverPort + "/" });
    await waitFor(cdp, 'document.readyState === "complete" && document.querySelector("#trustRail")?.dataset.state === "healthy"', "可信状态未进入 healthy");
    await cdp.evaluate('localStorage.setItem("linggan_onboarding_v2_seen", "1"); document.querySelector("#onboardingModal").classList.remove("open"); true');
    assert.strictEqual(await cdp.evaluate('document.querySelectorAll("[onerror]").length'), 0, "恢复文本不得生成事件属性");
    await cdp.evaluate('document.querySelector("#trustCenterBtn").focus()');
    assert.strictEqual(await cdp.evaluate('document.activeElement === document.querySelector("#trustCenterBtn")'), true, "恢复入口未获得键盘焦点");
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, text: " " });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
    await waitFor(cdp, 'document.querySelector("#recoveryModal").classList.contains("open")', "键盘未打开恢复中心");
    await waitFor(cdp, 'document.querySelector("#recoveryTitle").textContent === "数据健康"', "恢复中心状态未加载完成");
    assert.strictEqual(await cdp.evaluate('document.querySelector("#recoveryConfirmBtn").disabled'), true, "未预览时确认必须禁用");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    assert.strictEqual(await cdp.evaluate('getComputedStyle(document.querySelector(".recovery-modal")).animationName'), "none");
    assert.strictEqual(await cdp.evaluate('document.querySelector("#recoveryRefreshBtn").getBoundingClientRect().width > 0'), true, "390px 下恢复控件不可见");
    await cdp.send("Network.setBlockedURLs", { urls: ["*api/recovery/status*"] });
    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    const offlineResult = await cdp.evaluate('loadTrustedState({ focusError: true }).then(result => new Promise(resolve => requestAnimationFrame(() => resolve({ state: result.state, hidden: document.querySelector("#recoveryError").hidden, text: document.querySelector("#recoveryError").textContent, active: document.activeElement && document.activeElement.id }))))');
    assert.strictEqual(offlineResult.state, "failed", "离线刷新必须进入 failed，而不是沿用旧成功状态");
    assert.strictEqual(offlineResult.hidden, false, "离线错误未显示");
    assert.strictEqual(offlineResult.active, "recoveryError", "不可访问错误未获得焦点: " + JSON.stringify(offlineResult));
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cdp.send("Network.setBlockedURLs", { urls: [] });
    assert.strictEqual(hash(realData), realBefore, "E2E 不得修改真实 DATA.md");
  } catch (error) {
    functionalError = error;
  } finally {
    for (const cleanup of [
      () => stopChrome(cdp, chrome),
      () => stopChild(server),
      () => Promise.resolve(assert.strictEqual(hash(realData), realBefore, "E2E 不得修改真实 DATA.md")),
      () => removeTemporaryRoot(root),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (functionalError) {
    if (cleanupErrors.length) {
      console.error("E2E 功能失败后另有清理错误：");
      for (const error of cleanupErrors) console.error(error.stack || error);
    }
    throw functionalError;
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "E2E 清理失败");
  console.log("e2e: Chrome CDP trusted-recovery desktop/390px/offline/keyboard PASS");
}

if (require.main === module) {
  runBrowserSmoke().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}

module.exports = {
  WINDOWS_CLEANUP_MAX_ATTEMPTS,
  removeTemporaryRoot,
  runBrowserSmoke,
  stopChild,
  stopChrome,
  withTimeout,
  waitForChildExit,
};
