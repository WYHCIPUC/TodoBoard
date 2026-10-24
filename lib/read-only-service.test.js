"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const REPO = path.join(__dirname, "..");
const TOKEN = "read-only-test-token";

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
function request(port, pathname, method = "GET", extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1", port, path: pathname, method,
      headers: Object.assign({ "X-Linggan-Token": TOKEN }, extraHeaders),
    }, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}
function waitFor(child, marker, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("启动超时: " + output)), timeoutMs);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (output.includes(marker)) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error("提前退出 " + code + ": " + output)); });
  });
}
function stop(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, 5000);
  });
}
function envFor(root, port, extra = {}) {
  return Object.assign({}, process.env, {
    PORT: String(port), HOST: "127.0.0.1", NO_OPEN: "1",
    README_FILE: path.join(root, "DATA.md"),
    ENTRIES_DIR: path.join(root, "entries"),
    BRAINSTORM_DIR: path.join(root, "brainstorms"),
    TRASH_DIR: path.join(root, "trash"),
    RECOVERED_ORPHANS_DIR: path.join(root, "recovered-orphans"),
    CONTROL_DIR: path.join(root, ".linggan"),
    SERVER_ERROR_LOG_FILE: path.join(root, "server-error.log"),
    LINGGAN_API_TOKEN: TOKEN,
    API_RATE_LIMIT: "1000", EXPENSIVE_RATE_LIMIT: "1000",
    DINGTALK_CLIENT_ID: "", DINGTALK_CLIENT_SECRET: "", WECOM_CORP_ID: "", WECOM_SECRET: "",
  }, extra);
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-read-only-"));
  let primary = null;
  let secondary = null;
  try {
    const uid = "44444444-4444-4444-8444-444444444444";
    fs.mkdirSync(path.join(root, "entries", uid), { recursive: true });
    fs.mkdirSync(path.join(root, ".linggan"), { recursive: true });
    fs.writeFileSync(path.join(root, "DATA.md"), `# Read only\n<!-- linggan:data-version=2 -->\n## 1. X\n### ⏳ 1.1 Read only\n<!-- linggan:uid=${uid} -->\n- **研究要点**：read-only test\n`, "utf8");
    fs.writeFileSync(path.join(root, "entries", uid, "notes.md"), "read-only notes", "utf8");
    const primaryPort = await freePort();
    const readOnlyPort = await freePort();
    primary = spawn(process.execPath, [path.join(REPO, "server.js")], {
      cwd: REPO, env: envFor(root, primaryPort), stdio: ["ignore", "pipe", "pipe"],
    });
    await waitFor(primary, "灵感来袭");
    const primaryData = await request(primaryPort, "/api/data");
    assert.strictEqual(primaryData.status, 200);

    secondary = spawn(process.execPath, [path.join(REPO, "server.js")], {
      cwd: REPO,
      env: envFor(root, primaryPort, { READ_ONLY_PORT: String(readOnlyPort) }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitFor(secondary, "只读模式");
    const read = await request(readOnlyPort, "/api/data");
    assert.strictEqual(read.status, 200);
    assert.ok(JSON.parse(read.body).content.includes("read-only test"));
    const write = await request(readOnlyPort, "/api/add", "POST", {
      "Content-Type": "application/json", "Idempotency-Key": "00000000-0000-4000-8000-000000000001", Origin: "http://127.0.0.1:" + readOnlyPort,
    });
    assert.strictEqual(write.status, 503);
    assert.strictEqual(write.headers["x-linggan-read-only"], "1");
    assert.ok(JSON.parse(write.body).error.includes("只读模式"));

    const shutdownReadOnly = await request(readOnlyPort, "/api/control/shutdown", "POST");
    assert.strictEqual(shutdownReadOnly.status, 202);
    await new Promise(resolve => { secondary.once("exit", resolve); setTimeout(resolve, 5000); });
    secondary = null;
    const shutdownPrimary = await request(primaryPort, "/api/control/shutdown", "POST");
    assert.strictEqual(shutdownPrimary.status, 202);
    await new Promise(resolve => { primary.once("exit", resolve); setTimeout(resolve, 5000); });
    primary = null;
    console.log("read-only-service: ALL PASS");
  } finally {
    await stop(secondary);
    await stop(primary);
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack || error); process.exit(1); });
