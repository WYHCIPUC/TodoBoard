"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const REPO = path.join(__dirname, "..");

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
function request(port, token, pathname = "/api/data", method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: pathname, method, headers: { "X-Linggan-Token": token } }, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}
function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("启动超时: " + output)), 30000);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (output.includes("灵感来袭")) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error("提前退出 " + code + ": " + output)); });
  });
}
function stop(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill("SIGINT");
    setTimeout(() => { try { child.kill("SIGTERM"); } catch (_) {} }, 2500);
    setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, 5000);
  });
}

async function startServer(root, token) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(REPO, "server.js")], {
    cwd: REPO,
    env: Object.assign({}, process.env, {
      PORT: String(port), HOST: "127.0.0.1", NO_OPEN: "1",
      README_FILE: path.join(root, "DATA.md"),
      ENTRIES_DIR: path.join(root, "entries"),
      BRAINSTORM_DIR: path.join(root, "brainstorms"),
      TRASH_DIR: path.join(root, "trash"),
      RECOVERED_ORPHANS_DIR: path.join(root, "recovered-orphans"),
      CONTROL_DIR: path.join(root, ".linggan"),
      SERVER_ERROR_LOG_FILE: path.join(root, "server-error.log"),
      LINGGAN_API_TOKEN: token,
      API_RATE_LIMIT: "1000", EXPENSIVE_RATE_LIMIT: "1000",
      DINGTALK_CLIENT_ID: "", DINGTALK_CLIENT_SECRET: "", WECOM_CORP_ID: "", WECOM_SECRET: "",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForReady(child);
    const response = await request(port, token);
    assert.strictEqual(response.status, 200);
    child.testPort = port;
    return child;
  } catch (error) {
    await stop(child);
    throw error;
  }
}

(async () => {
  const existing = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-bootstrap-existing-"));
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-bootstrap-fresh-"));
  let child = null;
  try {
    const uid = "22222222-2222-4222-8222-222222222222";
    fs.mkdirSync(path.join(existing, "entries", uid), { recursive: true });
    fs.mkdirSync(path.join(existing, ".linggan"), { recursive: true });
    fs.writeFileSync(path.join(existing, "DATA.md"), `# Bootstrap\n<!-- linggan:data-version=2 -->\n## 1. X\n### ⏳ 1.1 Existing\n<!-- linggan:uid=${uid} -->\n- **研究要点**：existing\n`, "utf8");
    fs.writeFileSync(path.join(existing, "entries", uid, "notes.md"), "existing notes", "utf8");
    child = await startServer(existing, "bootstrap-existing");
    assert.strictEqual(fs.existsSync(path.join(existing, ".linggan", "app-migrations", "2.2.0.json")), true, "首次启动必须写入升级 marker");
    const snapshots = fs.readdirSync(path.join(existing, ".linggan", "upgrade-snapshots"));
    assert.strictEqual(snapshots.some(name => name.startsWith("pre-2.2.0-")), true, "已有数据首次启动必须创建升级前快照");
    assert.strictEqual(fs.readFileSync(path.join(existing, "entries", uid, "notes.md"), "utf8"), "existing notes");
    const { acquireVolumeLocks } = require("./volume-lock");
    const resources = [
      path.join(existing, "DATA.md"), path.join(existing, "entries"), path.join(existing, "brainstorms"),
      path.join(existing, "trash"), path.join(existing, "recovered-orphans"), path.join(existing, ".linggan"),
    ];
    assert.throws(() => acquireVolumeLocks(resources, { controlDir: path.join(existing, ".linggan") }), error => error.code === "data_in_use", "运行中的服务必须持有卷级锁");
    const shutdown = await request(child.testPort, "bootstrap-existing", "/api/control/shutdown", "POST");
    assert.strictEqual(shutdown.status, 202);
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(resolve, 5000);
    });
    await stop(child);
    child = null;
    await new Promise(resolve => setTimeout(resolve, 300));
    const ownerFile = path.join(existing, ".linggan", "instance.lock", "owner.json");
    assert.strictEqual(fs.existsSync(ownerFile), false, "正常关闭必须释放实例锁");

    child = await startServer(existing, "bootstrap-existing-again");
    const snapshotsAfterRestart = fs.readdirSync(path.join(existing, ".linggan", "upgrade-snapshots"));
    assert.strictEqual(snapshotsAfterRestart.length, snapshots.length, "已有 marker 的二次启动不得重复创建升级快照");
    await stop(child);
    child = null;

    child = await startServer(fresh, "bootstrap-fresh");
    assert.strictEqual(fs.existsSync(path.join(fresh, "DATA.md")), true, "全新安装必须从 DATA.example.md 初始化");
    assert.strictEqual(fs.existsSync(path.join(fresh, ".linggan", "app-migrations", "2.2.0.json")), true);
    await stop(child);
    child = null;
    console.log("startup-bootstrap: ALL PASS");
  } finally {
    await stop(child);
    fs.rmSync(existing, { recursive: true, force: true });
    fs.rmSync(fresh, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack || error); process.exit(1); });
