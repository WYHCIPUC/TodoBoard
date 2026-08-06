/* ============================================================
 * 看板服务守护进程（零依赖）
 * 每 3 秒检测 3865 端口：无服务时自动拉起 server.js；
 * 若被外部进程接管（如并行工作流验证时），自动让位等待；
 * server.js 被强杀/崩溃后 5 秒自动重新拉起。
 * 启动：node guard.js    （后台运行，Ctrl+C 停止）
 * ============================================================ */
"use strict";
const { spawn } = require("child_process");
const net = require("net");

const PORT = Number(process.env.PORT) || 3865;
const DIR = __dirname;

function portOpen(port) {
  return new Promise(resolve => {
    const s = net.connect({ host: "127.0.0.1", port });
    let done = false;
    const finish = ok => { if (done) return; done = true; try { s.destroy(); } catch (_) {} resolve(ok); };
    s.setTimeout(800, () => finish(false));
    s.once("connect", () => finish(true));
    s.once("error", () => finish(false));
  });
}

let child = null;
let lastExitAt = 0;

async function ensure() {
  const open = await portOpen(PORT);
  if (open) {
    if (child && child.exitCode === null && !child.pending) {
      // 端口开着且子进程在跑 → 正常
    } else if (child && child.exitCode === null) {
      // 子进程启动中，端口暂未开 → 等
    } else if (child) {
      console.log("[guard] 端口被外部进程接管，让位等待");
      child = null;
    }
    return;
  }
  if (child && child.exitCode === null) return; // 子进程还在（启动窗口）
  if (Date.now() - lastExitAt < 5000) return;   // 刚退出，防快速重启循环
  console.log("[guard] 端口 " + PORT + " 空闲，启动 server.js ...");
  child = spawn(process.execPath, ["server.js"], {
    cwd: DIR,
    env: Object.assign({}, process.env, { NO_OPEN: "1" }),
    stdio: "inherit",
    windowsHide: false,
  });
  child.on("exit", code => {
    console.log("[guard] server.js 退出 code=" + code + "，5 秒后重新拉起");
    lastExitAt = Date.now();
    child = null;
  });
}

console.log("[guard] 看板守护运行中：端口 " + PORT + " 无服务时自动拉起（每 3 秒检测）");
setInterval(ensure, 3000);
ensure();
