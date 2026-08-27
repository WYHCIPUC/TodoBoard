"use strict";
const assert = require("assert");
const crypto = require("crypto");
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
    if (!options.skipIdempotency && ["POST", "PUT", "PATCH", "DELETE"].includes(options.method || "GET") &&
        (options.path || "/") !== "/api/control/shutdown" && !headers["Idempotency-Key"]) {
      headers["Idempotency-Key"] = crypto.randomUUID();
    }
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

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
}

async function exerciseTrustedHelpers(root, dataFile) {
  const previous = {
    README_FILE: process.env.README_FILE,
    ENTRIES_DIR: process.env.ENTRIES_DIR,
    TRASH_DIR: process.env.TRASH_DIR,
    BRAINSTORM_DIR: process.env.BRAINSTORM_DIR,
    RECOVERED_ORPHANS_DIR: process.env.RECOVERED_ORPHANS_DIR,
  };
  Object.assign(process.env, {
    README_FILE: dataFile,
    ENTRIES_DIR: path.join(root, "entries"),
    TRASH_DIR: path.join(root, "trash"),
    BRAINSTORM_DIR: path.join(root, "brainstorms"),
    RECOVERED_ORPHANS_DIR: path.join(root, "recovered-orphans"),
  });
  const api = require(path.join(__dirname, "..", "server.js"));
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const response = () => ({
    status: null, headers: null, body: null, writableEnded: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; this.writableEnded = true; },
  });
  assert.strictEqual(api.publicDetails(null), null);
  assert.strictEqual(api.publicDetails({ secret: "x" }), null);
  assert.deepStrictEqual(api.publicDetails({ state: "prepared", scopes: ["data", 2], needed: 3, cause: "hidden" }), { state: "prepared", scopes: ["data", "2"], needed: 3 });
  assert.strictEqual(api.requireUuid("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.throws(() => api.requireUuid("bad", "transactionId"), error => error.code === "invalid_request" && error.message.includes("transactionId"));
  assert.deepStrictEqual(api.actionableRecoveryTransactions(null), []);
  assert.deepStrictEqual(api.actionableRecoveryTransactions({ transactions: [{ state: "completed" }, { state: "prepared" }] }), [{ state: "prepared" }]);

  const stateFor = (mode, recovery, lastVerified) => api.trustedStateModel({
    coordinator: { status: () => ({ mode, activeMutations: mode === "normal" ? 0 : 1 }) },
    recovery: { status: () => recovery },
    lastVerified: lastVerified || null,
  }).state;
  const normalRecovery = { state: "normal", transactions: [], activeRecoveryImport: null };
  assert.strictEqual(stateFor("waiting", normalRecovery), "locked");
  assert.strictEqual(stateFor("maintenance", normalRecovery), "in_progress");
  assert.strictEqual(stateFor("normal", { ...normalRecovery, transactions: [{ state: "manual_recovery", selection: "ambiguous" }] }), "ambiguous");
  assert.strictEqual(stateFor("normal", { ...normalRecovery, transactions: [{ state: "manual_recovery", selection: "selected" }, { state: "preparing", selection: "selected" }] }), "ambiguous");
  assert.strictEqual(stateFor("normal", { ...normalRecovery, activeRecoveryImport: { state: "prepared" } }), "action_required");
  assert.strictEqual(stateFor("normal", { ...normalRecovery, activeRecoveryImport: { state: "rescue_importing" } }), "in_progress");
  assert.strictEqual(stateFor("normal", { ...normalRecovery, activeRecoveryImport: { state: "completed" } }), "verified");
  assert.strictEqual(stateFor("normal", { ...normalRecovery, state: "recovery_required" }), "action_required");
  assert.strictEqual(stateFor("normal", normalRecovery, "2030-01-01T00:00:00.000Z"), "verified");
  assert.strictEqual(api.trustedStateModel({ coordinator: { status: () => ({ mode: "normal" }) }, recovery: { status: () => { throw Object.assign(new Error("x"), { code: "manual_recovery_required" }); } } }).state, "failed");

  let res = response();
  assert.strictEqual(api.maintenanceGate({ coordinator: { status: () => ({ mode: "normal" }) } }, { method: "POST" }, res, "/api/data"), false);
  res = response();
  assert.strictEqual(api.maintenanceGate({ coordinator: { status: () => ({ mode: "waiting" }) } }, { method: "POST" }, res, "/api/data"), true);
  assert.strictEqual(JSON.parse(res.body).code, "maintenance_locked");
  res = response();
  assert.strictEqual(api.maintenanceGate({ coordinator: { status: () => ({ mode: "maintenance" }) } }, { method: "GET" }, res, "/api/data"), true);
  assert.strictEqual(JSON.parse(res.body).code, "maintenance_mode");
  assert.strictEqual(res.headers["Retry-After"], "2");
  res = response();
  assert.strictEqual(api.maintenanceGate({ coordinator: { status: () => ({ mode: "maintenance" }) } }, { method: "GET" }, res, "/api/health"), false);

  res = response();
  api.sendDomainError(res, { statusCode: 400 }, null);
  assert.strictEqual(JSON.parse(res.body).code, "invalid_request");
  res = response();
  api.sendDomainError(res, { statusCode: 413 }, null);
  assert.strictEqual(JSON.parse(res.body).code, "bundle_too_large");
  res = response();
  api.sendDomainError(res, new Error("private C:\\secret"), "not-a-uuid");
  assert.strictEqual(JSON.parse(res.body).message.includes("secret"), false);
  for (const code of ["data_in_use", "legacy_instance_may_be_running", "stale_lock_not_proven"]) {
    res = response();
    api.sendDomainError(res, { code, details: { ownerNonce: "private", state: "locked" } }, null);
    assert.strictEqual(res.status, 409, code + " 必须是稳定冲突响应");
    assert.deepStrictEqual(JSON.parse(res.body).details, { state: "locked" }, code + " 不得泄露锁 owner nonce");
  }

  const receipts = new Map();
  const idempotency = {
    get: id => receipts.get(id) || null,
    begin(options) { receipts.set(options.requestId, { action: options.action, requestHash: require("./idempotency").canonicalRequestHash(options.action, options.values), state: "pending" }); },
    commit(id, status, body) { receipts.set(id, { ...receipts.get(id), state: "committed", httpStatus: status, response: body }); },
  };
  const operationId = crypto.randomUUID();
  const first = await api.runIdempotent({ idempotency }, operationId, "backup.cancel", { transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, async () => ({ cancelled: true }));
  assert.strictEqual(first.replay, false);
  const replay = await api.runIdempotent({ idempotency }, operationId, "backup.cancel", { transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, async () => assert.fail("replay must not execute"));
  assert.strictEqual(replay.replay, true);
  await assert.rejects(() => api.runIdempotent({ idempotency }, operationId, "backup.cancel", { transactionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, async () => ({})), error => error.code === "idempotency_conflict");

  const concurrentId = crypto.randomUUID();
  const concurrentApi = { idempotency, inFlightOperations: new Map() };
  let releaseConcurrent;
  const concurrentBarrier = new Promise(resolve => { releaseConcurrent = resolve; });
  let concurrentCalls = 0;
  const concurrentWork = async () => {
    concurrentCalls++;
    await concurrentBarrier;
    return { committed: true, verified: true };
  };
  const firstConcurrent = api.runIdempotent(concurrentApi, concurrentId, "backup.cancel", { transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, concurrentWork);
  const repeatedConcurrent = api.runIdempotent(concurrentApi, concurrentId, "backup.cancel", { transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, concurrentWork);
  await assert.rejects(
    () => api.runIdempotent(concurrentApi, concurrentId, "backup.cancel", { transactionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, concurrentWork),
    error => error.code === "idempotency_conflict"
  );
  releaseConcurrent();
  const [firstResult, repeatedResult] = await Promise.all([firstConcurrent, repeatedConcurrent]);
  assert.strictEqual(concurrentCalls, 1, "并发重复请求只能执行一次领域写入");
  assert.strictEqual(firstResult.replay, false);
  assert.strictEqual(repeatedResult.replay, true);
  assert.deepStrictEqual(repeatedResult.response, firstResult.response);
  assert.strictEqual(concurrentApi.inFlightOperations.size, 0, "并发请求完成后不得残留在途句柄");

  const failedId = crypto.randomUUID();
  await assert.rejects(
    () => api.runIdempotent({ idempotency, inFlightOperations: new Map() }, failedId, "backup.cancel", { transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, async () => {
      const error = new Error("verification mismatch at C:\\private");
      error.code = "commit_failed_rolled_back";
      throw error;
    }),
    error => error.code === "commit_failed_rolled_back"
  );
  assert.strictEqual(receipts.get(failedId).state, "pending", "验证失败不得伪造 committed 收据");
  await Promise.resolve(require("./capture").stop());
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
  for (const directory of [entriesDir, trashDir, brainstormDir, path.join(root, "recovered-orphans")]) {
    fs.mkdirSync(directory, { recursive: true });
  }

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
      RECOVERED_ORPHANS_DIR: path.join(root, "recovered-orphans"),
      AUDIT_LOG_FILE: auditFile,
      BRAINSTORM_DIR: brainstormDir,
      SERVER_ERROR_LOG_FILE: serverErrorFile,
      API_RATE_LIMIT: "150",
      LINGGAN_API_TOKEN: "server-test-token",
      JSON_BODY_LIMIT: "1024",
      DINGTALK_CLIENT_ID: "",
      DINGTALK_CLIENT_SECRET: "",
      WECOM_CORP_ID: "",
      WECOM_SECRET: "",
      WECOM_TOKEN: "",
      WECOM_ENCODING_AES: "",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stopped = null;

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

    const entryBeforeArchive = await request(port, { path: "/api/entry?id=1.1", headers: { Cookie: cookie } });
    assert.strictEqual(entryBeforeArchive.status, 200);
    assert.strictEqual(JSON.parse(entryBeforeArchive.body).entry.archive.state, "queued");

    const manualContent = await request(port, {
      path: "/api/entry/content",
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1.1", content: "# 手动归档内容\n\n保存后的正文" }),
    });
    assert.strictEqual(manualContent.status, 200, manualContent.body);
    assert.strictEqual(JSON.parse(manualContent.body).archive.state, "succeeded");
    const archiveStatus = await request(port, { path: "/api/archive/status?id=1.1", headers: { Cookie: cookie } });
    assert.strictEqual(archiveStatus.status, 200);
    assert.strictEqual(JSON.parse(archiveStatus.body).archive.state, "succeeded");
    const missingArchive = await request(port, { path: "/api/archive/status?id=missing", headers: { Cookie: cookie } });
    assert.strictEqual(missingArchive.status, 404);

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
    const healthState = await request(port, { path: "/api/health", headers: { Cookie: cookie } });
    assert.strictEqual(healthState.status, 200);
    assert.strictEqual(JSON.parse(healthState.body).state, "healthy");
    const publicState = await request(port, { path: "/api/state", headers: { Cookie: cookie } });
    assert.strictEqual(JSON.parse(publicState.body).condition.severity, "ok");
    const maintenanceStatus = await request(port, { path: "/api/maintenance/status", headers: { Cookie: cookie } });
    assert.deepStrictEqual(JSON.parse(maintenanceStatus.body), { ok: true, mode: "normal", activeMutations: 0 });
    const upgradeStatus = await request(port, { path: "/api/upgrade/status", headers: { Cookie: cookie } });
    assert.strictEqual(upgradeStatus.status, 200);
    assert.ok(Array.isArray(JSON.parse(upgradeStatus.body).snapshots));
    const upgradePreview = await request(port, {
      path: "/api/upgrade/preview", method: "POST", headers: writeHeaders, body: JSON.stringify({}),
    });
    assert.strictEqual(JSON.parse(upgradePreview.body).dryRun, true);
    const attentionState = await request(port, { path: "/api/attention", headers: { Cookie: cookie } });
    assert.strictEqual(attentionState.status, 200, attentionState.body);
    assert.ok(Array.isArray(JSON.parse(attentionState.body).items));
    const archiveStatuses = await request(port, { path: "/api/archive/statuses", headers: { Cookie: cookie } });
    assert.strictEqual(archiveStatuses.status, 200, archiveStatuses.body);
    const archiveStatusesData = JSON.parse(archiveStatuses.body);
    assert.strictEqual(archiveStatusesData.statuses.length, 1);
    assert.ok(Object.prototype.hasOwnProperty.call(archiveStatusesData.statuses[0].integrity, "checkedAt"));
    const integrity = await request(port, {
      path: "/api/archive/integrity/check", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ ids: ["1.1", "1.1", "missing"] }),
    });
    assert.strictEqual(integrity.status, 200, integrity.body);
    assert.strictEqual(JSON.parse(integrity.body).results.length, 2, "完整性检查必须去重且不得联网");
    const emptyIntegrity = await request(port, {
      path: "/api/archive/integrity/check", method: "POST", headers: writeHeaders, body: JSON.stringify({ ids: [] }),
    });
    assert.strictEqual(emptyIntegrity.status, 400);
    assert.strictEqual(JSON.parse(emptyIntegrity.body).code, "invalid_request");
    const oversizedIntegrity = await request(port, {
      path: "/api/archive/integrity/check", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ ids: Array.from({ length: 201 }, (_, index) => String(index)) }),
    });
    assert.strictEqual(oversizedIntegrity.status, 413);
    const wrongTrustedMethod = await request(port, { path: "/api/recovery/status", method: "POST", headers: writeHeaders, body: "{}" });
    assert.strictEqual(wrongTrustedMethod.status, 405);
    const retryWithoutTransaction = await request(port, {
      path: "/api/recovery/retry", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ requestId: crypto.randomUUID(), transactionId: null }),
    });
    assert.strictEqual(retryWithoutTransaction.status, 404);
    const missingLifecycleId = await request(port, {
      path: "/api/lifecycle", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ id: "1.1", action: "mark_reviewed" }),
    });
    assert.strictEqual(missingLifecycleId.status, 400);
    assert.strictEqual(JSON.parse(missingLifecycleId.body).code, "invalid_request");
    const missingLegacyId = await request(port, {
      path: "/api/status", method: "POST", skipIdempotency: true,
      headers: { Cookie: cookie, Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1.1", status: "⏳" }),
    });
    assert.strictEqual(missingLegacyId.status, 400);
    assert.strictEqual(JSON.parse(missingLegacyId.body).code, "invalid_request");
    const lifecycleRequestId = crypto.randomUUID();
    const lifecycleBody = JSON.stringify({ requestId: lifecycleRequestId, id: "1.1", action: "mark_reviewed" });
    const lifecycleSaved = await request(port, { path: "/api/lifecycle", method: "POST", headers: writeHeaders, body: lifecycleBody });
    assert.strictEqual(lifecycleSaved.status, 200, lifecycleSaved.body);
    assert.strictEqual(JSON.parse(lifecycleSaved.body).operationId, lifecycleRequestId);
    const lifecycleReplay = await request(port, { path: "/api/lifecycle", method: "POST", headers: writeHeaders, body: lifecycleBody });
    assert.deepStrictEqual(JSON.parse(lifecycleReplay.body), JSON.parse(lifecycleSaved.body), "重复生命周期请求必须重放首次收据");
    const lifecycleConflict = await request(port, {
      path: "/api/lifecycle", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ requestId: lifecycleRequestId, id: "1.1", action: "clear_review" }),
    });
    assert.strictEqual(lifecycleConflict.status, 409);
    assert.strictEqual(JSON.parse(lifecycleConflict.body).code, "idempotency_conflict");
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
    const exportedBundle = JSON.parse(exported.body);
    assert.strictEqual(exportedBundle.format, "linggan-backup");
    const backupPreview = await request(port, {
      path: "/api/backup/preview", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ bundle: exportedBundle }),
    });
    assert.strictEqual(backupPreview.status, 200, backupPreview.body);
    assert.strictEqual(JSON.parse(backupPreview.body).dryRun, true);
    assert.strictEqual(JSON.parse(backupPreview.body).modified, false);
    const cancelPrepare = await request(port, {
      path: "/api/backup/prepare", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ requestId: crypto.randomUUID(), bundle: exportedBundle }),
    });
    assert.strictEqual(cancelPrepare.status, 201, cancelPrepare.body);
    const cancelTransactionId = JSON.parse(cancelPrepare.body).transactionId;
    const cancelRequestId = crypto.randomUUID();
    const cancelled = await request(port, {
      path: "/api/backup/cancel", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ requestId: cancelRequestId, transactionId: cancelTransactionId }),
    });
    assert.strictEqual(cancelled.status, 200, cancelled.body);
    const cancelReplay = await request(port, {
      path: "/api/backup/cancel", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ requestId: cancelRequestId, transactionId: cancelTransactionId }),
    });
    assert.deepStrictEqual(JSON.parse(cancelReplay.body), JSON.parse(cancelled.body));
    const commitPrepare = await request(port, {
      path: "/api/backup/prepare", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ requestId: crypto.randomUUID(), bundle: exportedBundle }),
    });
    assert.strictEqual(commitPrepare.status, 201, commitPrepare.body);
    const commitTransactionId = JSON.parse(commitPrepare.body).transactionId;
    const commitStatus = JSON.parse((await request(port, { path: "/api/recovery/status", headers: { Cookie: cookie } })).body);
    const commitConfirmation = commitStatus.confirmations.find(item => item.action === "backup/commit" && item.targetKey === commitTransactionId);
    assert.ok(commitConfirmation);
    const commitRequestId = crypto.randomUUID();
    const committed = await request(port, {
      path: "/api/backup/commit", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ requestId: commitRequestId, transactionId: commitTransactionId, confirmationToken: commitConfirmation.token }),
    });
    assert.strictEqual(committed.status, 200, committed.body);
    assert.strictEqual(JSON.parse(committed.body).verified, true);
    const committedReplay = await request(port, {
      path: "/api/backup/commit", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ requestId: commitRequestId, transactionId: commitTransactionId, confirmationToken: commitConfirmation.token }),
    });
    assert.deepStrictEqual(JSON.parse(committedReplay.body), JSON.parse(committed.body));
    const interruptedJournalFile = path.join(root, ".linggan", "import-transactions", commitTransactionId, "transaction.json");
    const interruptedJournal = JSON.parse(fs.readFileSync(interruptedJournalFile, "utf8"));
    interruptedJournal.state = "manual_recovery";
    interruptedJournal.terminalResult = null;
    fs.writeFileSync(interruptedJournalFile, JSON.stringify(interruptedJournal), "utf8");
    const interruptedStatus = JSON.parse((await request(port, { path: "/api/recovery/status", headers: { Cookie: cookie } })).body);
    assert.strictEqual(interruptedStatus.selection, "selected");
    assert.strictEqual(interruptedStatus.state, "action_required");
    const oldCandidate = interruptedStatus.transactions.find(item => item.transactionId === commitTransactionId).candidates.find(item => item.kind === "old");
    assert.ok(oldCandidate, JSON.stringify(interruptedStatus));
    const forgedCandidate = await request(port, {
      path: "/api/recovery/preview", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ transactionId: commitTransactionId, candidateName: "..\\forged" }),
    });
    assert.strictEqual(forgedCandidate.status, 400);
    const recoveryPreview = await request(port, {
      path: "/api/recovery/preview", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ transactionId: commitTransactionId, candidateName: oldCandidate.name }),
    });
    assert.strictEqual(recoveryPreview.status, 200, recoveryPreview.body);
    assert.strictEqual(JSON.parse(recoveryPreview.body).modified, false);
    const restoreStatus = JSON.parse((await request(port, { path: "/api/recovery/status", headers: { Cookie: cookie } })).body);
    const restoreKey = commitTransactionId + ":" + oldCandidate.name;
    const restoreConfirmation = restoreStatus.confirmations.find(item => item.action === "restore-old" && item.targetKey === restoreKey);
    assert.ok(restoreConfirmation);
    const restoreRequestId = crypto.randomUUID();
    const restoreBody = JSON.stringify({ requestId: restoreRequestId, transactionId: commitTransactionId, candidateName: oldCandidate.name, confirmationToken: restoreConfirmation.token });
    const restored = await request(port, { path: "/api/recovery/restore-old", method: "POST", headers: writeHeaders, body: restoreBody });
    assert.strictEqual(restored.status, 200, restored.body);
    assert.strictEqual(JSON.parse(restored.body).verified, true);
    const restoreReplay = await request(port, { path: "/api/recovery/restore-old", method: "POST", headers: writeHeaders, body: restoreBody });
    assert.deepStrictEqual(JSON.parse(restoreReplay.body), JSON.parse(restored.body));
    const recoveryPrepareRequestId = crypto.randomUUID();
    const recoveryPrepare = await request(port, {
      path: "/api/recovery/import/prepare", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ requestId: recoveryPrepareRequestId, bundle: exportedBundle }),
    });
    assert.strictEqual(recoveryPrepare.status, 200, recoveryPrepare.body);
    const preparedRecovery = JSON.parse(recoveryPrepare.body);
    assert.strictEqual(preparedRecovery.dryRun, true);
    const preparedReplay = await request(port, {
      path: "/api/recovery/import/prepare", method: "POST", headers: writeHeaders,
      body: JSON.stringify({ requestId: recoveryPrepareRequestId, bundle: exportedBundle }),
    });
    assert.deepStrictEqual(JSON.parse(preparedReplay.body), preparedRecovery, "恢复 prepare 必须幂等");
    const recoveryStatus = await request(port, { path: "/api/recovery/status", headers: { Cookie: cookie } });
    assert.strictEqual(recoveryStatus.status, 200, recoveryStatus.body);
    const recoveryStatusData = JSON.parse(recoveryStatus.body);
    assert.ok(["action_required", "ambiguous"].includes(recoveryStatusData.state));
    const importConfirmation = recoveryStatusData.confirmations.find(item => item.action === "recovery/import" && item.targetKey === preparedRecovery.recoveryPrepareId);
    assert.ok(importConfirmation, "暂存验证后必须由状态接口签发绑定确认");
    const recoveryCommitRequestId = crypto.randomUUID();
    const recoveryCommitBody = JSON.stringify({
      requestId: recoveryCommitRequestId,
      recoveryPrepareId: preparedRecovery.recoveryPrepareId,
      confirmationToken: importConfirmation.token,
    });
    const recoveryCommit = await request(port, { path: "/api/recovery/import", method: "POST", headers: writeHeaders, body: recoveryCommitBody });
    assert.strictEqual(recoveryCommit.status, 200, recoveryCommit.body);
    const recoveryCommitData = JSON.parse(recoveryCommit.body);
    assert.strictEqual(recoveryCommitData.verified, true);
    assert.strictEqual(recoveryCommitData.receipt, "committed");
    const recoveryReplay = await request(port, { path: "/api/recovery/import", method: "POST", headers: writeHeaders, body: recoveryCommitBody });
    assert.deepStrictEqual(JSON.parse(recoveryReplay.body), recoveryCommitData, "确认型恢复重复请求必须重放已验证结果");
    const verifiedState = await request(port, { path: "/api/state", headers: { Cookie: cookie } });
    assert.strictEqual(JSON.parse(verifiedState.body).state, "verified");

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
      body: JSON.stringify({ note: "x".repeat(2000) }),
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

    const missingLegacyIdentity = await request(port, {
      path: "/api/status", method: "POST",
      headers: { Cookie: cookie, Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json", "Idempotency-Key": "bad" },
      body: JSON.stringify({ id: "1.1", status: "⏳" }),
    });
    assert.strictEqual(missingLegacyIdentity.status, 400);
    assert.strictEqual(JSON.parse(missingLegacyIdentity.body).code, "invalid_request");
    const sharedLegacyId = crypto.randomUUID();
    const legacyFirst = await request(port, {
      path: "/api/status", method: "POST",
      headers: { Cookie: cookie, Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json", "Idempotency-Key": sharedLegacyId },
      body: JSON.stringify({ id: "1.1", status: "⏳" }),
    });
    assert.strictEqual(legacyFirst.status, 200);
    const legacyConflict = await request(port, {
      path: "/api/note", method: "POST",
      headers: { Cookie: cookie, Origin: "http://127.0.0.1:" + port, "Content-Type": "application/json", "Idempotency-Key": sharedLegacyId },
      body: JSON.stringify({ id: "1.1", note: "conflict" }),
    });
    assert.strictEqual(legacyConflict.status, 409);
    assert.strictEqual(JSON.parse(legacyConflict.body).code, "idempotency_conflict");

    const auditLines = fs.readFileSync(auditFile, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(auditLines.some(entry => entry.route === "/api/status" && entry.status === 200));
    assert.ok(auditLines.every(entry => !Object.prototype.hasOwnProperty.call(entry, "body")));

    let limited;
    for (let i = 0; i < 180; i++) {
      limited = await request(port, { path: "/api/diagnostics", headers: { Cookie: cookie } });
      if (limited.status === 429) break;
    }
    assert.strictEqual(limited.status, 429);
    assert.ok(Number(limited.headers["retry-after"]) >= 1);

    const sessionShutdown = await request(port, {
      path: "/api/control/shutdown",
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://127.0.0.1:" + port },
    });
    assert.strictEqual(sessionShutdown.status, 403, "浏览器会话不能控制服务生命周期");

    const wrongMethod = await request(port, {
      path: "/api/control/shutdown",
      headers: { "X-Linggan-Token": "server-test-token" },
    });
    assert.strictEqual(wrongMethod.status, 405);
    assert.strictEqual(wrongMethod.headers.allow, "POST");

    const gracefulExit = waitForExit(child);
    const gracefulShutdown = await request(port, {
      path: "/api/control/shutdown",
      method: "POST",
      headers: { "X-Linggan-Token": "server-test-token" },
    });
    assert.strictEqual(gracefulShutdown.status, 202, "生命周期控制不应受普通 API 限流影响");
    assert.strictEqual(JSON.parse(gracefulShutdown.body).shuttingDown, true);
    stopped = await gracefulExit;
    assert.strictEqual(stopped.code, 0, "认证关闭请求应优雅停止服务");
    await exerciseTrustedHelpers(root, dataFile);
  } finally {
    if (!stopped && child.exitCode === null && child.signalCode === null) {
      const forcedExit = waitForExit(child);
      child.kill("SIGTERM");
      stopped = await forcedExit;
    }
    if (stopped) {
      assert.ok(
        stopped.code === 0 || (process.platform === "win32" && stopped.signal === "SIGTERM"),
        "服务应正常停止"
      );
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("server: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
