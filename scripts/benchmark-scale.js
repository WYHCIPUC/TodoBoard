#!/usr/bin/env node
"use strict";

/**
 * 1000 条规模可复现验收脚本。
 * 生成隔离数据目录、启动真实服务，测量首屏数据、批量归档状态、深度搜索、
 * 待处理中心与头脑风暴的响应时间；不写入仓库 DATA.md。
 */

const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const REPO = path.join(__dirname, "..");
const COUNT = Math.max(10, Math.min(5000, Number(process.argv[2]) || 1000));
const KEEP = process.argv.includes("--keep");

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

function request(port, token, pathname) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const req = http.request({
      hostname: "127.0.0.1", port, path: pathname, method: "GET",
      headers: { "X-Linggan-Token": token },
    }, response => {
      let bytes = 0;
      response.on("data", chunk => { bytes += chunk.length; });
      response.on("end", () => resolve({
        status: response.statusCode,
        bytes,
        ms: Number(process.hrtime.bigint() - started) / 1e6,
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("服务启动超时: " + output)), 30000);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (output.includes("灵感来袭")) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error("服务提前退出 " + code + ": " + output)); });
  });
}

function stopChild(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, 3000);
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linggan-scale-"));
  const dataFile = path.join(root, "DATA.md");
  const entriesDir = path.join(root, "entries");
  const token = "scale-benchmark-token";
  let child = null;
  try {
    let data = "# Scale\n<!-- linggan:data-version=2 -->\n\n## 1. AI 工具\n\n";
    for (let index = 1; index <= COUNT; index++) {
      const suffix = String(index).padStart(12, "0");
      const uid = "00000000-0000-4000-8000-" + suffix;
      data += `### ⏳ 1.${index} 规模条目 ${index}\n<!-- linggan:uid=${uid} -->\n- **作者 / 来源**：[来源](https://example.com/${index})\n- **标签**：规模, 验收, 检索\n- **研究要点**：验证 ${COUNT} 条规模下的读取路径\n\n`;
      const dir = path.join(entriesDir, uid);
      fs.mkdirSync(path.join(dir, "archive"), { recursive: true });
      fs.writeFileSync(path.join(dir, "notes.md"), `关键发现：第 ${index} 条研究笔记，包含规模检索词 benchmarkscale。\n`, "utf8");
      fs.writeFileSync(path.join(dir, "archive", "content.md"), `# 正文 ${index}\n\n${"归档正文用于规模验收。".repeat(60)}\n`, "utf8");
    }
    fs.writeFileSync(dataFile, data, "utf8");
    const port = await freePort();
    child = spawn(process.execPath, [path.join(REPO, "server.js")], {
      cwd: REPO,
      env: Object.assign({}, process.env, {
        PORT: String(port), HOST: "127.0.0.1", NO_OPEN: "1",
        README_FILE: dataFile, ENTRIES_DIR: entriesDir,
        CONTROL_DIR: path.join(root, ".linggan"), TRASH_DIR: path.join(root, "trash"),
        BRAINSTORM_DIR: path.join(root, "brainstorms"),
        SERVER_ERROR_LOG_FILE: path.join(root, "server-error.log"),
        LINGGAN_API_TOKEN: token,
        API_RATE_LIMIT: "1000", EXPENSIVE_RATE_LIMIT: "1000",
        DINGTALK_CLIENT_ID: "", DINGTALK_CLIENT_SECRET: "", WECOM_CORP_ID: "", WECOM_SECRET: "",
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForServer(child);
    await new Promise(resolve => setTimeout(resolve, 500));

    const results = {};
    for (const [name, pathname] of [
      ["data", "/api/data"],
      ["archiveStatuses", "/api/archive/statuses"],
      ["attention", "/api/attention"],
      ["search", "/api/search?q=benchmarkscale&limit=100"],
      ["brainstorm", "/api/brainstorm?mode=panorama"],
    ]) {
      const runs = name === "search" ? 3 : 1;
      const samples = [];
      let status = 0;
      let bytes = 0;
      for (let index = 0; index < runs; index++) {
        const result = await request(port, token, pathname);
        status = result.status;
        bytes = result.bytes;
        samples.push(result.ms);
      }
      results[name] = {
        status,
        bytes,
        ms: Math.round((samples.reduce((sum, value) => sum + value, 0) / samples.length) * 10) / 10,
        samples: samples.map(value => Math.round(value * 10) / 10),
      };
    }
    const report = { entries: COUNT, root, results };
    console.log(JSON.stringify(report, null, 2));
    if (!Object.values(results).every(result => result.status === 200)) process.exitCode = 1;
  } finally {
    await stopChild(child);
    if (!KEEP) fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exit(1); });
