"use strict";

/**
 * 五条主路径真实浏览器回归：收藏提交、研究笔记、截图上传/删除、回收站恢复、
 * 备份导出与恢复。使用隔离临时目录，不读写仓库 DATA.md。
 */

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const REPO = path.join(__dirname, "..");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function json(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    }).on("error", reject);
  });
}
async function waitForDebug(port) {
  for (let index = 0; index < 200; index++) {
    try {
      const pages = await json("http://127.0.0.1:" + port + "/json/list");
      const page = pages.find(item => item.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await wait(100);
  }
  throw new Error("Chrome DevTools 连接超时");
}
function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("服务启动超时: " + output)), 15000);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (output.includes("灵感来袭")) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error("服务提前退出 " + code + ": " + output)); });
  });
}
class Cdp {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); }
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "浏览器求值失败");
    return result.result.value;
  }
}
async function waitFor(cdp, expression, message, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(expression)) return;
    await wait(80);
  }
  throw new Error(message);
}
function stopChild(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, 3000);
  });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-data-e2e-"));
  const dataFile = path.join(root, "DATA.md");
  const entriesDir = path.join(root, "entries");
  const screenshotFile = path.join(root, "fixture.png");
  fs.writeFileSync(screenshotFile, PNG);
  fs.writeFileSync(dataFile, `# Data Paths\n<!-- linggan:data-version=2 -->\n\n## 1. AI 工具\n\n### 🔄 1.1 数据路径基线条目\n<!-- linggan:uid=11111111-1111-4111-8111-111111111111 -->\n- **作者 / 来源**：[fixture](https://example.invalid/base)\n- **研究要点**：基线条目\n`, "utf8");
  fs.mkdirSync(entriesDir, { recursive: true });
  const port = await freePort();
  const debugPort = await freePort();
  const server = spawn(process.execPath, [path.join(REPO, "server.js")], {
    cwd: REPO,
    env: Object.assign({}, process.env, {
      PORT: String(port), HOST: "127.0.0.1", NO_OPEN: "1", LINGGAN_SKIP_BOOTSTRAP: "1",
      README_FILE: dataFile, ENTRIES_DIR: entriesDir,
      CONTROL_DIR: path.join(root, ".linggan"),
      TRASH_DIR: path.join(root, "trash"), BRAINSTORM_DIR: path.join(root, "brainstorms"),
      SERVER_ERROR_LOG_FILE: path.join(root, "server-error.log"),
      API_RATE_LIMIT: "1000", EXPENSIVE_RATE_LIMIT: "1000",
      DINGTALK_CLIENT_ID: "", DINGTALK_CLIENT_SECRET: "", WECOM_CORP_ID: "", WECOM_SECRET: "",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chrome = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + debugPort, "--user-data-dir=" + path.join(root, "profile"), "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let cdp = null;
  try {
    await waitForServer(server);
    await wait(2000);
    cdp = new Cdp(await waitForDebug(debugPort));
    await cdp.connect();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: 'try{localStorage.setItem("linggan_onboarding_v2_seen","1");}catch(_){};window.__e2eErrors=[];window.addEventListener("error",e=>window.__e2eErrors.push(String(e.message||e.error)));',
    });
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
    await waitFor(cdp, 'document.readyState==="complete" && typeof state !== "undefined" && state.items.length === 1', "基线数据未加载");

    /* 1. 收藏提交 */
    await cdp.evaluate(`(() => {
      document.getElementById("addBtn").click();
      document.getElementById("fetchUrl").value = "https://example.invalid/e2e-add";
      document.getElementById("linkName").value = "E2E 新增条目";
      document.getElementById("linkDesc").value = "真实浏览器保存路径";
      const category = document.getElementById("linkCat");
      category.innerHTML = '<option value="AI 工具">AI 工具</option>';
      category.value = "AI 工具";
      document.getElementById("editForm").hidden = false;
      document.getElementById("genBtn").hidden = false;
      return true;
    })()`);
    await cdp.evaluate('document.getElementById("genBtn").click(); true');
    await waitFor(cdp, 'state.items.length === 2 && state.items.some(item => item.name.includes("E2E 新增条目"))', "收藏提交未写入看板", 20000);
    const newId = await cdp.evaluate('state.items.find(item => item.name.includes("E2E 新增条目")).id');

    /* 2. 研究笔记保存 */
    await cdp.evaluate(`openStudy(state.items.find(item => item.id === ${JSON.stringify(newId)})); true`);
    await waitFor(cdp, 'document.getElementById("studyOverlay").classList.contains("open")', "研究模式未打开");
    await cdp.evaluate('document.getElementById("studyNote").value = "E2E 研究笔记：验证笔记保存路径"; document.getElementById("studySave").click(); true');
    await waitFor(cdp, 'document.getElementById("toast").textContent.includes("笔记已写回")', "研究笔记保存未完成", 20000);
    await waitFor(cdp, 'localApiFetch("/api/data").then(r=>r.json()).then(d=>d.content.includes("E2E 研究笔记"))', "研究笔记未写入 DATA.md", 20000);
    await cdp.evaluate('document.getElementById("studyBack").click(); true');
    await waitFor(cdp, '!document.getElementById("studyOverlay").classList.contains("open")', "研究模式无法关闭");

    /* 3. 截图上传与删除 */
    await cdp.evaluate(`openEntry(${JSON.stringify(newId)}); true`);
    await waitFor(cdp, 'document.getElementById("entryView").hidden === false', "研究档案未打开");
    const documentNode = await cdp.send("DOM.getDocument", { depth: -1 });
    const inputNode = await cdp.send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "#ssInput" });
    await cdp.send("DOM.setFileInputFiles", { files: [screenshotFile], nodeId: inputNode.nodeId });
    await cdp.evaluate('document.getElementById("ssCaption").value = "E2E 截图"; document.getElementById("ssUploadBtn").click(); true');
    await waitFor(cdp, 'document.querySelectorAll("#ssGrid .ss-item").length >= 1', "截图上传失败", 20000);
    await cdp.evaluate('window.confirm = () => true; document.querySelector("#ssGrid .ss-del").click(); true');
    await waitFor(cdp, 'document.querySelectorAll("#ssGrid .ss-item").length === 0', "截图删除失败", 20000);
    await cdp.evaluate('document.getElementById("entryBack").click(); true');

    /* 4. 回收站恢复 */
    await cdp.evaluate(`localApiFetch("/api/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ${JSON.stringify(newId)} }) }).then(r => r.json()).then(() => httpLoad()).then(() => true)`);
    await waitFor(cdp, 'state.items.length === 1', "条目删除未生效");
    await cdp.evaluate('document.getElementById("trashBtn").click(); true');
    await waitFor(cdp, 'document.querySelectorAll("#trashList .trash-item").length >= 1', "回收站未显示记录", 20000);
    await cdp.evaluate('document.querySelector("#trashList .trash-restore").click(); true');
    await waitFor(cdp, 'state.items.length === 2', "回收站恢复未生效", 20000);
    await cdp.evaluate('document.getElementById("trashModal").classList.remove("open"); true');

    /* 5. 备份导出与恢复 */
    const bundleText = await cdp.evaluate('fetch("/api/backup", { cache: "no-store" }).then(response => response.text())');
    assert.ok(String(bundleText).includes("linggan-backup"), "备份导出未返回完整包");
    const bundle = JSON.parse(bundleText);
    const bundleEntries = new Set((bundle.files || []).map(file => /^entries\/([^/]+)\//.exec(file.path)).filter(Boolean).map(match => match[1]));
    assert.strictEqual(bundleEntries.size, 1, "备份应包含已建立研究档案的条目");
    const backupFile = path.join(root, "backup.json");
    fs.writeFileSync(backupFile, bundleText, "utf8");
    await cdp.evaluate('document.getElementById("dataBtn").click(); true');
    await waitFor(cdp, 'document.getElementById("dataModal").classList.contains("open")', "数据管理未打开");
    await cdp.evaluate('window.confirm = () => true; true');
    const doc2 = await cdp.send("DOM.getDocument", { depth: -1 });
    const backupInput = await cdp.send("DOM.querySelector", { nodeId: doc2.root.nodeId, selector: "#backupFileInput" });
    await cdp.send("DOM.setFileInputFiles", { files: [backupFile], nodeId: backupInput.nodeId });
    await waitFor(cdp, 'document.getElementById("toast").textContent.includes("已从完整备份恢复")', "备份恢复未完成", 30000);
    await waitFor(cdp, 'state.items.length === 2', "备份恢复后条目数不一致");
    const errors = await cdp.evaluate("window.__e2eErrors");
    assert.deepStrictEqual(errors, [], "浏览器运行期出现错误: " + JSON.stringify(errors));
    console.log("e2e-data: collection/note/screenshot/trash/backup PASS");
  } finally {
    try { if (cdp) await cdp.send("Browser.close"); } catch (_) {}
    await stopChild(chrome);
    await stopChild(server);
    await wait(500);
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})().catch(error => { console.error(error.stack || error); process.exit(1); });
