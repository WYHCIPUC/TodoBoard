/* ============================================================
 * 灵感来袭 · 待办看板 本地服务
 * Node 本地服务：静态托管 + 链接元数据抓取 + 读写 DATA.md
 *
 * 启动：node server.js   （或双击 start.bat）
 *
 * 业务逻辑已下沉到 lib/：
 *   lib/fetcher.js      抓取 + 兜底解析 + 代理探测 + 解析日志
 *   lib/store.js        DATA.md 读写 / 备份 / 条目纯函数
 *   lib/classifier.js   分类 + 来源识别
 *   lib/constants.js    分类体系常量
 *
 * API：
 *   GET  /api/data                读取 DATA.md 内容
 *   GET  /api/fetch-meta?url=xxx  抓取链接元数据（预览，不写入）
 *   POST /api/add                 新增条目，直接写入 DATA.md
 *   POST /api/merge               合并重复条目的标签与收藏原因
 *   POST /api/delete              按编号删除条目
 *   POST /api/status              更新条目状态（⏳/🔄/✅）
 *   POST /api/note                更新条目研究要点
 *   POST /api/restore             从浏览器备份恢复 DATA.md
 *   POST /api/bookmarks/preview   预检浏览器书签 HTML
 *   POST /api/bookmarks/import    批量导入浏览器书签到收件箱
 *   其他                          静态服务 board.html
 *
 * 可用环境变量：
 *   PORT        端口（默认 3865）
 *   README_FILE 数据文件路径（默认同目录 DATA.md；首次运行自动从 DATA.example.md 初始化）
 *   HTML_FILE   看板页面路径（默认同目录 board.html）
 *   NO_OPEN=1   不自动打开浏览器
 *   FETCH_LOG_FILE 解析记录日志路径（默认 docs/fetch-log.md，由 lib/fetcher 使用）
 *   API_RATE_LIMIT 数据 API 每分钟请求上限（默认 300）
 *   EXPENSIVE_RATE_LIMIT 抓取类 API 每分钟请求上限（默认 30）
 *   AUDIT_LOG_FILE 操作审计日志路径（默认数据目录 .linggan/audit.log，不记录正文和 URL）
 *   LINGGAN_API_TOKEN 显式 API 令牌（桌面启动器用于本地生命周期控制）
 * ============================================================ */
"use strict";
/* c8 ignore start -- T4 coverage begins at the trusted API seam below; the legacy server is regression-tested separately. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const fetcher = require("./lib/fetcher");
const store = require("./lib/store");
const entries = require("./lib/entries");
const migrate = require("./lib/migrate");
const schema = require("./lib/schema");
const trash = require("./lib/trash");
const auth = require("./lib/auth");
const search = require("./lib/search");
const backup = require("./lib/backup");
const packageInfo = require("./package.json");
const scraper = require("./lib/scraper");
const capture = require("./lib/capture");
const wecom = require("./lib/wecom");
const dingtalk = require("./lib/dingtalk");
const { createRateLimiter } = require("./lib/ratelimit");
const audit = require("./lib/audit");
const bookmarks = require("./lib/bookmarks");
const health = require("./lib/health");
const brainstorm = require("./lib/brainstorm");
const brainstormHistory = require("./lib/brainstorm-history");
const attention = require("./lib/attention");
const lifecycle = require("./lib/lifecycle");
const archiveIntegrity = require("./lib/archive-integrity");
const upgrade = require("./lib/upgrade");
const bootstrap = require("./lib/bootstrap");
const instanceLock = require("./lib/instance-lock");
const { createErrorLog } = require("./lib/error-log");
const { RecoveryService, ConfirmationTokens } = require("./lib/recovery");
const { UUID_RE, sha256 } = require("./lib/backup-format");
const { IdempotencyStore, canonicalRequestHash } = require("./lib/idempotency");
const { defaultCoordinator } = require("./lib/maintenance");
const { loadNativeBinding } = require("./lib/volume-lock");
const { openBrowser } = require("./scripts/open-browser");

const PORT = Number(process.env.PORT) || 3865;
const HOST = process.env.HOST || "127.0.0.1"; // 默认仅本机访问；非本机数据 API 仍需显式令牌
const JSON_BODY_LIMIT = Number(process.env.JSON_BODY_LIMIT) || 1024 * 1024;
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS) || 60 * 1000;
const apiLimiter = createRateLimiter({ limit: Number(process.env.API_RATE_LIMIT) || 300, windowMs: RATE_WINDOW_MS });
const expensiveLimiter = createRateLimiter({ limit: Number(process.env.EXPENSIVE_RATE_LIMIT) || 30, windowMs: RATE_WINDOW_MS });
const DIR = __dirname;
const README = process.env.README_FILE
  ? path.resolve(process.env.README_FILE)
  : path.join(DIR, "DATA.md");
const HTML_FILE = process.env.HTML_FILE
  ? path.resolve(process.env.HTML_FILE)
  : path.join(DIR, "board.html");

/* 启动前只读检查：区分全新安装、已有数据和无法安全自动处理的状态。 */
function startupInstallState() {
  return bootstrap.inspectInstall(upgrade.resolvePaths({
    dataFile: README,
    entriesDir: entries.ENTRIES_DIR,
    controlDir: store.CONTROL_DIR,
  }));
}

/*
 * 数据文件缺失但仍有研究档案或运行数据时，禁止用示例数据“初始化”：
 * 那会把用户数据变成不可见的孤立档案，并让后续写入基于空看板。
 * 版本过新或损坏时同样停在只读错误，先让用户保全证据。
 */
function assertSafeStartup() {
  const install = startupInstallState();
  if (install.state === "data_missing") {
    console.error("\n  [错误] 未找到数据文件，但检测到已有研究档案或运行数据。");
    console.error("  为避免用示例数据掩盖现有数据，服务未启动，也没有创建新的 DATA.md。");
    console.error("  请先复制整个数据目录，从备份恢复 DATA.md；如确认是全新安装，请移走现有 entries/.linggan 后重试。");
    process.exit(1);
  }
  if (install.state === "corrupt") {
    console.error("\n  [错误] 数据文件存在但无法读取，服务未启动：" + install.error);
    console.error("  请先备份整个数据目录并检查 DATA.md 的编码与权限。");
    process.exit(1);
  }
  if (install.state === "downgrade_rejected") {
    console.error("\n  [错误] 数据格式版本（v" + install.version + "）高于当前程序支持的版本。");
    console.error("  请升级到更新的安装包后再启动，旧程序不会改写新数据。");
    process.exit(1);
  }
}

/* 同一数据目录只允许一个实例；正常退出在 exit 处理器中释放。 */
let activeInstanceLock = null;
function acquireStartupLock() {
  try {
    activeInstanceLock = instanceLock.acquireInstanceLock(store.CONTROL_DIR);
  } catch (error) {
    if (error.code === "data_in_use") {
      const owner = error.details || {};
      console.error("\n  [错误] 另一个灵感工作台实例正在使用同一数据目录（PID " + (owner.pid || "未知") + "）。");
      console.error("  请先关闭旧实例；若旧进程已退出，等待 2 分钟后重试，服务会只读隔离陈旧锁。");
    } else if (error.code === "instance_lock_invalid") {
      console.error("\n  [错误] 实例锁内容无法验证，服务未启动。");
      console.error("  请确认没有其他实例后，检查并移走 " + path.join(store.CONTROL_DIR, "instance.lock") + "。");
    } else {
      console.error("\n  [错误] 无法取得实例锁，服务未启动：" + error.message);
    }
    process.exit(1);
  }
}

/* 首次运行：数据文件不存在时从 DATA.example.md 初始化 */
function ensureDataFile() {
  if (fs.existsSync(README)) return;
  const example = path.join(DIR, "DATA.example.md");
  if (!fs.existsSync(example)) return;
  try {
    fs.mkdirSync(path.dirname(README), { recursive: true });
    fs.copyFileSync(example, README);
    console.log("  数据文件不存在，已从 DATA.example.md 初始化");
  } catch (e) { recordError("initData", e); }
}

/* 服务错误日志跟随用户数据目录，升级程序时不会丢失；超过 1 MiB 轮换上一份。 */
const ERROR_LOG = process.env.SERVER_ERROR_LOG_FILE
  ? path.resolve(process.env.SERVER_ERROR_LOG_FILE)
  : path.join(path.dirname(README), ".linggan", "server-error.log");
const errorLog = createErrorLog({ file: ERROR_LOG });
function recordError(tag, e) {
  errorLog.record(tag, e);
}
/* ============================================================
 * HTTP 服务
 * ============================================================ */
function sendJson(res, code, obj, extraHeaders) {
  res.writeHead(code, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  }, extraHeaders || {}));
  res.end(JSON.stringify(obj));
}

function sendText(res, code, text) {
  res.writeHead(code, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  res.end(text);
}

function requestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isLoopbackRequest(req) {
  const address = String(req.socket && req.socket.remoteAddress || "").toLowerCase();
  return address === "::1" || /^(?:::ffff:)?127(?:\.\d{1,3}){3}$/.test(address);
}

function readBody(req, limit) {
  limit = limit || 1024 * 1024;
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > limit) {
      req.resume();
      reject(requestError("请求内容超过限制", 413));
      return;
    }
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on("data", chunk => {
      total += chunk.length;
      if (total > limit) { tooLarge = true; return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) reject(requestError("请求内容超过限制", 413));
      else resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", reject);
  });
}

async function readJson(req, limit) {
  const body = await readBody(req, limit || JSON_BODY_LIMIT);
  try { return JSON.parse(body || "{}"); }
  catch (_) { throw requestError("请求 JSON 格式错误", 400); }
}

function handleJson(req, res, handler, limit) {
  readJson(req, limit)
    .then(handler)
    .catch(error => {
      if (!res.writableEnded) {
        sendJson(res, error.statusCode || 500, { ok: false, error: error.message || String(error) });
      }
    });
}

/* c8 ignore stop */

/* ============================================================
 * v2.2 可信状态与恢复 API
 *
 * 这里仅做协议编排；所有写入都委托给 T2/T3 的事务、恢复和生命周期层。
 * ============================================================ */
const TRUSTED_STATES = Object.freeze({
  healthy: { message: "数据已验证，可以正常使用", severity: "ok" },
  action_required: { message: "需要确认下一步操作", severity: "warning" },
  locked: { message: "数据正在被另一个受信操作使用", severity: "warning" },
  ambiguous: { message: "存在多个恢复候选，需要明确选择", severity: "danger" },
  upgrade_required: { message: "需要完成受信升级后才能继续", severity: "warning" },
  in_progress: { message: "正在执行受信操作，请保持应用开启", severity: "progress" },
  verified: { message: "操作已完成并通过写后验证", severity: "ok" },
  failed: { message: "操作未能安全完成，现有数据未被判定为可替换", severity: "danger" },
});
const V2_BODY_ID_ROUTES = new Set([
  "/api/lifecycle", "/api/backup/prepare", "/api/backup/commit", "/api/backup/cancel",
  "/api/recovery/retry", "/api/recovery/restore-old", "/api/recovery/import/prepare", "/api/recovery/import",
]);
const legacyRequestKeys = new Map();

const DOMAIN_HTTP = Object.freeze({
  invalid_request: 400,
  invalid_bundle: 400,
  unsupported_version: 400,
  invalid_path: 400,
  invalid_timestamp: 400,
  invalid_storage_topology: 409,
  checksum_mismatch: 400,
  data_missing: 404,
  entry_not_found: 404,
  transaction_not_found: 404,
  snapshot_not_found: 404,
  bundle_too_large: 413,
  transaction_expired: 410,
  transaction_busy: 409,
  state_changed: 409,
  idempotency_conflict: 409,
  idempotency_recovery_required: 409,
  data_in_use: 409,
  legacy_instance_may_be_running: 409,
  snapshot_not_restorable: 409,
  stale_lock_not_proven: 409,
  maintenance_locked: 423,
  maintenance_mode: 503,
  maintenance_timeout: 503,
  insufficient_space: 507,
  commit_failed_rolled_back: 500,
  manual_recovery_required: 500,
  invalid_lifecycle: 409,
  attention_unavailable: 500,
  export_failed: 500,
});

const DOMAIN_MESSAGES = Object.freeze({
  invalid_request: "请求字段无效",
  invalid_bundle: "备份包格式无效",
  unsupported_version: "数据版本不受支持",
  invalid_path: "备份包包含不安全路径",
  invalid_timestamp: "时间格式无效",
  invalid_storage_topology: "本地数据目录拓扑不安全",
  checksum_mismatch: "备份校验不一致",
  bundle_too_large: "备份包超过大小限制",
  insufficient_space: "目标磁盘空间不足",
  data_missing: "本地数据不存在",
  entry_not_found: "条目不存在",
  transaction_not_found: "事务不存在",
  snapshot_not_found: "升级快照不存在",
  snapshot_not_restorable: "升级快照不可恢复",
  transaction_busy: "已有受信操作正在进行",
  transaction_expired: "事务已过期，请重新预览",
  state_changed: "预览后数据已变化，请重新预览",
  idempotency_conflict: "请求标识已用于其他操作",
  idempotency_recovery_required: "请求收据需要人工恢复",
  data_in_use: "本地数据正被其他实例使用",
  legacy_instance_may_be_running: "旧实例可能仍在运行",
  stale_lock_not_proven: "无法证明锁已失效",
  maintenance_locked: "维护正在等待，暂不接受新写入",
  maintenance_mode: "维护交换正在进行",
  maintenance_timeout: "等待安全维护窗口超时",
  commit_failed_rolled_back: "提交失败，已恢复到验证过的旧状态",
  manual_recovery_required: "无法自动判定安全状态，需要人工恢复",
  invalid_lifecycle: "生命周期数据需要先修复",
  attention_unavailable: "待处理列表暂不可用",
  export_failed: "备份导出失败",
});

function publicDetails(details) {
  if (!details || typeof details !== "object") return null;
  const allowed = new Set(["state", "scope", "scopes", "needed", "available", "requestIds", "reasonCodes"]);
  const output = {};
  for (const [key, value] of Object.entries(details)) {
    if (!allowed.has(key)) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) output[key] = value;
    else if (Array.isArray(value)) output[key] = value.map(item => String(item).slice(0, 120));
  }
  return Object.keys(output).length ? output : null;
}

function sendDomainError(res, error, requestId) {
  const hinted = error && error.code || error && error.statusCode === 413 && "bundle_too_large" || error && error.statusCode === 400 && "invalid_request";
  const code = hinted && DOMAIN_HTTP[hinted] ? hinted : "manual_recovery_required";
  sendJson(res, DOMAIN_HTTP[code] || 500, {
    ok: false,
    code,
    message: DOMAIN_MESSAGES[code] || "操作未能安全完成",
    requestId: UUID_RE.test(requestId || "") ? requestId.toLowerCase() : null,
    details: publicDetails(error && error.details),
  }, code === "maintenance_mode" ? { "Retry-After": "2" } : undefined);
}

function requireUuid(value, field) {
  const normalized = String(value || "").toLowerCase();
  if (!UUID_RE.test(normalized)) {
    const error = new Error((field || "requestId") + " 必须是 UUID");
    error.code = "invalid_request";
    throw error;
  }
  return normalized;
}

function bundleSummary(bundle) {
  const summary = backup.summary(bundle);
  return {
    formatVersion: summary.formatVersion,
    dataVersion: summary.dataVersion,
    entryCount: summary.entryCount,
    fileCount: summary.fileCount,
    totalBytes: summary.totalBytes,
    scopes: summary.scopes,
  };
}

function createTrustedServices(overrides = {}) {
  const paths = overrides.paths || backup.defaultPaths();
  const coordinator = overrides.coordinator || defaultCoordinator;
  let nativeBinding = overrides.nativeBinding;
  if (!nativeBinding) {
    try { nativeBinding = loadNativeBinding(); } catch (_) { nativeBinding = null; }
  }
  const manager = overrides.manager || backup.createManager({
    dataFile: paths.data,
    entriesDir: paths.entries,
    brainstormDir: paths.brainstorms,
    trashDir: paths.trash,
    orphansDir: paths.orphans,
    controlDir: paths.controlDir,
    coordinator,
    nativeBinding: nativeBinding || undefined,
    volumeIdProvider: nativeBinding ? value => nativeBinding.getVolumeId(value) : undefined,
  });
  const idempotency = overrides.idempotency || new IdempotencyStore(path.join(paths.controlDir, "idempotency"));
  return {
    paths,
    coordinator,
    manager,
    idempotency,
    recovery: overrides.recovery || new RecoveryService(manager, { idempotency }),
    confirmations: overrides.confirmations || new ConfirmationTokens(),
    recoveryPreviews: overrides.recoveryPreviews || new Map(),
    inFlightOperations: overrides.inFlightOperations || new Map(),
    lastVerified: null,
  };
}

let trustedServices = null;
function services() {
  if (!trustedServices) trustedServices = createTrustedServices();
  return trustedServices;
}

function transactionFingerprint(journal) {
  return sha256(Buffer.from(JSON.stringify({
    id: journal.id,
    state: journal.state,
    liveFingerprint: journal.liveFingerprint,
    bundleSha256: journal.bundleSha256,
  })));
}

function actionableRecoveryTransactions(status) {
  return (status && status.transactions || []).filter(item => !["completed", "cancelled", "expired"].includes(item.state));
}

function trustedStateModel(api) {
  const maintenance = api.coordinator.status();
  let recoveryStatus;
  try { recoveryStatus = api.recovery.status(); }
  catch (error) {
    return { state: "failed", condition: TRUSTED_STATES.failed, maintenance, recovery: null, code: error.code || "manual_recovery_required" };
  }
  let state = "healthy";
  const actionable = actionableRecoveryTransactions(recoveryStatus);
  const selectedCount = actionable.filter(item => item.selection === "selected").length;
  const ambiguous = actionable.some(item => item.selection === "ambiguous") || selectedCount > 1;
  if (maintenance.mode === "waiting") state = "locked";
  else if (maintenance.mode === "maintenance") state = "in_progress";
  else if (ambiguous) state = "ambiguous";
  else if (recoveryStatus.activeRecoveryImport) {
    const activeState = recoveryStatus.activeRecoveryImport.state;
    state = ["completed", "rescue_rolled_back"].includes(activeState) ? "verified" :
      activeState === "prepared" ? "action_required" : "in_progress";
  } else if (recoveryStatus.state === "recovery_required") state = "action_required";
  else if (api.lastVerified) state = "verified";
  try {
    const dataVersion = schema.getDataVersion(store.readAll());
    if (dataVersion < schema.DATA_VERSION && state === "healthy") state = "upgrade_required";
  } catch (_) { state = "failed"; }
  return {
    state,
    condition: TRUSTED_STATES[state],
    maintenance,
    recovery: recoveryStatus,
    verifiedAt: api.lastVerified,
  };
}

function recoveryConfirmations(api, status) {
  const confirmations = [];
  for (const [key, preview] of api.recoveryPreviews) {
    try {
      const inspection = api.recovery.inspect(preview.transactionId);
      const current = inspection.candidates.find(item => item.name === preview.candidateName);
      if (!current || current.fingerprint !== preview.fingerprint) {
        api.recoveryPreviews.delete(key);
        continue;
      }
      const issued = api.recovery.issueRestoreToken(preview.transactionId, preview.candidateName);
      confirmations.push({
        action: "restore-old",
        targetKey: key,
        token: issued.token,
        expiresAt: issued.expiresAt,
        stateFingerprint: current.fingerprint,
      });
    } catch (_) { api.recoveryPreviews.delete(key); }
  }
  const activeId = status.activeRecoveryImport && status.activeRecoveryImport.activeRecoveryImportId;
  if (activeId && status.activeRecoveryImport.state === "prepared") {
    try {
      const issued = api.recovery.issueImportToken(activeId);
      confirmations.push({ action: "recovery/import", targetKey: activeId, token: issued.token, expiresAt: issued.expiresAt, stateFingerprint: null });
    } catch (_) {}
  }
  for (const transactionId of api.recovery.transactionIds()) {
    try {
      const journal = api.manager.load(transactionId);
      if (journal.state !== "prepared") continue;
      const fingerprint = transactionFingerprint(journal);
      const issued = api.confirmations.issue("backup/commit", transactionId, fingerprint);
      confirmations.push({ action: "backup/commit", targetKey: transactionId, token: issued.token, expiresAt: issued.expiresAt, stateFingerprint: fingerprint });
    } catch (_) {}
  }
  return confirmations;
}

function publicRecoveryStatus(api) {
  const state = trustedStateModel(api);
  const raw = state.recovery || { state: "recovery_required", selection: "none", transactions: [], activeRecoveryImport: null };
  const transactions = actionableRecoveryTransactions(raw);
  const selected = transactions.filter(item => item.selection === "selected");
  const selection = transactions.some(item => item.selection === "ambiguous") || selected.length > 1 ? "ambiguous" : selected.length === 1 ? "selected" : "none";
  const confirmations = recoveryConfirmations(api, raw);
  const allowedActions = ["diagnostics"];
  if (transactions.length) allowedActions.push("retry");
  if (confirmations.some(item => item.action === "restore-old")) allowedActions.push("restore-old");
  if (!raw.activeRecoveryImport) allowedActions.push("recovery/import/prepare");
  if (confirmations.some(item => item.action === "recovery/import")) allowedActions.push("recovery/import");
  if (confirmations.some(item => item.action === "backup/commit")) allowedActions.push("backup/commit");
  return {
    ok: true,
    state: state.state,
    condition: state.condition,
    transactionId: raw.suggestedTransaction || null,
    selection,
    transactions,
    activeRecoveryImport: raw.activeRecoveryImport,
    upgradeSnapshots: upgrade.listUpgradeSnapshots({
      dataFile: api.paths.data,
      entriesDir: api.paths.entries,
      brainstormsDir: api.paths.brainstorms,
      trashDir: api.paths.trash,
      orphansDir: api.paths.orphans,
      controlDir: api.paths.controlDir,
    }),
    staleLocks: [],
    allowedActions: [...new Set(allowedActions)],
    confirmations,
    maintenance: state.maintenance,
    verifiedAt: state.verifiedAt,
  };
}

async function runIdempotent(api, requestId, action, values, work) {
  const expectedHash = canonicalRequestHash(action, values);
  const inFlightOperations = api.inFlightOperations || (api.inFlightOperations = new Map());
  const active = inFlightOperations.get(requestId);
  if (active) {
    if (active.action !== action || active.requestHash !== expectedHash) {
      const error = new Error("requestId conflict");
      error.code = "idempotency_conflict";
      throw error;
    }
    const completed = await active.promise;
    return { ...completed, replay: true };
  }

  const existing = api.idempotency.get(requestId);
  if (existing) {
    if (existing.action !== action || existing.requestHash !== expectedHash) {
      const error = new Error("requestId conflict");
      error.code = "idempotency_conflict";
      throw error;
    }
    if (existing.state === "committed") return { status: existing.httpStatus, response: existing.response, replay: true };
  } else api.idempotency.begin({ requestId, action, values });

  const operation = (async () => {
    const completed = await work();
    const response = { ok: true, ...completed, operationId: requestId, receipt: "committed" };
    api.idempotency.commit(requestId, 200, response);
    return { status: 200, response, replay: false };
  })();
  inFlightOperations.set(requestId, { action, requestHash: expectedHash, promise: operation });
  try {
    return await operation;
  } finally {
    if (inFlightOperations.get(requestId)?.promise === operation) inFlightOperations.delete(requestId);
  }
}

function archiveStatuses(api, dataText) {
  const parsed = schema.validateData(dataText === undefined ? store.readAll() : dataText);
  return parsed.entries.map(entry => {
    const task = capture.getArchiveStatus(entry.id) || {};
    const entryRoot = path.join(api.paths.entries, entry.uid || entry.id);
    const integrity = archiveIntegrity.scanArchive(entryRoot, { uid: entry.uid });
    return {
      id: entry.id,
      uid: entry.uid,
      state: task.state || (integrity.state === "healthy" ? "succeeded" : "not_archived"),
      attempt: Number(task.attempt || 0),
      nextRunAt: task.nextRunAt || task.nextRetryAt || null,
      // 批量接口只暴露稳定 code 与截断后的短消息；逐条接口仍返回队列原文。
      lastError: task.lastError
        ? { code: String(task.lastError.code || "archive_failed"), message: String(task.lastError).slice(0, 240) }
        : null,
      active: { state: integrity.state === "healthy" ? "available" : null, snapshotId: integrity.snapshotId, quality: null },
      integrity: { state: integrity.state, reasonCodes: integrity.reasonCodes, checkedAt: integrity.checkedAt, snapshotId: integrity.snapshotId },
    };
  });
}

function trustedApiHandler(api, req, res, url) {
  const route = url.pathname;
  const method = req.method || "GET";
  const key = method + " " + route;
  const known = route === "/api/health" || route === "/api/state" || route === "/api/attention" || route === "/api/lifecycle" ||
    route === "/api/archive/statuses" || route === "/api/archive/integrity/check" || route.startsWith("/api/backup/") ||
    route.startsWith("/api/recovery/") || route.startsWith("/api/maintenance/") || route.startsWith("/api/upgrade/");
  if (!known) return false;

  const respond = work => Promise.resolve().then(work).catch(error => {
    if (!res.writableEnded) sendDomainError(res, error, error.requestId);
  });

  if (key === "GET /api/health" || key === "GET /api/state") {
    respond(() => sendJson(res, 200, { ok: true, ...trustedStateModel(api) }));
    return true;
  }
  if (key === "GET /api/maintenance/status") {
    respond(() => sendJson(res, 200, { ok: true, ...api.coordinator.status() }));
    return true;
  }
  if (key === "GET /api/upgrade/status") {
    respond(() => sendJson(res, 200, { ok: true, state: trustedStateModel(api).state, snapshots: publicRecoveryStatus(api).upgradeSnapshots }));
    return true;
  }
  if (key === "POST /api/upgrade/preview") {
    respond(async () => {
      const data = await readJson(req);
      sendJson(res, 200, { ok: true, dryRun: true, requestId: data.requestId || null, state: trustedStateModel(api).state,
        snapshots: publicRecoveryStatus(api).upgradeSnapshots, mutatesData: false });
    });
    return true;
  }
  if (key === "GET /api/recovery/status") {
    respond(() => sendJson(res, 200, publicRecoveryStatus(api)));
    return true;
  }
  if (key === "GET /api/recovery/diagnostics") {
    respond(() => {
      const status = publicRecoveryStatus(api);
      sendJson(res, 200, { ok: true, generatedAt: new Date().toISOString(), state: status.state, selection: status.selection,
        transactions: status.transactions.map(item => ({ transactionId: item.transactionId, state: item.state, selection: item.selection })),
        maintenance: status.maintenance, upgradeSnapshots: status.upgradeSnapshots });
    });
    return true;
  }
  if (key === "POST /api/recovery/preview") {
    respond(async () => {
      const data = await readJson(req);
      const transactionId = requireUuid(data.transactionId, "transactionId");
      const candidateName = String(data.candidateName || "");
      const inspection = api.recovery.inspect(transactionId);
      const candidate = inspection.candidates.find(item => item.name === candidateName && item.kind === "old");
      if (!candidate) { const error = new Error("candidate invalid"); error.code = "invalid_request"; throw error; }
      const targetKey = transactionId + ":" + candidateName;
      api.recoveryPreviews.set(targetKey, { transactionId, candidateName, fingerprint: candidate.fingerprint });
      sendJson(res, 200, { ok: true, dryRun: true, modified: false, targetKey, transactionId, candidate: {
        name: candidate.name, kind: candidate.kind, completeScopes: candidate.completeScopes, fingerprint: candidate.fingerprint,
      }, requiresConfirmation: true });
    });
    return true;
  }
  if (key === "POST /api/recovery/restore-old") {
    respond(async () => {
      const data = await readJson(req);
      const requestId = requireUuid(data.requestId);
      const transactionId = requireUuid(data.transactionId, "transactionId");
      const candidateName = String(data.candidateName || "");
      const replayed = api.recovery.replay(requestId, "recovery.restore-old", { transactionId });
      if (replayed) { sendJson(res, 200, { ok: true, verified: true, ...replayed }); return; }
      const targetKey = transactionId + ":" + candidateName;
      if (!api.recoveryPreviews.has(targetKey)) { const error = new Error("preview required"); error.code = "state_changed"; error.requestId = requestId; throw error; }
      const result = await api.recovery.restoreOld(transactionId, candidateName, String(data.confirmationToken || ""), { requestId });
      api.recoveryPreviews.delete(targetKey);
      api.lastVerified = new Date().toISOString();
      sendJson(res, 200, { ok: true, verified: true, ...result });
    });
    return true;
  }
  if (key === "POST /api/recovery/retry") {
    respond(async () => {
      const data = await readJson(req);
      const requestId = requireUuid(data.requestId);
      const transactionId = data.transactionId === null ? null : requireUuid(data.transactionId, "transactionId");
      if (!transactionId) { const error = new Error("transaction missing"); error.code = "transaction_not_found"; error.requestId = requestId; throw error; }
      const completed = await runIdempotent(api, requestId, "recovery.retry", { transactionId }, () => api.manager.recover(transactionId));
      api.lastVerified = new Date().toISOString();
      sendJson(res, completed.status, completed.response);
    });
    return true;
  }
  if (key === "POST /api/recovery/import/prepare") {
    respond(async () => {
      const data = await readJson(req, 80 * 1024 * 1024);
      const requestId = requireUuid(data.requestId);
      const result = await api.recovery.prepareImport(data.bundle, { requestId });
      sendJson(res, 200, { ok: true, dryRun: true, modified: false, ...result, summary: bundleSummary(data.bundle) });
    });
    return true;
  }
  if (key === "POST /api/recovery/import") {
    respond(async () => {
      const data = await readJson(req);
      const requestId = requireUuid(data.requestId);
      const recoveryPrepareId = requireUuid(data.recoveryPrepareId, "recoveryPrepareId");
      const result = await api.recovery.commitImport(recoveryPrepareId, String(data.confirmationToken || ""), { requestId });
      api.lastVerified = new Date().toISOString();
      sendJson(res, 200, { ok: true, verified: true, ...result });
    });
    return true;
  }
  if (key === "POST /api/backup/preview") {
    respond(async () => {
      const data = await readJson(req, 80 * 1024 * 1024);
      sendJson(res, 200, { ok: true, dryRun: true, modified: false, summary: bundleSummary(data.bundle), warnings: backup.validateBundle(data.bundle).warnings });
    });
    return true;
  }
  if (key === "POST /api/backup/prepare") {
    respond(async () => {
      const data = await readJson(req, 80 * 1024 * 1024);
      const requestId = requireUuid(data.requestId);
      const prepared = await api.manager.prepare(data.bundle, { requestId });
      sendJson(res, 201, { ok: true, dryRun: true, modified: false, ...prepared, summary: bundleSummary(data.bundle) });
    });
    return true;
  }
  if (key === "POST /api/backup/commit") {
    respond(async () => {
      const data = await readJson(req);
      const requestId = requireUuid(data.requestId);
      const transactionId = requireUuid(data.transactionId, "transactionId");
      const completed = await runIdempotent(api, requestId, "backup.commit", { transactionId }, async () => {
        const journal = api.manager.load(transactionId);
        api.confirmations.consume(String(data.confirmationToken || ""), "backup/commit", transactionId, transactionFingerprint(journal));
        const result = await api.manager.commit(transactionId);
        return { ...result, transactionId, verified: result.committed === true };
      });
      api.lastVerified = new Date().toISOString();
      sendJson(res, completed.status, completed.response);
    });
    return true;
  }
  if (key === "POST /api/backup/cancel") {
    respond(async () => {
      const data = await readJson(req);
      const requestId = requireUuid(data.requestId);
      const transactionId = requireUuid(data.transactionId, "transactionId");
      const completed = await runIdempotent(api, requestId, "backup.cancel", { transactionId }, async () => ({ ...await api.manager.cancel(transactionId), transactionId }));
      sendJson(res, completed.status, completed.response);
    });
    return true;
  }
  if (key === "GET /api/attention") {
    respond(() => {
      // 同一次请求复用同一份 DATA.md，避免归档状态与注意力聚合读到不同时点。
      const dataText = store.readAll();
      const statuses = archiveStatuses(api, dataText);
      const byUid = Object.fromEntries(statuses.map(item => [item.uid, { state: item.state, integrity: item.integrity }]));
      const result = attention.aggregateAttention(dataText, { entriesDir: api.paths.entries, archiveByUid: byUid });
      sendJson(res, 200, { ok: true, ...result });
    });
    return true;
  }
  if (key === "POST /api/lifecycle") {
    respond(async () => {
      const data = await readJson(req);
      const requestId = requireUuid(data.requestId);
      const result = await lifecycle.updateLifecycle(String(data.id || ""), String(data.action || ""), {
        requestId, nextReviewAt: data.nextReviewAt, controlDir: api.paths.controlDir, coordinator: api.coordinator,
      });
      sendJson(res, 200, { ok: true, ...result });
    });
    return true;
  }
  if (key === "GET /api/archive/statuses") {
    respond(() => sendJson(res, 200, { ok: true, generatedAt: new Date().toISOString(), statuses: archiveStatuses(api) }));
    return true;
  }
  if (key === "POST /api/archive/integrity/check") {
    respond(async () => {
      const data = await readJson(req);
      if (!Array.isArray(data.ids) || !data.ids.length || data.ids.length > 200) {
        const error = new Error("ids invalid"); error.code = data.ids && data.ids.length > 200 ? "bundle_too_large" : "invalid_request"; throw error;
      }
      const wanted = [...new Set(data.ids.map(item => String(item)))];
      const parsed = schema.validateData(store.readAll());
      const found = new Map(parsed.entries.map(item => [item.id, item]));
      const results = wanted.map(id => {
        const entry = found.get(id);
        if (!entry) return { id, uid: null, state: "not_archived", reasonCodes: ["entry_not_found"], checkedAt: null, snapshotId: null };
        const checked = archiveIntegrity.scanArchive(path.join(api.paths.entries, entry.uid || entry.id), { uid: entry.uid, verify: true });
        return { id, uid: entry.uid, ...checked };
      });
      sendJson(res, 200, { ok: true, generatedAt: new Date().toISOString(), results });
    });
    return true;
  }

  sendJson(res, 405, { ok: false, code: "invalid_request", message: "该接口不支持此方法", requestId: null, details: null }, { "Allow": key.startsWith("GET ") ? "POST" : "GET" });
  return true;
}

function maintenanceGate(api, req, res, route) {
  const status = api.coordinator.status();
  if (status.mode === "normal" || route === "/api/health" || route === "/api/state" || route.startsWith("/api/recovery/") ||
      route === "/api/maintenance/status" || route === "/api/upgrade/status") return false;
  const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  const code = status.mode === "waiting" && mutation ? "maintenance_locked" : "maintenance_mode";
  sendDomainError(res, { code }, null);
  return true;
}

function legacyMutationIdentity(req, res, route) {
  const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  if (!mutation || V2_BODY_ID_ROUTES.has(route) || route === "/api/control/shutdown" || route.startsWith("/api/wecom/")) return false;
  const requestId = String(req.headers["idempotency-key"] || "").toLowerCase();
  if (!UUID_RE.test(requestId)) {
    sendDomainError(res, { code: "invalid_request" }, null);
    return true;
  }
  const signature = req.method + " " + route;
  const prior = legacyRequestKeys.get(requestId);
  if (prior && prior !== signature) {
    sendDomainError(res, { code: "idempotency_conflict" }, requestId);
    return true;
  }
  legacyRequestKeys.set(requestId, signature);
  if (legacyRequestKeys.size > 2000) legacyRequestKeys.delete(legacyRequestKeys.keys().next().value);
  req.operationId = requestId;
  return false;
}

/* c8 ignore start -- legacy routes remain covered by their existing integration suite; T4 never rewrites them directly. */

/* ===== multipart/form-data 解析(零依赖,支持单文件 + 文本字段) ===== */
function parseMultipart(req, cb) {
  const ct = req.headers["content-type"] || "";
  const bndM = ct.match(/boundary=([^;]+)/);
  if (!bndM) { cb(new Error("非 multipart 请求")); return; }
  const boundary = Buffer.from("--" + bndM[1].trim().replace(/^["']|["']$/g, ""));
  const chunks = [];
  let totalLen = 0;
  let tooLarge = false;
  let finished = false;
  const LIMIT = 6 * 1024 * 1024; // 文件上限 5MB，额外预留 multipart 头部
  const done = (error, value) => {
    if (finished) return;
    finished = true;
    cb(error, value);
  };
  req.on("data", c => {
    totalLen += c.length;
    if (totalLen > LIMIT) { tooLarge = true; return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (tooLarge) { done(new Error("上传超过 5MB 限制")); return; }
    try {
      const buf = Buffer.concat(chunks);
      let fileBuffer = null, caption = "";
      let pos = 0;
      while (pos < buf.length) {
        const next = buf.indexOf(boundary, pos);
        if (next < 0) break;
        // 跳过 boundary + \r\n
        let partStart = next + boundary.length;
        if (buf.slice(partStart, partStart + 2).toString() === "\r\n") partStart += 2;
        else break; // -- 结束标记
        const partEnd = buf.indexOf(boundary, partStart);
        if (partEnd < 0) break;
        // 找 part 内的 header/body 分界 \r\n\r\n
        const headerEnd = buf.indexOf("\r\n\r\n", partStart);
        if (headerEnd < 0 || headerEnd >= partEnd) { pos = partEnd; continue; }
        const header = buf.slice(partStart, headerEnd).toString("utf-8");
        let bodyBuf = buf.slice(headerEnd + 4, partEnd - 2); // 去尾 \r\n
        if (/name="file"/.test(header)) {
          // 去 filename 后的内容(已是二进制,直接取)
          fileBuffer = bodyBuf;
        } else {
          const nameM = header.match(/name="([^"]+)"/);
          if (nameM && nameM[1] === "caption") caption = bodyBuf.toString("utf-8");
        }
        pos = partEnd;
      }
      if (!fileBuffer) { done(new Error("未找到文件")); return; }
      done(null, { fileBuffer, caption });
    } catch (e) { done(e); }
  });
  req.on("error", e => done(e));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:" + PORT);
  const p = u.pathname;
  const clientKey = req.socket && req.socket.remoteAddress || "unknown";
  const authKind = auth.authorizationKind(req);
  const isControlRoute = p === "/api/control/shutdown";

  if (p.startsWith("/api/") && !isControlRoute) {
    const rate = apiLimiter.check(clientKey);
    if (!rate.allowed) {
      sendJson(res, 429, { ok: false, error: "请求过于频繁，请稍后重试", retryAfter: rate.retryAfter }, { "Retry-After": String(rate.retryAfter) });
      return;
    }
    if (["/api/fetch-meta", "/api/add", "/api/entry/scrape", "/api/wecom/callback"].includes(p)) {
      const expensiveRate = expensiveLimiter.check(clientKey);
      if (!expensiveRate.allowed) {
        sendJson(res, 429, { ok: false, error: "抓取请求过于频繁，请稍后重试", retryAfter: expensiveRate.retryAfter }, { "Retry-After": String(expensiveRate.retryAfter) });
        return;
      }
    }
  }

  if (p.startsWith("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    res.once("finish", () => audit.record({
      method: req.method,
      route: p,
      status: res.statusCode,
      auth: authKind,
      local: auth.isLocalHost(req),
    }));
  }

  /* 所有数据 API 默认需要本地会话；企业微信回调依赖自身签名校验。 */
  if (p.startsWith("/api/") && p !== "/api/wecom/callback" && authKind === "none") {
    sendJson(res, 401, { ok: false, error: "未授权访问，请从本机看板页面重新进入" });
    return;
  }

  /* 写接口 CSRF 防护：会话 Cookie 必须与当前 Host/端口精确同源；显式 API 令牌与平台签名入口不依赖浏览器 Origin。 */
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !p.startsWith("/api/wecom/") && authKind === "session" && !auth.isTrustedOrigin(req)) {
    sendJson(res, 403, { ok: false, error: "拒绝跨站请求（来源必须与看板端口完全一致）" });
    return;
  }

  if (legacyMutationIdentity(req, res, p)) return;

  /* 桌面启动器专用：只接受来自本机回环连接的显式令牌，不授权浏览器会话。 */
  if (isControlRoute) {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "仅支持 POST" }, { "Allow": "POST" });
      return;
    }
    if (authKind !== "token" || !isLoopbackRequest(req)) {
      sendJson(res, 403, { ok: false, error: "仅桌面启动器可停止本地服务" });
      return;
    }
    res.once("finish", () => setImmediate(() => shutdown("桌面窗口已关闭", 0)));
    sendJson(res, 202, { ok: true, shuttingDown: true });
    return;
  }

  const trustedApi = services();
  if (maintenanceGate(trustedApi, req, res, p)) return;
  if (trustedApiHandler(trustedApi, req, res, u)) return;

  /* 读取数据 */
  if (p === "/api/data") {
    try {
      const content = store.readAll();
      sendJson(res, 200, { ok: true, name: path.basename(README), content });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e) });
    }
    return;
  }

  /* 抓取链接元数据（预览） */
  if (p === "/api/fetch-meta") {
    const url = (u.searchParams.get("url") || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) { sendJson(res, 400, { ok: false, error: "请填写有效的 http(s) 链接" }); return; }
    fetcher.assertPublicUrl(url)
      .then(() => fetcher.fetchMeta(url, "预览"))
      .then(meta => sendJson(res, 200, { ok: true, meta }))
      .catch(e => sendJson(res, 422, { ok: false, error: e.message }));
    return;
  }

  /* 新增条目：抓取（或直接传字段）+ 写入 DATA.md */
  if (p === "/api/add" && req.method === "POST") {
    handleJson(req, res, async data => {
      const result = await capture.addUrl(data.url, data);
      sendJson(res, 200, result);
    });
    return;
  }

  if (p === "/api/archive/status" && req.method === "GET") {
    const id = (u.searchParams.get("id") || "").trim();
    if (!id) { sendJson(res, 400, { ok: false, error: "缺少归档任务 id" }); return; }
    const status = capture.getArchiveStatus(id);
    if (!status) { sendJson(res, 404, { ok: false, error: "未知归档任务: " + id }); return; }
    sendJson(res, 200, { ok: true, archive: status, status });
    return;
  }

  if (p === "/api/archive/retry" && req.method === "POST") {
    handleJson(req, res, data => {
      const id = String(data.id || "").trim();
      if (!id) throw requestError("缺少归档任务 id", 400);
      const current = capture.getArchiveStatus(id);
      if (current && (current.state === "queued" || current.state === "running")) {
        sendJson(res, 409, { ok: false, error: "归档任务已在处理中", archive: current });
        return;
      }
      try {
        // 旧版本升级上来的条目可能从未入队：此时“重试”即创建首个归档任务。
        const archive = current ? capture.retryArchive(id) : capture.queueArchive(id, "手动重试");
        sendJson(res, 202, { ok: true, archive, created: !current });
      } catch (error) {
        const status = error.statusCode || (error.message && error.message.includes("正在执行") ? 409 : 400);
        sendJson(res, status, { ok: false, error: current ? "归档重试失败" : "无法创建归档任务" });
      }
    });
    return;
  }

  if (p === "/api/merge" && req.method === "POST") {
    handleJson(req, res, async data => {
      const id = String(data.id || "").trim();
      const tags = String(data.tags || "").trim();
      const whySaved = String(data.whySaved || "").trim();
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      if (!tags && !whySaved) { sendJson(res, 400, { ok: false, error: "没有可合并的字段" }); return; }
      const result = await store.mutate(text => {
        const updated = store.mergeEntryFields(text, id, { tags, whySaved });
        if (updated === null) return { write: false, result: { found: false, changed: false } };
        return { text: updated, write: updated !== text, result: { found: true, changed: updated !== text } };
      });
      if (!result.found) { sendJson(res, 404, { ok: false, error: "未找到条目 " + id }); return; }
      sendJson(res, 200, { ok: true, id, merged: result.changed });
    });
    return;
  }

  if (p === "/api/search" && req.method === "GET") {
    try {
      const query = (u.searchParams.get("q") || "").trim();
      const results = query ? search.searchData(store.readAll(), query) : [];
      sendJson(res, 200, { ok: true, query, results });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  /* 需求驱动头脑风暴：从待研究事项中抽取长处并生成可解释的融合方案 */
  if (p === "/api/brainstorm" && req.method === "GET") {
    try {
      const mode = (u.searchParams.get("mode") || "fusion").trim();
      const goal = (u.searchParams.get("goal") || "").trim().slice(0, 400);
      const result = brainstorm.analyze(store.readAll(), { entriesDir: entries.ENTRIES_DIR, mode, goal });
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (p === "/api/brainstorm/history" && req.method === "GET") {
    try { sendJson(res, 200, { ok: true, items: brainstormHistory.listReports(12) }); }
    catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (p === "/api/brainstorm/report" && req.method === "GET") {
    try {
      const id = (u.searchParams.get("id") || "").trim();
      const content = brainstormHistory.readReport(id);
      res.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="brainstorm-${id}.md"`,
        "Content-Length": Buffer.byteLength(content),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(content);
    } catch (e) { sendJson(res, e.statusCode || 400, { ok: false, error: e.message }); }
    return;
  }

  if (p === "/api/brainstorm/save" && req.method === "POST") {
    handleJson(req, res, data => {
      const goal = String(data.goal || "").trim().slice(0, 400);
      const allowedModes = new Set(["fusion", "panorama", "opportunities", "challenges", "roadmap"]);
      const mode = allowedModes.has(data.mode) ? data.mode : "fusion";
      if (!goal) throw requestError("请先输入一个实际需求", 400);
      const analysis = brainstorm.analyze(store.readAll(), { entriesDir: entries.ENTRIES_DIR, mode, goal });
      const saved = brainstormHistory.saveReport(analysis);
      sendJson(res, 201, { ok: true, saved });
    });
    return;
  }

  if (p === "/api/brainstorm/verify" && req.method === "POST") {
    handleJson(req, res, data => {
      const id = String(data.id || "").trim();
      if (!/^\d{8}T\d{6}-[0-9a-z]{6,12}$/.test(id)) throw requestError("非法方案编号", 400);
      const saved = brainstormHistory.updateVerification(id, data);
      sendJson(res, 200, { ok: true, saved });
    });
    return;
  }

  if (p === "/api/backup" && req.method === "GET") {
    try {
      const payload = JSON.stringify(backup.exportBundle());
      const filename = "linggan-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": Buffer.byteLength(payload),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(payload);
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (p === "/api/backup/import" && req.method === "POST") {
    readBody(req, 80 * 1024 * 1024).then(async body => {
      let bundle;
      try { bundle = JSON.parse(body || "{}"); }
      catch (_) { throw requestError("备份包 JSON 格式错误", 400); }
      const result = await backup.importBundle(bundle);
      sendJson(res, 200, result);
    }).catch(error => {
      if (!res.writableEnded) sendJson(res, error.statusCode || 400, { ok: false, error: error.message });
    });
    return;
  }

  if (p === "/api/bookmarks/preview" && req.method === "POST") {
    handleJson(req, res, data => {
      const content = String(data.content || "");
      if (!content) throw requestError("书签 HTML 为空", 400);
      sendJson(res, 200, { ok: true, preview: bookmarks.preview(content) });
    }, 7 * 1024 * 1024);
    return;
  }

  if (p === "/api/bookmarks/import" && req.method === "POST") {
    handleJson(req, res, async data => {
      const content = String(data.content || "");
      if (!content) throw requestError("书签 HTML 为空", 400);
      sendJson(res, 200, await bookmarks.importHtml(content));
    }, 7 * 1024 * 1024);
    return;
  }

  if (p === "/api/diagnostics" && req.method === "GET") {
    try {
      const dataText = store.readAll();
      const dataName = path.parse(README);
      const escapedName = dataName.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedExt = (dataName.ext || ".md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const backupPattern = new RegExp("^" + escapedName + "\\.backup-\\d{17}(?:-\\d+)?" + escapedExt + "$");
      const backupFiles = fs.readdirSync(path.dirname(README))
        .filter(name => backupPattern.test(name))
        .map(name => ({ name, mtimeMs: fs.statSync(path.join(path.dirname(README), name)).mtimeMs }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      let writable = true;
      try { fs.accessSync(README, fs.constants.R_OK | fs.constants.W_OK); }
      catch (_) { writable = false; }
      sendJson(res, 200, {
        ok: true,
        appVersion: packageInfo.version,
        dataVersion: schema.getDataVersion(dataText),
        entries: schema.scanEntries(dataText).length,
        backups: backupFiles.length,
        latestBackupAt: backupFiles.length ? new Date(backupFiles[0].mtimeMs).toISOString() : null,
        writable,
        health: health.inspectData(dataText),
        trash: trash.listEntries().length,
        node: process.version,
        platform: process.platform,
        integrations: { wecom: wecom.isEnabled(), dingtalk: dingtalk.isEnabled() },
        brainstormReports: brainstormHistory.listReports(50).length,
      });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  /* 删除条目（按编号，如 2.1） */
  if (p === "/api/delete" && req.method === "POST") {
    handleJson(req, res, async data => {
      const id = String(data.id || "").trim();
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      const archived = await trash.archiveEntry(id);
      if (!archived) { sendJson(res, 404, { ok: false, error: "未找到条目 " + id }); return; }
      sendJson(res, 200, { ok: true, id, archived: true, record: archived.record });
    });
    return;
  }

  /* 更新条目状态（⏳/🔄/✅） */
  if (p === "/api/status" && req.method === "POST") {
    handleJson(req, res, async data => {
      const id = String(data.id || "").trim();
      const st = String(data.status || "").trim();
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      if (!["⏳", "🔄", "✅"].includes(st)) { sendJson(res, 400, { ok: false, error: "无效状态" }); return; }
      const found = await store.mutate(text => {
        const updated = store.updateStatus(text, id, st);
        return updated === null
          ? { write: false, result: false }
          : { text: updated, result: true };
      });
      if (!found) { sendJson(res, 404, { ok: false, error: "未找到条目 " + id }); return; }
      sendJson(res, 200, { ok: true, id, status: st });
    });
    return;
  }

  /* 更新条目研究要点（笔记写回） */
  if (p === "/api/note" && req.method === "POST") {
    handleJson(req, res, async data => {
      const id = String(data.id || "").trim();
      const note = String(data.note || "").trim().replace(/\r?\n/g, " ");
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      const found = await store.mutate(text => {
        const updated = store.updateNote(text, id, note);
        return updated === null
          ? { write: false, result: false }
          : { text: updated, result: true };
      });
      if (!found) { sendJson(res, 404, { ok: false, error: "未找到条目 " + id }); return; }
      sendJson(res, 200, { ok: true, id });
    });
    return;
  }

  /* - 从浏览器备份恢复 DATA.md */
  if (p === "/api/restore" && req.method === "POST") {
    handleJson(req, res, async data => {
      const content = String(data.content || "");
      if (!content) { sendJson(res, 400, { ok: false, error: "备份内容为空" }); return; }
      const currentEntries = new Map(schema.scanEntries(store.readAll()).map(entry => [entry.id, entry.uid]));
      const migrated = schema.migrateText(content, info => currentEntries.get(info && info.id) || schema.newUid());
      await store.mutate(() => ({ text: migrated.text, result: true }));
      sendJson(res, 200, { ok: true, migrated: migrated.fromVersion < migrated.toVersion });
    });
    return;
  }

  /* ===== 研究档案路由 ===== */

  /* 读取研究档案(首访自动建空模板) */
  if (p === "/api/entry" && req.method === "GET") {
    const id = (u.searchParams.get("id") || "").trim();
    try {
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      const entry = entries.getEntry(id, { archive: capture.archive });
      sendJson(res, 200, { ok: true, entry });
    } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
    return;
  }

  /* 保存档案字段 */
  if (p === "/api/entry/notes" && req.method === "POST") {
    handleJson(req, res, data => {
      if (!/^\d+\.\d+$/.test(data.id || "")) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      entries.saveNotes(data.id, data);
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  /* 上传截图(multipart/form-data) */
  if (p === "/api/entry/screenshot" && req.method === "POST") {
    const id = (u.searchParams.get("id") || "").trim();
    if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
    parseMultipart(req, (err, { fileBuffer, caption } = {}) => {
      if (err) { sendJson(res, 400, { ok: false, error: err.message }); return; }
      try {
        const r = entries.uploadScreenshot(id, fileBuffer, caption);
        sendJson(res, 200, { ok: true, file: r.file });
      } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
    });
    return;
  }

  /* 删除截图 */
  if (p === "/api/entry/screenshot/delete" && req.method === "POST") {
    handleJson(req, res, data => {
      if (!/^\d+\.\d+$/.test(data.id || "")) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      entries.deleteScreenshot(data.id, data.file);
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  /* 读取截图文件(供前端显示) */
  if (p === "/api/entry/screenshot/file") {
    const id = (u.searchParams.get("id") || "").trim();
    const file = (u.searchParams.get("file") || "").trim();
    try {
      if (!/^\d+\.\d+$/.test(id) || !/^\d{8}-\d{6}\.(png|jpe?g)$/i.test(file)) {
        sendText(res, 400, "无效参数"); return;
      }
      const fp = entries.safePath(id, "screenshots", file);
      if (!fs.existsSync(fp)) { sendText(res, 404, "Not Found"); return; }
      const data = fs.readFileSync(fp);
      const ext = path.extname(file).toLowerCase();
      const type = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(data);
    } catch (e) { sendText(res, 400, e.message); }
    return;
  }

  /* 抓取条目正文 → content.md */
  if (p === "/api/entry/scrape" && req.method === "POST") {
    handleJson(req, res, async data => {
      const id = String(data.id || "").trim();
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      const url = entries.entryUrl(id);
      if (!url) { sendJson(res, 422, { ok: false, error: "该条目无来源链接,无法抓取" }); return; }
      const result = await scraper.scrapeContent(url);
      entries.saveContent(id, result);
      sendJson(res, 200, { ok: result.ok, warning: result.warning, title: result.title, source: result.source });
    });
    return;
  }

  /* 读取已抓正文 */
  if (p === "/api/entry/content" && req.method === "GET") {
    const id = (u.searchParams.get("id") || "").trim();
    try {
      if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      const content = entries.getContent(id);
      sendJson(res, 200, { ok: true, content, hasContent: !!content });
    } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
    return;
  }

  if (p === "/api/entry/content" && req.method === "POST") {
    handleJson(req, res, async data => {
      const id = String(data.id || "").trim();
      const content = String(data.content || data.markdown || "");
      if (!/^\d+\.\d+$/.test(id)) throw requestError("无效编号", 400);
      if (!content.trim()) throw requestError("手动归档内容不能为空", 400);
      if (Buffer.byteLength(content, "utf8") > 20 * 1024 * 1024) {
        throw requestError("手动归档内容超过 20MB 限制", 413);
      }
      try {
        const archive = await capture.archiveContent(id, content);
        sendJson(res, 200, { ok: true, id, archive });
      } catch (error) {
        sendJson(res, error.statusCode || 400, { ok: false, error: "手动归档失败" });
      }
    }, 21 * 1024 * 1024);
    return;
  }

  /* ===== 企业微信消息回调：转发链接即入库 ===== */
  if (p === "/api/wecom/callback") {
    // 未配置企业微信时给出提示（不影响看板主功能）
    if (!wecom.isEnabled()) {
      sendJson(res, 503, { ok: false, error: "未配置企业微信（需设置 WECOM_CORP_ID/SECRET/TOKEN/ENCODING_AES 等环境变量）" });
      return;
    }
    const q = u.searchParams;
    // GET：企业微信 URL 验证（echostr 回显）
    if (req.method === "GET") {
      const sig = q.get("msg_signature") || "";
      const ts = q.get("timestamp") || "";
      const nonce = q.get("nonce") || "";
      const echostr = q.get("echostr") || "";
      if (wecom.verifySignature(sig, ts, nonce, echostr)) {
        const plain = wecom.decrypt(echostr);
        sendText(res, 200, plain);
      } else {
        sendText(res, 403, "签名校验失败");
      }
      return;
    }
    // POST：接收消息（用户转发的内容）
    if (req.method === "POST") {
      readBody(req, 256 * 1024).then(body => {
        return (async () => {
          const sig = q.get("msg_signature") || "";
          const ts = q.get("timestamp") || "";
          const nonce = q.get("nonce") || "";
          const encrypt = wecom.xmlField(body, "Encrypt");
          // 签名校验 + 解密
          if (!encrypt || !wecom.verifySignature(sig, ts, nonce, encrypt)) {
            sendJson(res, 403, { ok: false, error: "消息签名校验失败" });
            return;
          }
          const xml = wecom.decrypt(encrypt);
          const fromUser = wecom.xmlField(xml, "FromUserName");
          const url = wecom.extractUrl(xml);
          // 无链接：提示用法
          if (!url) {
            try { await wecom.sendText(fromUser, "请直接转发或粘贴一个 http(s) 链接给我，我会自动抓取并记录到看板。"); } catch (_) {}
            sendJson(res, 200, { ok: true, skipped: true });
            return;
          }
          try {
            const result = await capture.addUrl(url, { stage: "企业微信" });
            const callbackReply = result.duplicate
              ? `已保存\n${result.id} ${result.title}`
              : `已保存\n${result.id} ${result.title}` + (result.archive && result.archive.state === "queued" ? "\n正在归档" : "");
            try { await wecom.sendText(fromUser, callbackReply); } catch (_) {}
            sendJson(res, 200, result);
          } catch (e) {
            try { await wecom.sendText(fromUser, "❌ 记录失败，请稍后重试"); } catch (_) {}
            sendJson(res, 500, { ok: false, error: "记录失败，请稍后重试" });
          }
        })();
      }).catch(error => {
        if (!res.writableEnded) sendJson(res, error.statusCode || 500, { ok: false, error: error.message });
      });
      return;
    }
  }

  /* 回收站：删除默认归档，可按记录恢复 */
  if (p === "/api/trash" && req.method === "GET") {
    try { sendJson(res, 200, { ok: true, entries: trash.listEntries() }); }
    catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (p === "/api/trash/restore" && req.method === "POST") {
    handleJson(req, res, async data => {
      const restored = await trash.restoreEntry(String(data.record || ""));
      sendJson(res, 200, { ok: true, restored });
    });
    return;
  }

  /* 静态：board.html / board.css / board.js */
  const STATIC = {
    "/": { file: "board.html", type: "text/html; charset=utf-8" },
    "/board.html": { file: "board.html", type: "text/html; charset=utf-8" },
    "/board.css": { file: "board.css", type: "text/css; charset=utf-8" },
    "/board.js": { file: "board.js", type: "application/javascript; charset=utf-8" },
  };
  if (STATIC[p]) {
    try {
      const fp = path.join(DIR, STATIC[p].file);
      const data = fs.readFileSync(fp, "utf-8");
      const headers = {
        "Content-Type": STATIC[p].type,
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
      };
      if ((p === "/" || p === "/board.html") && auth.isLocalHost(req)) {
        headers["Set-Cookie"] = auth.sessionCookie();
      }
      res.writeHead(200, headers);
      res.end(data);
    } catch (e) {
      sendText(res, 404, STATIC[p].file + " 不存在");
    }
    return;
  }

  sendText(res, 404, "Not Found");
});

server.on("error", e => {
  if (e && e.code === "EADDRINUSE") {
    console.error("\n  [错误] 端口 " + PORT + " 已被占用（可能服务已在运行？）\n  可先关闭旧服务，或用 PORT=xxxx node server.js 换端口启动。");
    process.exit(1);
  }
  recordError("listenError", e);
  process.exit(1);
});

/* 未捕获异常后不再继续提供可能不一致的服务；先停止接入并等待现有请求结束。 */
let shuttingDown = false;
function shutdown(reason, exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reason) console.log("\n  正在停止服务：" + reason);
  try { dingtalk.stop(); } catch (error) { recordError("integrationStop", error); }
  try { capture.stop(); } catch (error) { recordError("archiveStop", error); }
  const forceExit = setTimeout(() => process.exit(exitCode), 3000);
  forceExit.unref();
  if (!server.listening) {
    clearTimeout(forceExit);
    process.exit(exitCode);
    return;
  }
  server.close(error => {
    clearTimeout(forceExit);
    if (error) recordError("serverClose", error);
    process.exit(exitCode);
  });
}
/* 统一入库辅助：抓取元数据 + 写入 DATA.md（供企业微信/钉钉等外部入口复用） */
async function addUrlToBoard(url) {
  return capture.addUrl(url, { stage: "外部入口" });
}

if (require.main === module) {
process.on("SIGINT", () => shutdown("收到 Ctrl+C", 0));
process.on("SIGTERM", () => shutdown("收到退出信号", 0));
process.on("uncaughtException", error => {
  recordError("uncaughtException", error);
  shutdown("发生未捕获异常", 1);
});
process.on("unhandledRejection", reason => {
  recordError("unhandledRejection", reason);
  shutdown("发生未处理的异步异常", 1);
});

assertSafeStartup();
acquireStartupLock();
process.on("exit", () => {
  try { if (activeInstanceLock) activeInstanceLock.release(); } catch (_) {}
});
ensureDataFile();
let migrationSummary;
try {
  migrationSummary = migrate.migrateData({ dataFile: README, entriesDir: entries.ENTRIES_DIR });
} catch (e) {
  recordError("dataMigration", e);
  console.error("\n  [错误] 数据升级失败，服务未启动。" + e.message);
  process.exit(1);
}
try { capture.start(); } catch (e) { recordError("archiveStart", e); }

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  灵感来袭 · 待办看板");
  console.log("  http://localhost:" + PORT);
  console.log("  数据文件: " + README);
  if (migrationSummary && migrationSummary.changed) {
    console.log("  数据格式: 已升级到 v" + migrationSummary.toVersion);
    console.log("  迁移备份: " + migrationSummary.backupDir);
  }

  console.log("  企业微信转发入库: " + (wecom.isEnabled() ? "已启用 (/api/wecom/callback)" : "未配置（设置 WECOM_* 环境变量启用）"));
  console.log("  钉钉转发入库: " + (dingtalk.isEnabled() ? "启动中..." : "未配置（设置 DINGTALK_* 环境变量启用）"));
  console.log("  按 Ctrl+C 停止服务");
  console.log("");
  // 钉钉 Stream 模式：自动连接接收消息（无需公网/域名）
  if (dingtalk.isEnabled()) {
    dingtalk.start(addUrlToBoard).then(ok => {
      if (ok) console.log("  钉钉 Stream 已就绪，给机器人发链接即可入库");
      else console.log("  [警告] 钉钉 Stream 连接失败，请检查 DINGTALK_CLIENT_ID/SECRET");
    }).catch(e => console.log("  [警告] 钉钉启动异常:", e.message));
  }
  try {
    if (process.platform === "win32" && !process.env.NO_OPEN) {
      openBrowser("http://127.0.0.1:" + PORT + "/");
    }
  } catch (_) { /* 打开浏览器失败不阻塞 */ }
});
}

module.exports = {
  TRUSTED_STATES,
  actionableRecoveryTransactions,
  createTrustedServices,
  legacyMutationIdentity,
  maintenanceGate,
  publicDetails,
  publicRecoveryStatus,
  requireUuid,
  runIdempotent,
  sendDomainError,
  transactionFingerprint,
  trustedApiHandler,
  trustedStateModel,
};
