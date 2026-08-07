"use strict";

const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const MIN_NODE_MAJOR = 20;
const DEFAULT_PORT = 3865;
const DEFAULT_HOST = "127.0.0.1";
const APP_MARKER = "灵感来袭 · 待办看板";

function nodeMajor(version) {
  const match = String(version || "").match(/^v?(\d+)/);
  return match ? Number(match[1]) : 0;
}

function checkNode(version = process.versions.node) {
  const major = nodeMajor(version);
  return {
    ok: major >= MIN_NODE_MAJOR,
    message: major >= MIN_NODE_MAJOR
      ? "Node.js " + version
      : "需要 Node.js " + MIN_NODE_MAJOR + " 或更高版本，当前为 " + (version || "未知"),
  };
}

function checkDependencies(rootDir) {
  const packageFile = path.join(rootDir, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
    const names = Object.keys(pkg.dependencies || {});
    const missing = names.filter(name => {
      try {
        require.resolve(name, { paths: [rootDir] });
        return false;
      } catch (_) {
        return true;
      }
    });
    return {
      ok: missing.length === 0,
      missing,
      message: missing.length ? "缺少依赖：" + missing.join("、") : "项目依赖完整",
    };
  } catch (e) {
    return { ok: false, missing: [], message: "无法读取 package.json：" + e.message };
  }
}

function checkDataPath(rootDir, dataFile) {
  const resolved = path.resolve(rootDir, dataFile || "DATA.md");
  const parent = path.dirname(resolved);
  try {
    if (!fs.existsSync(parent)) {
      return { ok: false, path: resolved, message: "数据目录不存在：" + parent };
    }
    fs.accessSync(parent, fs.constants.W_OK);
    if (fs.existsSync(resolved)) fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
    return {
      ok: true,
      path: resolved,
      message: (fs.existsSync(resolved) ? "数据文件可读写：" : "数据文件将在首次启动时创建：") + resolved,
    };
  } catch (e) {
    return { ok: false, path: resolved, message: "数据路径不可读写：" + resolved + "（" + e.message + "）" };
  }
}

function probeExistingApp(port, timeoutMs = 1200) {
  return new Promise(resolve => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/", timeout: timeoutMs }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        if (body.length < 64 * 1024) body += chunk;
      });
      res.on("end", () => resolve(body.includes(APP_MARKER)));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

function probeAppVersion(port, timeoutMs = 1200) {
  return new Promise(resolve => {
    const rootReq = http.get({ hostname: "127.0.0.1", port, path: "/", timeout: timeoutMs }, rootRes => {
      let rootBody = "";
      rootRes.setEncoding("utf8");
      rootRes.on("data", chunk => { if (rootBody.length < 64 * 1024) rootBody += chunk; });
      rootRes.on("end", () => {
        if (!rootBody.includes(APP_MARKER)) { resolve(null); return; }
        const setCookie = rootRes.headers["set-cookie"] || [];
        const cookie = setCookie.length ? String(setCookie[0]).split(";", 1)[0] : "";
        const headers = cookie ? { Cookie: cookie } : {};
        const diagReq = http.get({ hostname: "127.0.0.1", port, path: "/api/diagnostics", headers, timeout: timeoutMs }, diagRes => {
          let body = "";
          diagRes.setEncoding("utf8");
          diagRes.on("data", chunk => { if (body.length < 64 * 1024) body += chunk; });
          diagRes.on("end", () => {
            try {
              const data = JSON.parse(body);
              resolve(diagRes.statusCode === 200 && data.ok && data.appVersion ? String(data.appVersion) : null);
            } catch (_) { resolve(null); }
          });
        });
        diagReq.on("timeout", () => diagReq.destroy());
        diagReq.on("error", () => resolve(null));
      });
    });
    rootReq.on("timeout", () => rootReq.destroy());
    rootReq.on("error", () => resolve(null));
  });
}

function checkPort(port = DEFAULT_PORT, host = DEFAULT_HOST, expectedVersion) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    server.once("error", async e => {
      if (e.code !== "EADDRINUSE") {
        resolve({ ok: false, status: "error", message: "无法检查端口 " + port + "：" + e.message });
        return;
      }
      const appRunning = await probeExistingApp(port);
      const runningVersion = appRunning && expectedVersion ? await probeAppVersion(port) : null;
      const stale = appRunning && expectedVersion && runningVersion !== expectedVersion;
      resolve({
        ok: appRunning && !stale,
        status: stale ? "stale" : appRunning ? "app" : "occupied",
        runningVersion,
        message: stale
          ? "端口 " + port + " 正在运行旧版看板（运行版本 " + (runningVersion || "未知") + "，当前版本 " + expectedVersion + "）；请先关闭旧服务再重新启动"
          : appRunning
          ? "看板已在 http://127.0.0.1:" + port + " 运行"
          : "端口 " + port + " 已被其他程序占用；可关闭占用程序，或设置 PORT 后重试",
      });
    });
    server.listen(port, host, () => {
      server.close(() => resolve({ ok: true, status: "available", message: "端口 " + port + " 可用" }));
    });
  });
}

async function runChecks(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, "..");
  const port = Number(options.port || process.env.PORT) || DEFAULT_PORT;
  const host = options.host || process.env.HOST || DEFAULT_HOST;
  let expectedVersion = options.appVersion;
  if (!expectedVersion) {
    try { expectedVersion = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version; }
    catch (_) { expectedVersion = null; }
  }
  return {
    node: checkNode(options.nodeVersion),
    dependencies: checkDependencies(rootDir),
    data: checkDataPath(rootDir, options.dataFile || process.env.README_FILE),
    port: await checkPort(port, host, expectedVersion),
  };
}

async function main() {
  const startupMode = process.argv.includes("--startup");
  console.log("\n灵感看板 · 启动自检\n");
  const checks = await runChecks();
  for (const result of Object.values(checks)) {
    console.log((result.ok ? "[通过] " : "[失败] ") + result.message);
  }
  console.log("");

  if (checks.port.status === "app" && startupMode) process.exitCode = 2;
  else if (!checks.dependencies.ok && checks.node.ok && checks.data.ok && checks.port.ok) process.exitCode = 3;
  else if (Object.values(checks).some(result => !result.ok)) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(e => {
    console.error("[失败] 启动自检异常：" + e.message);
    process.exitCode = 1;
  });
}

module.exports = {
  APP_MARKER,
  checkDataPath,
  checkDependencies,
  checkNode,
  checkPort,
  nodeMajor,
  probeAppVersion,
  probeExistingApp,
  runChecks,
};
