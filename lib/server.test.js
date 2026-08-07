"use strict";
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

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

function request(port, options) {
  options = options || {};
  return new Promise((resolve, reject) => {
    const body = options.body || "";
    const headers = Object.assign({}, options.headers);
    if (body && !headers["Content-Length"]) headers["Content-Length"] = Buffer.byteLength(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: options.path || "/",
      method: options.method || "GET",
      headers,
    }, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("服务启动超时: " + output)), 10000);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (output.includes("灵感来袭 · 待办看板")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    child.on("exit", code => {
      clearTimeout(timer);
      reject(new Error("服务提前退出 " + code + ": " + output));
    });
  });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-test-"));
  const dataFile = path.join(root, "DATA.md");
  const entriesDir = path.join(root, "entries");
  const trashDir = path.join(root, "trash");
  const auditFile = path.join(root, "audit.log");
  const brainstormDir = path.join(root, "brainstorms");
  const serverErrorFile = path.join(root, "server-error.log");
  fs.writeFileSync(dataFile, `# Test

## 1. AI 工具

### ⏳ 1.1 测试条目
- **作者 / 来源**：[测试](https://example.com)
- **研究要点**：待补充
`, "utf-8");

  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: Object.assign({}, process.env, {
      PORT: String(port),
      HOST: "127.0.0.1",
      NO_OPEN: "1",
      README_FILE: dataFile,
      ENTRIES_DIR: entriesDir,
      TRASH_DIR: trashDir,
      AUDIT_LOG_FILE: auditFile,
      BRAINSTORM_DIR: brainstormDir,
      SERVER_ERROR_LOG_FILE: serverErrorFile,
      API_RATE_LIMIT: "20",
      LINGGAN_API_TOKEN: "server-test-token",
      JSON_BODY_LIMIT: "64",
      DINGTALK_CLIENT_ID: "",
      DINGTALK_CLIENT_SECRET: "",
      WECOM_CORP_ID: "",
      WECOM_SECRET: "",
      WECOM_TOKEN: "",
      WECOM_ENCODING_AES: "",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForReady(child);
    const denied = await request(port, { path: "/api/data" });
    assert.strictEqual(denied.status, 401);

    const publicPage = await request(port, { path: "/", headers: { Host: "public.example.com" } });
    assert.strictEqual(publicPage.status, 200);
    assert.strictEqual(publicPage.headers["set-cookie"], undefined, "公网 Host 不应获得会话 Cookie");

    const page = await request(port, { path: "/" });
    assert.strictEqual(page.status, 200);
    assert.ok(page.headers["content-security-policy"]);
    const cookie = page.headers["set-cookie"][0].split(";")[0];

    const data = await request(port, { path: "/api/data", headers: { Cookie: cookie } });
    assert.strictEqual(data.status, 200);
    assert.strictEqual(JSON.parse(data.body).ok, true);
    assert.ok(JSON.parse(data.body).content.includes("linggan:data-version=2"));

    const search = await request(port, { path: "/api/search?q=" + encodeURIComponent("测试条目"), headers: { Cookie: cookie } });
    assert.strictEqual(search.status, 200);
    assert.strictEqual(JSON.parse(search.body).results[0].id, "1.1");

    const brainstorm = await request(port, { path: "/api/brainstorm?mode=explore", headers: { Cookie: cookie } });
    assert.strictEqual(brainstorm.status, 200);
    const brainstormData = JSON.parse(brainstorm.body);
    assert.strictEqual(brainstormData.ok, true);
    assert.strictEqual(brainstormData.summary.items, 1);
    assert.ok(Array.isArray(brainstormData.graph.nodes));
    assert.ok(Array.isArray(brainstormData.suggestions));

    const fusionGoal = "制作一个符合自己偏好的设计 Skill";
    const fusion = await request(port, { path: "/api/brainstorm?mode=fusion&goal=" + encodeURIComponent(fusionGoal), headers: { Cookie: cookie } });
    assert.strictEqual(fusion.status, 200);
    const fusionData = JSON.parse(fusion.body);
    assert.strictEqual(fusionData.mode, "fusion");
    assert.strictEqual(fusionData.fusion.goal, fusionGoal);
    assert.ok(Array.isArray(fusionData.fusion.matches));
    assert.ok(Array.isArray(fusionData.fusion.plans));

    const writeHeaders = { Cookie: cookie, Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json" };
    const savedBrainstorm = await request(port, {
      path: "/api/brainstorm/save",
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({ goal: "设计工具", mode: "fusion" }),
    });
    assert.strictEqual(savedBrainstorm.status, 201);
    const savedBrainstormData = JSON.parse(savedBrainstorm.body);
    assert.strictEqual(savedBrainstormData.ok, true);
    const brainstormId = savedBrainstormData.saved.id;
    const brainstormHistory = await request(port, { path: "/api/brainstorm/history", headers: { Cookie: cookie } });
    assert.strictEqual(brainstormHistory.status, 200);
    assert.strictEqual(JSON.parse(brainstormHistory.body).items[0].id, brainstormId);
    const brainstormReport = await request(port, { path: "/api/brainstorm/report?id=" + encodeURIComponent(brainstormId), headers: { Cookie: cookie } });
    assert.strictEqual(brainstormReport.status, 200);
    assert.ok(brainstormReport.headers["content-disposition"].includes(brainstormId));
    assert.ok(brainstormReport.body.includes("# 头脑风暴方案"));

    const diagnostics = await request(port, { path: "/api/diagnostics", headers: { Cookie: cookie } });
    assert.strictEqual(diagnostics.status, 200);
    const diagnosticsData = JSON.parse(diagnostics.body);
    assert.strictEqual(diagnosticsData.dataVersion, 2);
    assert.strictEqual(diagnosticsData.health.status, "ok");
    assert.strictEqual(diagnosticsData.writable, true);
    assert.strictEqual(diagnosticsData.brainstormReports, 1);

    const exported = await request(port, { path: "/api/backup", headers: { Cookie: cookie } });
    assert.strictEqual(exported.status, 200);
    assert.ok(exported.headers["content-disposition"].includes("attachment"));
    assert.strictEqual(JSON.parse(exported.body).format, "linggan-backup");

    const bookmarkHtml = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>工作</H3><DL><p><DT><A HREF="https://bookmarks.example/item">导入书签</A></DL><p></DL><p>';
    const bookmarkHeaders = { Cookie: cookie, Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json" };
    const bookmarkPreview = await request(port, {
      path: "/api/bookmarks/preview",
      method: "POST",
      headers: bookmarkHeaders,
      body: JSON.stringify({ content: bookmarkHtml }),
    });
    assert.strictEqual(bookmarkPreview.status, 200);
    assert.strictEqual(JSON.parse(bookmarkPreview.body).preview.importable, 1);
    assert.strictEqual(JSON.parse(bookmarkPreview.body).preview.samples[0].folder, "工作");
    const bookmarkImport = await request(port, {
      path: "/api/bookmarks/import",
      method: "POST",
      headers: bookmarkHeaders,
      body: JSON.stringify({ content: bookmarkHtml }),
    });
    assert.strictEqual(bookmarkImport.status, 200);
    assert.strictEqual(JSON.parse(bookmarkImport.body).imported, 1);
    assert.ok(fs.readFileSync(dataFile, "utf8").includes("导入书签"));
    assert.ok(fs.readFileSync(dataFile, "utf8").includes("浏览器书签, 工作"));

    const merged = await request(port, {
      path: "/api/merge",
      method: "POST",
      headers: bookmarkHeaders,
      body: JSON.stringify({ id: "1.1", tags: "merge", whySaved: "reason" }),
    });
    assert.strictEqual(merged.status, 200);
    assert.strictEqual(JSON.parse(merged.body).merged, true);
    assert.ok(fs.readFileSync(dataFile, "utf8").includes("为什么收藏**：reason"));

    const status = await request(port, {
      path: "/api/status",
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1.1", status: "✅" }),
    });
    assert.strictEqual(status.status, 200);

    const invalidJson = await request(port, {
      path: "/api/status",
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json" },
      body: "{broken",
    });
    assert.strictEqual(invalidJson.status, 400);

    const oversized = await request(port, {
      path: "/api/status",
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json" },
      body: JSON.stringify({ note: "x".repeat(100) }),
    });
    assert.strictEqual(oversized.status, 413);

    const trash = await request(port, { path: "/api/trash", headers: { Cookie: cookie } });
    assert.strictEqual(trash.status, 200);
    assert.deepStrictEqual(JSON.parse(trash.body).entries, []);

    const tokenStatus = await request(port, {
      path: "/api/status",
      method: "POST",
      headers: { "X-Linggan-Token": "server-test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1.1", status: "🔄" }),
    });
    assert.strictEqual(tokenStatus.status, 200, "显式 API 令牌不依赖浏览器 Origin");

    const wrongOrigin = await request(port, {
      path: "/api/status",
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://127.0.0.1:9999", "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1.1", status: "⏳" }),
    });
    assert.strictEqual(wrongOrigin.status, 403);

    const auditLines = fs.readFileSync(auditFile, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(auditLines.some(entry => entry.route === "/api/status" && entry.status === 200));
    assert.ok(auditLines.every(entry => !Object.prototype.hasOwnProperty.call(entry, "body")));

    let limited;
    for (let i = 0; i < 20; i++) {
      limited = await request(port, { path: "/api/diagnostics", headers: { Cookie: cookie } });
      if (limited.status === 429) break;
    }
    assert.strictEqual(limited.status, 429);
    assert.ok(Number(limited.headers["retry-after"]) >= 1);
  } finally {
    child.kill("SIGTERM");
    const stopped = await new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
    assert.ok(
      stopped.code === 0 || (process.platform === "win32" && stopped.signal === "SIGTERM"),
      "SIGTERM 应正常停止服务"
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("server: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
