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
const CHROME_DEBUG_TIMEOUT_MS = 30_000;
const INITIAL_UI_TIMEOUT_MS = 30_000;
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

async function waitForDebug(port, runtime = {}) {
  const timeoutMs = runtime.timeoutMs || CHROME_DEBUG_TIMEOUT_MS;
  const now = runtime.now || Date.now;
  const request = runtime.request || json;
  const wait = runtime.wait || delay;
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (runtime.child && childHasExited(runtime.child)) {
      throw new Error("Chrome 在 DevTools 就绪前退出，退出码 " + runtime.child.exitCode);
    }
    try {
      const pages = await request("http://127.0.0.1:" + port + "/json/list");
      const page = pages.find(item => item.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await wait(100);
  }
  throw new Error("Chrome DevTools 在 " + timeoutMs + "ms 内未启动");
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

async function waitFor(cdp, expression, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function relationshipSnapshot(cdp) {
  return cdp.evaluate(`(() => {
    const rectOf = element => {
      const rect = element.getBoundingClientRect();
      return { id: element.dataset.relationshipNode || "", left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    const nodes = [...document.querySelectorAll("#relationshipNodes .relationship-node")].map(rectOf);
    const zones = [...document.querySelectorAll("#relationshipZones .relationship-zone")].map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    const overlaps = [];
    for (let index = 0; index < nodes.length; index++) {
      for (let next = index + 1; next < nodes.length; next++) {
        const a = nodes[index], b = nodes[next];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          overlaps.push([a.id, b.id]);
        }
      }
    }
    const outside = nodes.filter(node => !zones.some(zone => node.left >= zone.left - 1
      && node.right <= zone.right + 1 && node.top >= zone.top - 1 && node.bottom <= zone.bottom + 1)).map(node => node.id);
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem("relationship_positions_v1") || "{}"); } catch (_) {}
    const uniquePositions = new Set(Object.values(stored).map(point => String(point.x) + "," + String(point.y))).size;
    return {
      nodeCount: nodes.length,
      edgeCount: document.querySelectorAll("#relationshipLinks path[data-relationship-edge]").length,
      zoneCount: zones.length,
      overlaps,
      outside,
      uniquePositions,
      summary: document.querySelector("#relationshipSummary").textContent,
      localStatus: document.querySelector("#relationshipLocalStatus").textContent,
    };
  })()`);
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
  const fixture = [
    "# E2E",
    "",
    "## 1. AI 工具",
    "",
    "### 🔄 1.1 键盘恢复 &lt;img src=x onerror=alert(1)&gt;",
    "- **作者 / 来源**：[fixture](https://example.invalid/alpha)",
    "- **标签**：代码, 本地关系, 验证",
    "- **研究要点**：验证本地关系恢复与安全渲染",
    "",
    "### ⏳ 1.2 关系测试 Beta",
    "- **作者 / 来源**：[fixture](https://example.invalid/beta)",
    "- **标签**：代码, 本地关系, 验证",
    "- **研究要点**：补充关系对照与筛选边界",
    "",
    "## 2. 开源项目 & 开发",
    "",
    "### ✅ 2.1 关系测试 GitHub",
    "- **作者 / 来源**：[GitHub](https://github.com/example/gamma)",
    "- **标签**：代码, 本地关系, 工具",
    "- **研究要点**：验证 GitHub 来源、研究档案与方案传递",
    "",
  ].join("\n");
  fs.writeFileSync(dataFile, fixture, "utf8");
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
    cdp = new Cdp(await waitForDebug(debugPort, { child: chrome }));
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try {
        localStorage.setItem("linggan_onboarding_v2_seen", "1");
        localStorage.setItem("relationship_positions_v1", JSON.stringify({
          "1.1": { x: 18, y: 18 }, "1.2": { x: 18, y: 18 }, "2.1": { x: 18, y: 18 }
        }));
      } catch (_) {}`,
    });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + serverPort + "/" });
    await waitFor(cdp, 'document.readyState === "complete" && document.querySelector("#trustRail")?.dataset.state === "healthy"', "可信状态未进入 healthy", INITIAL_UI_TIMEOUT_MS);
    await cdp.evaluate('localStorage.setItem("linggan_onboarding_v2_seen", "1"); document.querySelector("#onboardingModal").classList.remove("open"); true');
    await waitFor(cdp, 'document.querySelector("#nTotal")?.textContent === "3"', "隔离测试数据未完整加载");
    assert.strictEqual(await cdp.evaluate('document.querySelectorAll("[onerror]").length'), 0, "恢复文本不得生成事件属性");
    const captureEntry = await cdp.evaluate('(() => { const top = document.querySelector("#addBtn"); const banner = document.querySelector("#bannerCaptureBtn"); return { topText: top.textContent.trim(), topVisible: top.getBoundingClientRect().height > 0, bannerVisible: banner.getBoundingClientRect().height > 0 }; })()');
    assert.match(captureEntry.topText, /收藏内容/, "顶栏收藏入口缺少明确动作名称");
    assert.strictEqual(captureEntry.topVisible, true, "顶栏收藏入口不可见");
    assert.strictEqual(captureEntry.bannerVisible, true, "首页横幅收藏入口不可见");
    await cdp.evaluate('document.querySelector("#bannerCaptureBtn").click(); true');
    await waitFor(cdp, 'document.querySelector("#modal").classList.contains("open") && document.activeElement === document.querySelector("#fetchUrl")', "横幅收藏入口未打开真实收藏流程");
    await cdp.evaluate('document.querySelector("#cancelBtn").click(); true');
    await waitFor(cdp, '!document.querySelector("#modal").classList.contains("open")', "收藏弹层无法关闭");
    const busyState = await cdp.evaluate('(() => { const button = document.querySelector("#fetchBtn"); const original = button.textContent; setButtonBusy(button, true, "测试中…"); const during = { disabled: button.disabled, busy: button.getAttribute("aria-busy"), label: button.textContent }; setButtonBusy(button, false); return { original, during, restored: button.textContent, disabled: button.disabled, busy: button.hasAttribute("aria-busy") }; })()');
    assert.deepStrictEqual(busyState.during, { disabled: true, busy: "true", label: "测试中…" }, "忙碌状态未同步语义与文案");
    assert.strictEqual(busyState.restored, busyState.original, "忙碌结束后未恢复按钮文案");
    assert.strictEqual(busyState.disabled, false, "忙碌结束后按钮仍不可用");
    assert.strictEqual(busyState.busy, false, "忙碌结束后 aria-busy 未移除");
    await cdp.evaluate('(() => { const button = document.createElement("button"); button.id = "e2ePressButton"; button.className = "btn"; button.textContent = "按压测试"; document.body.appendChild(button); return true; })()');
    const documentNode = await cdp.send("DOM.getDocument");
    const pressNode = await cdp.send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "#e2ePressButton" });
    await cdp.send("CSS.forcePseudoState", { nodeId: pressNode.nodeId, forcedPseudoClasses: ["active"] });
    await waitFor(cdp, 'Math.abs(parseFloat(getComputedStyle(document.querySelector("#e2ePressButton")).scale) - 0.975) <= 0.0005', "按钮按压动画未收敛到目标缩放");
    const pressState = await cdp.evaluate('(() => { const button = document.querySelector("#e2ePressButton"); return { scale: getComputedStyle(button).scale, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }; })()');
    assert.ok(Math.abs(Number(pressState.scale) - 0.975) <= 0.0005, "按钮按压状态未触发触觉反馈: " + JSON.stringify(pressState));
    await cdp.send("CSS.forcePseudoState", { nodeId: pressNode.nodeId, forcedPseudoClasses: [] });
    await cdp.evaluate('document.querySelector("#e2ePressButton").remove(); true');

    const tempBeforeRelationship = hash(dataFile);
    await cdp.evaluate('document.querySelector("#relationshipNav").click(); true');
    await waitFor(cdp, 'document.querySelector("#relationshipAnalysisState").textContent === "本地分析已更新" && document.querySelectorAll("#relationshipNodes .relationship-node").length === 3', "关系画布未完成本地分析");
    let relationship = await relationshipSnapshot(cdp);
    assert.strictEqual(relationship.nodeCount, 3, "关系画布必须呈现全部隔离条目");
    assert.ok(relationship.edgeCount >= 2, "共享标签应生成可追溯关系: " + JSON.stringify(relationship));
    assert.ok(relationship.zoneCount >= 1, "关系画布缺少语义分区");
    assert.deepStrictEqual(relationship.overlaps, [], "自动布局仍有节点重叠: " + JSON.stringify(relationship));
    assert.deepStrictEqual(relationship.outside, [], "节点必须落在所属语义分区: " + JSON.stringify(relationship));
    assert.strictEqual(relationship.uniquePositions, 3, "重叠的历史布局未自动修复");
    assert.match(relationship.localStatus, /3 条记录 · 本地服务已连接/, "本地数据状态不准确");

    await cdp.evaluate('document.querySelector("[data-relationship-source=github]").click(); true');
    await waitFor(cdp, 'document.querySelectorAll("#relationshipNodes .relationship-node").length === 1', "GitHub 来源筛选未生效");
    assert.strictEqual(await cdp.evaluate('document.querySelector("#relationshipNodes .relationship-node")?.dataset.relationshipNode'), "2.1", "GitHub 筛选返回了错误条目");
    await cdp.evaluate('document.querySelector("#relationshipSourceReset").click(); true');
    await waitFor(cdp, 'document.querySelectorAll("#relationshipNodes .relationship-node").length === 3', "重置来源筛选未恢复全部节点");
    await cdp.evaluate('document.querySelector("[data-relationship-scope=inbox]").click(); true');
    await waitFor(cdp, 'document.querySelectorAll("#relationshipNodes .relationship-node").length === 1', "收件箱范围筛选未生效");
    assert.strictEqual(await cdp.evaluate('document.querySelector("#relationshipNodes .relationship-node")?.dataset.relationshipNode'), "1.2", "收件箱范围包含非待研究条目");
    await cdp.evaluate('document.querySelector("[data-relationship-scope=all]").click(); true');
    await waitFor(cdp, 'document.querySelectorAll("#relationshipNodes .relationship-node").length === 3', "关系图范围未恢复全部节点");

    await cdp.evaluate('document.querySelector(\'[data-relationship-node="2.1"]\').click(); true');
    await waitFor(cdp, 'document.querySelector("#relationshipDetailTitle").textContent === "关系测试 GitHub"', "节点详情未随选择更新");
    await waitFor(cdp, `(() => {
      const node = document.querySelector('[data-relationship-node="2.1"]');
      const viewport = document.querySelector("#relationshipViewport");
      if (!node || !viewport) return false;
      const rect = node.getBoundingClientRect();
      const bounds = viewport.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.left >= bounds.left && rect.right <= bounds.right && hit?.closest('[data-relationship-node="2.1"]') === node;
    })()`, "详情面板打开后所选节点不可见或不可拖动");
    const drag = await cdp.evaluate(`(() => {
      const node = document.querySelector('[data-relationship-node="2.1"]')?.getBoundingClientRect();
      const zone = document.querySelector("#relationshipZones .relationship-zone")?.getBoundingClientRect();
      const viewport = document.querySelector("#relationshipViewport")?.getBoundingClientRect();
      if (!node || !zone || !viewport) return null;
      return {
        fromX: node.left + node.width / 2,
        fromY: node.top + node.height / 2,
        toX: Math.max(viewport.left + 18, zone.left - 110),
        toY: Math.min(viewport.bottom - 40, zone.top + 210),
      };
    })()`);
    assert.ok(drag, "未找到可拖拽的关系节点");
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: drag.fromX, y: drag.fromY, button: "left", buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 5; step++) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: drag.fromX + (drag.toX - drag.fromX) * step / 5,
        y: drag.fromY + (drag.toY - drag.fromY) * step / 5,
        button: "left",
        buttons: 1,
      });
    }
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: drag.toX, y: drag.toY, button: "left", buttons: 0, clickCount: 1 });
    await waitFor(cdp, 'document.querySelector("#toast").textContent.includes("所属主题分区")', "跨分区拖拽未给出归位反馈");
    relationship = await relationshipSnapshot(cdp);
    assert.deepStrictEqual(relationship.overlaps, [], "拖拽归位后产生节点重叠: " + JSON.stringify(relationship));
    assert.deepStrictEqual(relationship.outside, [], "拖拽归位后节点仍在语义分区外: " + JSON.stringify(relationship));

    await cdp.evaluate('document.querySelector("[data-relationship-action=verify]").click(); true');
    await waitFor(cdp, '!document.querySelector("#brainstormView").hidden', "关系节点未带入头脑风暴");
    assert.match(await cdp.evaluate('document.querySelector("#brainstormGoal").value'), /关系测试 GitHub/, "验证方案未包含所选节点");
    await cdp.evaluate('document.querySelector("#relationshipNav").click(); true');
    await waitFor(cdp, 'document.querySelector("#relationshipAnalysisState").textContent === "本地分析已更新" && !document.querySelector("#relationshipView").hidden', "从头脑风暴返回关系画布失败");
    await cdp.evaluate('document.querySelector("[data-relationship-action=study]").click(); true');
    await waitFor(cdp, '!document.querySelector("#entryView").hidden && document.querySelector("#entryTitle").textContent === "关系测试 GitHub"', "关系节点未打开研究档案");
    assert.strictEqual(await cdp.evaluate('document.querySelector("#entryBack").textContent'), "← 返回关系画布", "研究档案缺少关系画布返回语义");
    await cdp.evaluate('document.querySelector("#entryBack").click(); true');
    await waitFor(cdp, '!document.querySelector("#relationshipView").hidden && document.querySelector("#relationshipDetailTitle").textContent === "关系测试 GitHub"', "研究档案返回后未恢复关系上下文");

    await cdp.send("Network.setBlockedURLs", { urls: ["*api/brainstorm*"] });
    await cdp.evaluate('document.querySelector("#relationshipRefreshBtn").click(); true');
    await waitFor(cdp, 'document.querySelector("#relationshipAnalysisState").textContent === "已使用离线基础关系"', "关系分析失败时未进入离线降级");
    relationship = await relationshipSnapshot(cdp);
    assert.strictEqual(relationship.nodeCount, 3, "离线降级后本地节点不可用");
    assert.ok(relationship.edgeCount >= 2, "离线降级未保留基础关系");
    await cdp.send("Network.setBlockedURLs", { urls: [] });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await waitFor(cdp, 'window.innerWidth === 390 && !document.querySelector("#relationshipDetail").classList.contains("is-collapsed")', "390px 下所选节点详情未保持可用");
    assert.strictEqual(await cdp.evaluate('getComputedStyle(document.querySelector("[data-relationship-action=study]")).scale'), "none", "减少动态效果下不得保留按钮缩放");
    assert.strictEqual(await cdp.evaluate('document.querySelector("[data-relationship-action=study]").getBoundingClientRect().height > 0'), true, "390px 下研究档案入口不可见");
    assert.strictEqual(await cdp.evaluate('document.querySelector("[data-relationship-action=verify]").getBoundingClientRect().height > 0'), true, "390px 下验证方案入口不可见");
    await cdp.evaluate('document.querySelector("#relationshipDetailClose").click(); document.querySelector("#relationshipFilterBtn").click(); true');
    await waitFor(cdp, 'document.querySelector("#relationshipSidebar").classList.contains("is-open") && document.querySelector("#relationshipFilterBtn").getAttribute("aria-expanded") === "true"', "390px 下关系筛选抽屉未打开");
    assert.strictEqual(await cdp.evaluate('document.querySelector("#relationshipSidebar").getBoundingClientRect().width > 0'), true, "390px 下关系筛选内容不可见");
    await cdp.evaluate('document.querySelector("#relationshipSidebarScrim").click(); true');
    await waitFor(cdp, '!document.querySelector("#relationshipSidebar").classList.contains("is-open")', "关系筛选抽屉无法通过遮罩关闭");
    assert.strictEqual(hash(dataFile), tempBeforeRelationship, "只读关系流程不得改写隔离 DATA.md");
    await cdp.evaluate('document.querySelector("#inspirationNav").click(); true');
    await waitFor(cdp, 'document.querySelector("#addBtn").getBoundingClientRect().height >= 40', "390px 下顶栏收藏入口不可见或过小");
    await cdp.evaluate('document.querySelector("#addBtn").click(); true');
    await waitFor(cdp, 'document.querySelector("#modal").classList.contains("open") && document.activeElement === document.querySelector("#fetchUrl")', "移动收藏入口未打开真实收藏流程");
    await cdp.evaluate('document.querySelector("#cancelBtn").click(); true');
    await waitFor(cdp, '!document.querySelector("#modal").classList.contains("open")', "移动收藏弹层无法关闭");

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

    await cdp.evaluate('document.querySelector("#recoveryModal .modal-x").click(); true');
    await waitFor(cdp, '!document.querySelector("#recoveryModal").classList.contains("open")', "恢复中心无法关闭");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.evaluate('document.querySelector("#attentionBtn").click(); true');
    await waitFor(cdp, 'document.querySelector("#attentionModal").classList.contains("open") && document.querySelectorAll("#attentionList .attention-item").length >= 3', "待处理中心未显示聚合条目");
    const attentionState = await cdp.evaluate('({ items: document.querySelectorAll("#attentionList .attention-item").length, policy: document.querySelector("#attentionPolicy").textContent })');
    assert.ok(attentionState.items >= 3, "待处理中心条目不足");
    assert.match(attentionState.policy, /排序依据/, "待处理中心必须公开排序依据");
    await cdp.evaluate('document.querySelector("#attentionList .attention-item [data-attention-action=defer]").click(); true');
    await waitFor(cdp, 'document.querySelector("#toast").textContent.includes("延后")', "待处理延后未生效");
    await cdp.evaluate('document.querySelector("#attentionList .attention-item [data-attention-action=study]").click(); true');
    await waitFor(cdp, 'document.querySelector("#studyOverlay").classList.contains("open")', "待处理条目未打开研究模式");
    await cdp.evaluate('document.querySelector("#studyReviewDone").click(); true');
    await waitFor(cdp, 'document.querySelector("#studyLifecycleMeta").textContent.includes("上次研究")', "标记已回顾未更新时间");
    await cdp.evaluate('document.querySelector("#studyBack").click(); true');
    await waitFor(cdp, '!document.querySelector("#studyOverlay").classList.contains("open")', "研究模式无法关闭");
    await cdp.evaluate('document.querySelector("#attentionModal .modal-x").click(); true');
    await waitFor(cdp, '!document.querySelector("#attentionModal").classList.contains("open")', "待处理中心无法关闭");
    await cdp.evaluate('document.querySelector("#dataBtn").click(); true');
    await waitFor(cdp, 'document.querySelector("#dataModal").classList.contains("open")', "数据管理未打开");
    await cdp.evaluate('document.querySelector("#integrityCheckBtn").click(); true');
    await waitFor(cdp, '!document.querySelector("#integrityReport").hidden && /已检查/.test(document.querySelector("#integrityReport").textContent)', "完整性巡检未返回结果");
    assert.match(await cdp.evaluate('document.querySelector("#integrityReport").textContent'), /已检查 3 项/, "完整性巡检条目数不正确");
    await cdp.evaluate('document.querySelector("#dataModal .modal-x").click(); true');
    const savedPlan = await cdp.evaluate('localApiFetch("/api/brainstorm/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal: "E2E 方案验证目标", mode: "fusion" }) }).then(response => response.json()).then(data => Boolean(data.ok && data.saved && data.saved.id))');
    assert.strictEqual(savedPlan, true, "E2E 方案保存失败");
    await cdp.evaluate('document.querySelector("#brainstormBtn").click(); true');
    await waitFor(cdp, '!document.querySelector("#brainstormView").hidden && document.querySelector("[data-brainstorm-verify]")', "方案历史未显示验证入口");
    await cdp.evaluate('document.querySelector("[data-brainstorm-verify]").click(); true');
    await waitFor(cdp, 'document.querySelector("#brainstormVerifyModal").classList.contains("open")', "方案验证弹层未打开");
    await cdp.evaluate('document.getElementById("brainstormVerifyStatus").value = "verified"; document.getElementById("brainstormVerifyResult").value = "E2E 小样本验证通过"; document.getElementById("brainstormVerifySave").click(); true');
    await waitFor(cdp, '!document.querySelector("#brainstormVerifyModal").classList.contains("open") && document.querySelector("#brainstormHistory").textContent.includes("已验证")', "方案验证未写入历史");
    const feedback = await cdp.evaluate('localApiFetch("/api/brainstorm?mode=fusion&goal=" + encodeURIComponent("E2E 方案验证目标")).then(response => response.json()).then(data => ({ matched: data.summary.priorVerifications.matched, verified: data.summary.priorVerifications.verified, planStatus: data.fusion.plans[0] && data.fusion.plans[0].priorVerification && data.fusion.plans[0].priorVerification.status }))');
    assert.ok(feedback.matched >= 1, "已验证结论未参与后续方案");
    assert.strictEqual(feedback.planStatus, "verified", "后续方案未标记历史验证");
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
  console.log("e2e: Chrome CDP relationship/recovery/attention/lifecycle/integrity/brainstorm-verification desktop/390px/offline/keyboard PASS");
}

if (require.main === module) {
  runBrowserSmoke().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}

module.exports = {
  CHROME_DEBUG_TIMEOUT_MS,
  INITIAL_UI_TIMEOUT_MS,
  WINDOWS_CLEANUP_MAX_ATTEMPTS,
  removeTemporaryRoot,
  runBrowserSmoke,
  stopChild,
  stopChrome,
  withTimeout,
  waitForChildExit,
  waitForDebug,
};
