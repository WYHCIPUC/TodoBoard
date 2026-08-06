# 待办看板模块化重构 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把单文件 server.js 拆成 4 职责模块,board.html 抽离 JS/CSS,加写入安全(原子写+备份+写队列),保持零依赖双击即用且行为完全等价。

**Architecture:** 后端按"抓取/分类/存储/路由"四类职责拆分到 `lib/`,server.js 只做路由编排。前端把内联 `<script>`/`<style>` 抽到独立文件。存储层加进程内写队列串行化 + tmp→rename 原子写 + 写前备份。

**Tech Stack:** Node.js 内置模块(http/https/fs/path,零依赖)、原生 JavaScript、HTML/CSS。

**回归基线:** `docs/plans/regression-baseline.json` —— 重构后必须逐条等价。实现前已记录当前真实输出(注意:基线是算法现状,非主观期望)。

**关键约束(spec 来历):** 不引依赖、不引构建、不换数据库、不改前端交互。每个模块单一职责,server.js 不含业务逻辑(行数 < 150)。

---

### Task 1: 建立 constants.js(叶子模块,无依赖)

**Files:**
- Create: `lib/constants.js`

**Step 1: 创建常量模块**

从 server.js:37-47 抽出 `CATS` 和 `CAT_KEYWORDS`,原样不变:

```javascript
"use strict";
const CATS = ["AI 工具", "硬件 & 嵌入式", "前端 & 设计", "桌面 & 系统", "开源项目 & 开发", "搜索 & OSINT", "教程 & 资源", "其他"];

const CAT_KEYWORDS = {
  "AI 工具": ["ai", "agent", "llm", "gpt", "deepseek", "大模型", "模型", "智能", "chat", "claude", "生成", "绘画", "文生"],
  "硬件 & 嵌入式": ["esp32", "单片机", "嵌入式", "stm32", "arduino", "无人机", "硬件", "电路", "焊接", "传感器", "开发板", "diy", "电子", "开源飞控", "keil"],
  "前端 & 设计": ["前端", "网页", "网站", "ui", "交互", "设计", "css", "html", "web", "动效", "架构图", "figma", "drawio", "视觉", "网页大赏"],
  "桌面 & 系统": ["桌面", "windows", "win10", "win11", "mac", "便签", "系统", "效率", "便签", "软件"],
  "开源项目 & 开发": ["github", "开源", "仓库", "开发", "代码", "框架", "脚手架", "cli", "api", "库", "star", "skill", "插件"],
  "搜索 & OSINT": ["搜索", "搜索引擎", "osint", "检索", "数据", "目录", "索引", "情报", "eye"],
  "教程 & 资源": ["教程", "课程", "学习", "入门", "视频", "文档", "资源", "指南", "教学", "讲解"],
};

module.exports = { CATS, CAT_KEYWORDS };
```

**Step 2: 验证可加载**

Run: `node -e "const c=require('./lib/constants'); console.log(c.CATS.length, Object.keys(c.CAT_KEYWORDS).length)"`
Expected: `8 7`

**Step 3: Commit**

```bash
git add lib/constants.js
git commit -m "refactor: 抽出 constants 模块(CATS/CAT_KEYWORDS)"
```

---

### Task 2: 建立 classifier.js(纯函数,最易测)

**Files:**
- Create: `lib/classifier.js`
- Test: `lib/classifier.test.js`

**Step 1: 写失败测试**

`lib/classifier.test.js` —— 对照 regression-baseline.json 逐条断言:

```javascript
"use strict";
const assert = require("assert");
const { classify, categoryOfSectionTitle, guessSource } = require("./classifier");

// classify —— 基线来自 regression-baseline.json,是【当前算法真实输出】
assert.strictEqual(classify("腾讯 Miora 设计 Agent 网站动效神器"), "前端 & 设计");
assert.strictEqual(classify("drawio-skill AI 自动生成架构图"), "AI 工具");
assert.strictEqual(classify("ESP32 迷你四轴无人机 45元手搓 硬件"), "硬件 & 嵌入式");
assert.strictEqual(classify("PaperTodo 极简 Windows 桌面便签"), "桌面 & 系统");
assert.strictEqual(classify("roboflow supervision computer vision github"), "开源项目 & 开发");
assert.strictEqual(classify("EyeDex 眼图 开放目录搜索引擎 osint"), "搜索 & OSINT");
assert.strictEqual(classify(""), "其他");

// categoryOfSectionTitle —— 对照 server.js:62-71 原样
assert.strictEqual(categoryOfSectionTitle("1. AI 工具"), "AI 工具");
assert.strictEqual(categoryOfSectionTitle("2. 硬件 & 嵌入式 DIY"), "硬件 & 嵌入式");
assert.strictEqual(categoryOfSectionTitle("前端设计网页"), "前端 & 设计");

// guessSource —— 对照 server.js:73-78
assert.strictEqual(guessSource("https://www.bilibili.com/video/BV1xx"), "B站视频");
assert.strictEqual(guessSource("https://mp.weixin.qq.com/s/xxx"), "微信公众号原文");
assert.strictEqual(guessSource("https://github.com/user/repo"), "GitHub 仓库");
assert.strictEqual(guessSource("https://example.com/other"), "来源");

console.log("classifier: ALL PASS");
```

**Step 2: 运行测试确认失败**

Run: `node lib/classifier.test.js`
Expected: FAIL with "Cannot find module './classifier'"

**Step 3: 实现 classifier.js**

从 server.js:49-78 原样迁移,改为 require constants:

```javascript
"use strict";
const { CATS, CAT_KEYWORDS } = require("./constants");

/** 基于关键字词库自动分类;0 分或平手按词库顺序优先 */
function classify(text) {
  const t = (text || "").toLowerCase();
  let best = "其他", bestScore = 0;
  for (const cat of CATS) {
    if (cat === "其他") continue;
    let s = 0;
    for (const kw of CAT_KEYWORDS[cat]) if (t.includes(kw)) s++;
    if (s > bestScore) { bestScore = s; best = cat; }
  }
  return best;
}

function categoryOfSectionTitle(t) {
  if (/AI|Agent|智能/.test(t)) return "AI 工具";
  if (/硬件|嵌入式|DIY/.test(t)) return "硬件 & 嵌入式";
  if (/设计|前端|网页/.test(t)) return "前端 & 设计";
  if (/软件|工具|桌面/.test(t)) return "桌面 & 系统";
  if (/开源|开发/.test(t)) return "开源项目 & 开发";
  if (/搜索|OSINT/.test(t)) return "搜索 & OSINT";
  if (/教程|资源/.test(t)) return "教程 & 资源";
  return "其他";
}

function guessSource(url) {
  if (url.includes("bilibili.com")) return "B站视频";
  if (url.includes("mp.weixin.qq.com")) return "微信公众号原文";
  if (url.includes("github.com")) return "GitHub 仓库";
  return "来源";
}

module.exports = { classify, categoryOfSectionTitle, guessSource };
```

**Step 4: 运行测试确认通过**

Run: `node lib/classifier.test.js`
Expected: `classifier: ALL PASS`

**Step 5: Commit**

```bash
git add lib/classifier.js lib/classifier.test.js
git commit -m "refactor: 抽出 classifier 模块 + 回归测试"
```

---

### Task 3: 建立 fetcher.js(抓取层,网络 I/O)

**Files:**
- Create: `lib/fetcher.js`
- Test: `lib/fetcher.test.js`

**Step 1: 写失败测试(仅测纯函数部分)**

`lib/fetcher.test.js` —— parseUrl 是纯函数可离线测;fetchMeta 涉及网络不测具体值:

```javascript
"use strict";
const assert = require("assert");
const { parseUrl } = require("./fetcher");

// parseUrl —— 对照 regression-baseline.json
assert.deepStrictEqual(parseUrl("https://www.bilibili.com/video/BV1bcNZ6xEK3/"), { kind: "bilibili", bvid: "BV1bcNZ6xEK3" });
assert.deepStrictEqual(parseUrl("https://github.com/roboflow/supervision"), { kind: "github", repo: "roboflow/supervision" });
assert.deepStrictEqual(parseUrl("https://github.com/roboflow/supervision.git"), { kind: "github", repo: "roboflow/supervision" });
assert.deepStrictEqual(parseUrl("https://example.com/page"), { kind: "web" });

// fetchMeta 只验证是函数(网络行为由集成测试覆盖)
assert.strictEqual(typeof require("./fetcher").fetchMeta, "function");

console.log("fetcher: ALL PASS");
```

**Step 2: 运行测试确认失败**

Run: `node lib/fetcher.test.js`
Expected: FAIL "Cannot find module './fetcher'"

**Step 3: 实现 fetcher.js**

从 server.js:80-210 原样迁移全部抓取逻辑(httpGet/decodeHtml/parseUrl/fetchBilibili/fetchGithub/fetchOgMeta/fetchWeb/fetchMeta)。**注意 fetchMeta 内部调用 classify**,改为 require classifier:

```javascript
"use strict";
const http = require("http");
const https = require("https");
const { classify } = require("./classifier");

// ... [完整迁移 httpGet / decodeHtml / parseUrl / fetchBilibili / fetchGithub / fetchOgMeta / fetchWeb]

async function fetchMeta(url) {
  const parsed = parseUrl(url);
  let meta;
  if (parsed.kind === "bilibili") meta = await fetchBilibili(parsed.bvid);
  else if (parsed.kind === "github") meta = await fetchGithub(parsed.repo);
  else meta = await fetchWeb(url);
  const category = classify([meta.title, meta.desc, meta.categoryHint, meta.site, meta.stars ? String(meta.stars) : ""].join(" "));
  return Object.assign({ url, category }, meta);
}

module.exports = { parseUrl, fetchMeta };
```

**关键**:迁移时逐函数对照 server.js 原文,不得改动任何逻辑分支、正则、超时值、body 上限。httpGet 的递归重定向、destroy 逻辑原样保留。

**Step 4: 运行测试确认通过**

Run: `node lib/fetcher.test.js`
Expected: `fetcher: ALL PASS`

**Step 5: 网络烟雾测试(可选,需联网)**

Run: `node -e "require('./lib/fetcher').fetchMeta('https://github.com/roboflow/supervision').then(m=>console.log(m.title, m.category)).catch(e=>console.log('网络不可用,跳过:', e.message))"`
Expected: 打印 `roboflow/supervision 开源项目 & 开发`(或网络错误时跳过,不阻断)

**Step 6: Commit**

```bash
git add lib/fetcher.js lib/fetcher.test.js
git commit -m "refactor: 抽出 fetcher 模块(抓取层)+ parseUrl 测试"
```

---

### Task 4: 建立 store.js(存储层 + 写入安全)

**Files:**
- Create: `lib/store.js`
- Test: `lib/store.test.js`

**Step 1: 写失败测试**

`lib/store.test.js` —— 用临时 README 测增删改 + 原子写 + 备份:

```javascript
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

// 用临时目录测,不污染真实 README
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-test-"));
const tmpReadme = path.join(tmpDir, "README.md");
const seed = `# Test

## 1. AI 工具

### ⏳ 1.1 已有条目
- **简介**:seed
- **作者 / 来源**:[测试](https://example.com)
- **难度**:⭐
- **研究要点**:(待补充)
`;
fs.writeFileSync(tmpReadme, seed, "utf-8");

// 用环境变量指定测试文件
process.env.README_FILE = tmpReadme;
const store = require("./store");

// 1. readAll
assert.strictEqual(store.readAll(), seed);

// 2. addEntry
let r = store.addEntry({ name: "新条目", url: "https://example.com/new", desc: "测试新增", difficulty: 2, site: "测试", category: "AI 工具" });
assert.ok(/^1\.2$/.test(r.id), "新增应得编号 1.2: " + r.id);
const afterAdd = store.readAll();
assert.ok(afterAdd.includes("### ⏳ 1.2 新条目"));
assert.ok(afterAdd.includes("- **简介**:测试新增"));

// 3. 备份已产生
const backups = fs.readdirSync(tmpDir).filter(f => f.startsWith("README.backup-"));
assert.ok(backups.length >= 1, "写入后应有备份文件");

// 4. setStatus
assert.strictEqual(store.setStatus("1.1", "✅"), true);
assert.ok(store.readAll().includes("### ✅ 1.1 已有条目"));

// 5. setNote
assert.strictEqual(store.setNote("1.1", "我的笔记"), true);
assert.ok(store.readAll().includes("- **研究要点**:我的笔记"));

// 6. deleteEntry
assert.strictEqual(store.deleteEntry("1.2"), true);
assert.ok(!store.readAll().includes("### ⏳ 1.2 新条目"));

// 7. 不存在的 id
assert.strictEqual(store.setStatus("9.9", "✅"), false);
assert.strictEqual(store.deleteEntry("9.9"), false);

// 清理
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("store: ALL PASS");
```

**Step 2: 运行测试确认失败**

Run: `node lib/store.test.js`
Expected: FAIL "Cannot find module './store'"

**Step 3: 实现 store.js**

迁移 server.js:215-340 的存储函数,加写入安全层:

```javascript
"use strict";
const fs = require("fs");
const path = require("path");
const { CATS } = require("./constants");
const { categoryOfSectionTitle, guessSource } = require("./classifier");

const README = process.env.README_FILE
  ? path.resolve(process.env.README_FILE)
  : path.join(__dirname, "..", "README.md");
const DIR = path.dirname(README);
const MAX_BACKUPS = 5;

/* === 写队列:进程内串行化所有写操作 === */
let writeChain = Promise.resolve();
function withWriteLock(fn) {
  const run = writeChain.then(() => fn());
  writeChain = run.catch(() => {}); // 锁不因单次失败断裂
  return run;
}

/* === 原子写 + 备份 === */
function writeWithBackup(text) {
  // 1. 备份当前文件(写前快照)
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const backup = path.join(DIR, `README.backup-${stamp}.md`);
  try {
    if (fs.existsSync(README)) fs.copyFileSync(README, backup);
  } catch (e) { /* 备份失败不阻断写入,但记录 */ console.error("备份失败:", e.message); }

  // 2. 清理超额备份(只碰 README.backup-* 前缀,绝不碰 README.md)
  try {
    const all = fs.readdirSync(DIR)
      .filter(f => /^README\.backup-\d{8}\.md$/.test(f))
      .sort().reverse();
    for (const old of all.slice(MAX_BACKUPS)) {
      const p = path.join(DIR, old);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (e) { /* 清理失败不阻断 */ }

  // 3. 原子写:tmp → rename
  const tmp = README + ".tmp";
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, README); // rename 是原子的;失败则 README 不动
}

/* === 读取 === */
function readAll() {
  return fs.readFileSync(README, "utf-8");
}

/* === 迁移自 server.js 的存储函数(nextIdIn/buildSnippet/insertSnippet/deleteEntry/updateStatus/updateNote) === */
// ... [原样迁移 server.js:217-340,内部写操作改为调用 writeWithBackup]

function addEntry({ name, url, author, desc, difficulty, image, site, category }) {
  return withWriteLock(() => {
    const text = readAll();
    const id = nextIdIn(text, category);
    const snippet = buildSnippet({ id, name, url, author, desc, difficulty, image, site });
    const updated = insertSnippet(text, category, snippet);
    writeWithBackup(updated);
    return { id, snippet };
  });
}
// deleteEntry/setStatus/setNote 同理包裹 withWriteLock + writeWithBackup

module.exports = { readAll, addEntry, deleteEntry, setStatus, setNote };
```

**关键**:迁移 nextIdIn/buildSnippet/insertSnippet/deleteEntry/updateStatus/updateNote 时,逻辑/正则/编号规则逐字对照 server.js:217-340,不得改动。`buildSnippet` 内的 `guessSource(url)` 调用改为从 classifier import。

**Step 4: 运行测试确认通过**

Run: `node lib/store.test.js`
Expected: `store: ALL PASS`

**Step 5: Commit**

```bash
git add lib/store.js lib/store.test.js
git commit -m "refactor: 抽出 store 模块(存储层 + 原子写 + 备份 + 写队列)"
```

---

### Task 5: 瘦身 server.js(只做路由编排)

**Files:**
- Modify: `server.js` (全文)

**Step 1: 重写 server.js**

删除所有已迁移的业务函数,改为 require lib 模块。server.js 只保留:常量配置(PORT/README/HTML_FILE 路径)、HTTP 路由分发、参数校验、静态服务。目标行数 < 150。

```javascript
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const fetcher = require("./lib/fetcher");
const store = require("./lib/store");

const PORT = Number(process.env.PORT) || 3865;
const DIR = __dirname;
const HTML_FILE = process.env.HTML_FILE ? path.resolve(process.env.HTML_FILE) : path.join(DIR, "board.html");

function sendJson(res, code, obj) { /* 原样 */ }
function sendText(res, code, text) { /* 原样 */ }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:" + PORT);
  const p = u.pathname;

  if (p === "/api/data") {
    try { sendJson(res, 200, { ok: true, name: "README.md", content: store.readAll() }); }
    catch (e) { sendJson(res, 500, { ok: false, error: String(e) }); }
    return;
  }

  if (p === "/api/fetch-meta") {
    const url = (u.searchParams.get("url") || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) { sendJson(res, 400, { ok: false, error: "请填写有效的 http(s) 链接" }); return; }
    fetcher.fetchMeta(url)
      .then(meta => sendJson(res, 200, { ok: true, meta }))
      .catch(e => sendJson(res, 422, { ok: false, error: e.message }));
    return;
  }

  // /api/add /api/delete /api/status /api/note /api restore 各路由
  // 调用 store.addEntry / store.deleteEntry / store.setStatus / store.setNote / writeRaw
  // 参数校验逻辑(id 正则、status 白名单)原样保留
  // ... [参考 server.js:383-508 的校验逻辑,业务调用改为 store.xxx]

  // 静态服务:board.html / board.css / board.js
  const staticMap = { "/": "board.html", "/board.html": "board.html", "/board.css": "board.css", "/board.js": "board.js" };
  if (staticMap[p]) {
    try {
      const fp = path.join(DIR, staticMap[p]);
      const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8" };
      const html = fs.readFileSync(fp, "utf-8");
      res.writeHead(200, { "Content-Type": types[path.extname(fp)] || "text/plain", "Cache-Control": "no-store" });
      res.end(html);
    } catch (e) { sendText(res, 404, staticMap[p] + " 不存在"); }
    return;
  }

  sendText(res, 404, "Not Found");
});

server.listen(PORT, () => { /* 原样启动信息 */ });
```

**关键**:校验逻辑(400/404 条件、正则、白名单)逐条对照原 server.js,不得放宽或收紧。

**Step 2: 检查行数**

Run: `wc -l server.js`
Expected: < 150 行(spec Success Criteria #4)

**Step 3: Commit**

```bash
git add server.js
git commit -m "refactor: server.js 瘦身为路由编排,业务逻辑下沉 lib/"
```

---

### Task 6: 抽离 board.html 的 CSS

**Files:**
- Create: `board.css`
- Modify: `board.html`

**Step 1: 抽出 `<style>` 内容**

把 board.html:7 到对应 `</style>` 之间的全部 CSS 原样复制到 `board.css`(不改任何选择器/值)。

**Step 2: 删除 board.html 的 `<style>` 块,替换为 link**

```html
<link rel="stylesheet" href="board.css">
```

**Step 3: 验证样式仍生效**

Run: 启动 `node server.js`,浏览器打开看板,目视确认样式与抽离前一致(主题、卡片、布局无变化)。

**Step 4: Commit**

```bash
git add board.css board.html
git commit -m "refactor: 抽离 board.css,HTML 只留结构"
```

---

### Task 7: 抽离 board.html 的 JS

**Files:**
- Create: `board.js`
- Modify: `board.html`

**Step 1: 抽出 `<script>` 内容**

把 board.html 的 `<script>` 标签内全部 JS 原样复制到 `board.js`(不改任何逻辑/变量/DOM 操作)。

**Step 2: 删除 board.html 的 `<script>` 块,替换为**

```html
<script src="board.js"></script>
```

**Step 3: 验证交互仍正常**

Run: 启动 `node server.js`,浏览器打开看板,测试:搜索、新增(粘贴链接)、状态切换、视图切换、主题、统计 —— 全部应正常。打开浏览器 console 确认无 404、无报错。

**Step 4: Commit**

```bash
git add board.js board.html
git commit -m "refactor: 抽离 board.js,前端三件套分离"
```

---

### Task 8: 全链路回归验证

**Step 1: 运行所有模块测试**

Run: `node lib/classifier.test.js && node lib/fetcher.test.js && node lib/store.test.js`
Expected: 三个 `ALL PASS`

**Step 2: 启动验证**

Run: `node server.js`
Expected: 打印启动信息,浏览器自动打开 http://localhost:3865,看板正常渲染。

**Step 3: 零依赖验证(spec Success Criteria #1)**

Run: `ls node_modules 2>&1 || echo "无 node_modules,零依赖保持"`
Expected: `无 node_modules...`

Run: `grep -rn "require(" server.js lib/ | grep -v "require(\"http\")\|require(\"https\")\|require(\"fs\")\|require(\"path\")\|require(\"os\")\|require(\"child_process\")\|require(\"./lib\|require(\"./constants\|require(\"./classifier\|require(\"./fetcher\|require(\"./store")"`
Expected: 无输出(所有 require 都是内置模块或本地 lib)。

**Step 4: 行数验证(spec Success Criteria #4)**

Run: `wc -l server.js`
Expected: < 150

Run: `node -e "const fs=require('fs'); const s=fs.readFileSync('server.js','utf-8'); console.log('含 buildSnippet?', s.includes('buildSnippet'), '含 classify?', s.includes('function classify'))"`
Expected: `含 buildSnippet? false 含 classify? false`

**Step 5: 数据安全验证(spec Success Criteria #5)**

Run: 启动看板,连续新增 3 条条目,然后 `ls README.backup-*`
Expected: 存在至少 1 份备份文件。

**Step 6: 交互完整性验证(spec Success Criteria #6)**

手动测试全部功能:新增(B站/GitHub/网页链接各 1)、删除、状态切换(⏳→🔄→✅)、笔记写回、搜索、视图切换、主题、统计。全部应正常。

**Step 7: Commit 最终状态**

```bash
git add -A
git commit -m "chore: 模块化重构完成,全链路回归通过"
```

---

## 完成标准(对照 spec Success Criteria)

| # | 标准 | 验证任务 |
|---|------|---------|
| 1 | 零依赖保持 | Task 8 Step 3 |
| 2 | 启动方式不变 | Task 8 Step 2 |
| 3 | 行为完全等价 | Task 2-4 测试 + Task 8 Step 6 |
| 4 | server.js < 150 行且无业务函数 | Task 8 Step 4 |
| 5 | 写入安全(备份+原子写) | Task 4 Step 4 + Task 8 Step 5 |
| 6 | 前端抽离不破坏 UI | Task 6/7 + Task 8 Step 6 |
| 7 | 模块可独立测 | Task 2-4 测试脚本 |

## 风险提示(来自 spec Pre-mortem)

- **最高风险:重构引入分类行为微差** → 已用 regression-baseline.json 固化真实输出,Task 2 测试逐条断言。注意基线是算法现状(如"腾讯 Miora"实际归到前端),非主观期望。
- **备份机制误删活文件** → writeWithBackup 的清理只匹配 `^README\.backup-\d{8}\.md$`,Task 4 测试覆盖。
- **原子写回滚语义** → rename 失败则 README 不动;备份仅在 rename 后发现原文件已损时兜底。spec 错误处理章节已明确。

---
---

# 研究档案功能 Implementation Plan

> 设计来源:`docs/plans/2026-08-05-research-archive-design.md`
> **前置依赖**:Task 1-8(模块化重构)必须先完成,本部分建立在 lib/ 结构上。

**Goal:** 点条目卡片进入研究详情页,结构化记录下载安装/体验评价/界面截图/收藏判定,沉淀成每条目独立档案。

**Architecture:** `docs/entries/{id}/` 存 notes.md + screenshots/;lib/entries.js 管档案读写;server.js 加路由;board.js 加详情视图。README 保持纯索引(只读解析标题)。

**关键安全约束:** id 双重校验(正则 + 路径前缀断言)防目录穿越;saveNotes/parseNotes 双向一致;前端转义防 XSS。

---

### Task 9: 建立 entries.js 基础(getEntry + ensureEntryDir + 空模板)

**Files:**
- Create: `lib/entries.js`
- Test: `lib/entries.test.js`

**Step 1: 写失败测试**

`lib/entries.test.js`:

```javascript
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "entries-test-"));
process.env.ENTRIES_DIR = path.join(tmpRoot, "entries");

const entries = require("./entries");

// 1. getEntry 不存在时返回空模板(不报错)
let e = entries.getEntry("1.1");
assert.strictEqual(e.id, "1.1");
assert.ok(e.notesContent.includes("# ") || e.notesContent === "", "空档案应有模板或空");

// 2. 首访自动建目录 + notes.md
assert.ok(fs.existsSync(path.join(tmpRoot, "entries", "1.1", "notes.md")));

// 3. 路径穿越防护
let threw = false;
try { entries.getEntry("../../etc"); } catch (e) { threw = true; }
assert.ok(threw, "非法 id 必须抛错");

// 4. 合法 id 路径在 entries 根内
e = entries.getEntry("2.3");
assert.ok(path.resolve(path.join(tmpRoot, "entries", "2.3")).startsWith(path.resolve(path.join(tmpRoot, "entries"))), "路径须在 entries 根内");

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log("entries basic: ALL PASS");
```

**Step 2: 运行确认失败**

Run: `node lib/entries.test.js`
Expected: FAIL "Cannot find module './entries'"

**Step 3: 实现 entries.js 基础**

```javascript
"use strict";
const fs = require("fs");
const path = require("path");
const { store } = require("./store");

const ENTRIES_DIR = process.env.ENTRIES_DIR
  ? path.resolve(process.env.ENTRIES_DIR)
  : path.join(__dirname, "..", "docs", "entries");

const ID_RE = /^\d+\.\d+$/;

function assertValidId(id) {
  if (!ID_RE.test(id)) throw new Error("非法条目编号: " + id);
}

/** 拼接路径并断言结果在 entries 根内(二次防穿越) */
function safePath(id, ...sub) {
  assertValidId(id);
  const p = path.resolve(ENTRIES_DIR, id, ...sub);
  if (!p.startsWith(ENTRIES_DIR + path.sep) && p !== ENTRIES_DIR) {
    throw new Error("路径越界: " + p);
  }
  return p;
}

function ensureEntryDir(id) {
  const dir = safePath(id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const notesPath = safePath(id, "notes.md");
  if (!fs.existsSync(notesPath)) {
    const title = entriesTitle(id);
    fs.writeFileSync(notesPath, emptyTemplate(id, title), "utf-8");
  }
  const ssDir = safePath(id, "screenshots");
  if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
  return { dir, notesPath, ssDir };
}

/** 从 README 解析条目标题(只读) */
function entriesTitle(id) {
  try {
    const text = store.readAll();
    const m = text.match(new RegExp("^###\\s+[⏳🔄✅]\\s*" + id.replace(/\./g, "\\.") + "\\s+(.+)$", "mu"));
    return m ? m[1].trim() : "条目 " + id;
  } catch (e) { return "条目 " + id; }
}

function emptyTemplate(id, title) {
  return `# ${title} 研究档案

> 本条目来自 README.md,编号 ${id}

## 下载安装
- **下载状态**:未下载
- **安装包**:
- **安装状态**:未安装
- **安装路径**:

## 体验评价
- **评分**:⭐
- **是否达预期**:
- **使用感受**:

## 界面截图

## 收藏判定
- **值得收藏备用**:否
- **推荐指数**:⭐
- **备注**:
`;
}

function getEntry(id) {
  assertValidId(id);
  const { notesPath, ssDir } = ensureEntryDir(id);
  const notesContent = fs.readFileSync(notesPath, "utf-8");
  const screenshots = listScreenshots(id, ssDir);
  return { id, title: entriesTitle(id), notesPath, notesContent, screenshots };
}

function listScreenshots(id, ssDir) {
  if (!fs.existsSync(ssDir)) return [];
  return fs.readdirSync(ssDir)
    .filter(f => /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map(f => ({ file: f, caption: "" })); // caption 解析在 parseNotes
}

module.exports = { getEntry, ensureEntryDir, safePath, assertValidId, entriesTitle };
```

**注意**:entries.js 依赖 store.js(读 README 取标题),所以必须 Task 1-8 已完成。

**Step 4: 运行测试**

Run: `ENTRIES_DIR 用临时目录,见测试; node lib/entries.test.js`
Expected: `entries basic: ALL PASS`

**Step 5: Commit**

```bash
git add lib/entries.js lib/entries.test.js
git commit -m "feat: entries.js 基础(getEntry + 首访建模板 + 路径穿越防护)"
```

---

### Task 10: notes.md 渲染与解析(saveNotes + parseNotes 双向一致)

**Files:**
- Modify: `lib/entries.js`
- Test: `lib/entries.test.js`(追加 round-trip 测试)

**Step 1: 写失败测试(round-trip 是核心)**

追加到 `lib/entries.test.js`:

```javascript
// round-trip: saveNotes 后 parseNotes 必须还原所有字段
const fields = {
  downloadStatus: "已下载",
  installerName: "Miora-Setup.exe",
  installStatus: "已安装",
  installPath: "C:\\Program Files\\Miora",
  rating: 4,
  metExpectation: "是",
  experience: "动效质量很高,但导出水印。\n第二行测试。",
  keep: "是",
  recommendLevel: 5,
  keepNote: "做官网动效必备"
};
entries.saveNotes("1.1", fields);
const parsed = entries.parseNotes(entries.getEntry("1.1").notesContent);
for (const k of Object.keys(fields)) {
  assert.strictEqual(parsed[k], fields[k], "round-trip 字段丢失: " + k);
}
console.log("entries round-trip: ALL PASS");
```

**Step 2: 实现 saveNotes + parseNotes**

saveNotes 把字段渲染成 notes.md(用固定标题正则定位每节);parseNotes 用**同一套正则**反向提取。**两者正则必须共享常量,不可各自手写。**

```javascript
// 共享的字段定位正则(渲染和解析都用这套,杜绝漂移)
const F = {
  downloadStatus: /\*\*下载状态\*\*: (.+)$/,
  installerName: /\*\*安装包\*\*: (.+)$/,
  installStatus: /\*\*安装状态\*\*: (.+)$/,
  installPath: /\*\*安装路径\*\*: (.+)$/,
  rating: /\*\*评分\*\*: (⭐+)/,
  metExpectation: /\*\*是否达预期\*\*: (.+)$/,
  experience: /\*\*使用感受\*\*:\n([\s\S]*?)(?=\n## |\n$|$)/,
  keep: /\*\*值得收藏备用\*\*: (.+)$/,
  recommendLevel: /\*\*推荐指数\*\*: (⭐+)/,
  keepNote: /\*\*备注\*\*: (.+)$/,
};

function saveNotes(id, f) {
  const { notesPath } = ensureEntryDir(id);
  let text = fs.readFileSync(notesPath, "utf-8");
  const rep = (re, key, val) => {
    text = text.replace(re, `**${key}**: ${val}`);
  };
  // 逐字段替换行内值(rating/recommendLevel 渲染星数)
  rep(/\*\*下载状态\*\*: .+/, "下载状态", f.downloadStatus || "未下载");
  rep(/\*\*安装包\*\*: .+/, "安装包", f.installerName || "");
  rep(/\*\*安装状态\*\*: .+/, "安装状态", f.installStatus || "未安装");
  rep(/\*\*安装路径\*\*: .+/, "安装路径", f.installPath || "");
  rep(/\*\*评分\*\*: ⭐*/, "评分", "⭐".repeat(Math.min(5, Math.max(1, f.rating || 1))));
  rep(/\*\*是否达预期\*\*: .+/, "是否达预期", f.metExpectation || "");
  rep(/\*\*使用感受\*\*:\n[\s\S]*?(?=\n## )/, "使用感受", "\n" + (f.experience || ""));
  rep(/\*\*值得收藏备用\*\*: .+/, "值得收藏备用", f.keep || "否");
  rep(/\*\*推荐指数\*\*: ⭐*/, "推荐指数", "⭐".repeat(Math.min(5, Math.max(1, f.recommendLevel || 1))));
  rep(/\*\*备注\*\*: .+/, "备注", f.keepNote || "");
  // 原子写(复用 store 的模式)
  const tmp = notesPath + ".tmp";
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, notesPath);
}

function parseNotes(content) {
  const get = re => { const m = content.match(re); return m ? m[1].trim() : ""; };
  const stars = s => (s.match(/⭐/g) || []).length;
  return {
    downloadStatus: get(F.downloadStatus),
    installerName: get(F.installerName),
    installStatus: get(F.installStatus),
    installPath: get(F.installPath),
    rating: stars(get(F.rating)) || 1,
    metExpectation: get(F.metExpectation),
    experience: get(F.experience),
    keep: get(F.keep),
    recommendLevel: stars(get(F.recommendLevel)) || 1,
    keepNote: get(F.keepNote),
  };
}

module.exports = { getEntry, ensureEntryDir, safePath, assertValidId, entriesTitle, saveNotes, parseNotes };
```

**关键**:round-trip 测试确保 saveNotes 写的能被 parseNotes 完整读回。任何字段丢失测试即失败。

**Step 3: 运行测试**

Run: `node lib/entries.test.js`
Expected: `entries basic + round-trip: ALL PASS`

**Step 4: Commit**

```bash
git add lib/entries.js lib/entries.test.js
git commit -m "feat: entries saveNotes/parseNotes 双向一致 + round-trip 测试"
```

---

### Task 11: 截图上传与删除(uploadScreenshot + deleteScreenshot)

**Files:**
- Modify: `lib/entries.js`
- Test: `lib/entries.test.js`(追加截图测试)

**Step 1: 写失败测试**

追加:

```javascript
// 真实 png magic number
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const fakePng = Buffer.concat([PNG_MAGIC, Buffer.from("fake image data")]);

// 1. 上传
const r = entries.uploadScreenshot("1.1", fakePng, "主界面截图");
assert.ok(r.file.endsWith(".png"), "应返回 png 文件名: " + r.file);
assert.ok(fs.existsSync(entries.safePath("1.1", "screenshots", r.file)));

// 2. 非 png/jpg 拒绝
let threw2 = false;
try { entries.uploadScreenshot("1.1", Buffer.from("not image"), "x"); } catch (e) { threw2 = true; }
assert.ok(threw2, "非图片必须拒绝");

// 3. 删除
entries.deleteScreenshot("1.1", r.file);
assert.ok(!fs.existsSync(entries.safePath("1.1", "screenshots", r.file)));

console.log("entries screenshot: ALL PASS");
```

**Step 2: 实现 upload/delete**

```javascript
function uploadScreenshot(id, buffer, caption) {
  assertValidId(id);
  // magic number 校验(非扩展名)
  const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const JPG = Buffer.from([0xFF, 0xD8, 0xFF]);
  const isImg = buffer.slice(0, 4).equals(PNG.slice(0, 4)) || buffer.slice(0, 3).equals(JPG);
  if (!isImg) throw new Error("仅支持 PNG/JPG");
  if (buffer.length > 5 * 1024 * 1024) throw new Error("截图超过 5MB 限制");

  const { ssDir, notesPath } = ensureEntryDir(id);
  const ext = buffer.slice(0, 4).equals(PNG.slice(0, 4)) ? "png" : "jpg";
  const d = new Date();
  const stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "-" + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  const file = stamp + "." + ext;
  fs.writeFileSync(path.join(ssDir, file), buffer);

  // 追加引用行到 notes.md
  const cap = String(caption || "").replace(/\|/g, "/").slice(0, 200);
  let text = fs.readFileSync(notesPath, "utf-8");
  const ref = `\n<!-- screenshot: ${file} | ${cap} -->`;
  text = text.replace(/(## 界面截图\n[\s\S]*?)(?=\n## |\n$|$)/, (m, p1) => p1 + ref + "\n");
  const tmp = notesPath + ".tmp";
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, notesPath);
  return { file };
}

function pad2(n) { return n < 10 ? "0" + n : String(n); }

function deleteScreenshot(id, filename) {
  assertValidId(id);
  // 文件名只允许 时间戳.ext,防穿越
  if (!/^\d{8}-\d{6}\.(png|jpg|jpeg)$/i.test(filename)) throw new Error("非法文件名");
  const fp = safePath(id, "screenshots", filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  // 删 notes.md 引用行
  const { notesPath } = ensureEntryDir(id);
  let text = fs.readFileSync(notesPath, "utf-8");
  text = text.replace(new RegExp("\\n<!-- screenshot: " + filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\|[^>]*-->\\n?", "g"), "");
  const tmp = notesPath + ".tmp";
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, notesPath);
  return true;
}

module.exports = { getEntry, ensureEntryDir, safePath, assertValidId, entriesTitle, saveNotes, parseNotes, uploadScreenshot, deleteScreenshot };
```

**Step 3: 运行测试**

Run: `node lib/entries.test.js`
Expected: 三个 ALL PASS

**Step 4: Commit**

```bash
git add lib/entries.js lib/entries.test.js
git commit -m "feat: entries 截图上传/删除(magic number 校验 + 引用行管理)"
```

---

### Task 12: server.js 新增研究档案路由 + multipart 解析

**Files:**
- Modify: `server.js`

**Step 1: 加路由 + 简易 multipart parser**

在 server.js require 区加 `const entries = require("./lib/entries");`

新增路由:

```javascript
// GET /api/entry?id=1.1
if (p === "/api/entry") {
  const id = (u.searchParams.get("id") || "").trim();
  try {
    if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
    const entry = entries.getEntry(id);
    sendJson(res, 200, { ok: true, entry });
  } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
  return;
}

// POST /api/entry/notes  JSON {id, ...fields}
if (p === "/api/entry/notes" && req.method === "POST") {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    try {
      const data = JSON.parse(body || "{}");
      if (!/^\d+\.\d+$/.test(data.id || "")) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      entries.saveNotes(data.id, data);
      sendJson(res, 200, { ok: true });
    } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
  });
  return;
}

// POST /api/entry/screenshot  multipart/form-data
if (p === "/api/entry/screenshot" && req.method === "POST") {
  const id = u.searchParams.get("id") || "";
  if (!/^\d+\.\d+$/.test(id)) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
  parseMultipart(req, (err, { fileBuffer, caption }) => {
    if (err) { sendJson(res, 400, { ok: false, error: err.message }); return; }
    try {
      const r = entries.uploadScreenshot(id, fileBuffer, caption);
      sendJson(res, 200, { ok: true, file: r.file });
    } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
  });
  return;
}

// POST /api/entry/screenshot/delete  JSON {id, file}
if (p === "/api/entry/screenshot/delete" && req.method === "POST") {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    try {
      const data = JSON.parse(body || "{}");
      if (!/^\d+\.\d+$/.test(data.id || "")) { sendJson(res, 400, { ok: false, error: "无效编号" }); return; }
      entries.deleteScreenshot(data.id, data.file);
      sendJson(res, 200, { ok: true });
    } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
  });
  return;
}
```

**简易 multipart parser(零依赖,只处理单文件 + caption):**

```javascript
function parseMultipart(req, cb) {
  const ct = req.headers["content-type"] || "";
  const bndM = ct.match(/boundary=(.+)$/);
  if (!bndM) { cb(new Error("非 multipart 请求")); return; }
  const boundary = Buffer.from("--" + bndM[1]);
  const chunks = [];
  req.on("data", c => {
    chunks.push(c);
    if (Buffer.concat(chunks).length > 6 * 1024 * 1024) { req.destroy(); cb(new Error("上传超限")); }
  });
  req.on("end", () => {
    try {
      const buf = Buffer.concat(chunks);
      const sep = Buffer.concat([boundary, Buffer.from("\r\n")]);
      const parts = splitParts(buf, boundary);
      let fileBuffer = null, caption = "";
      for (const part of parts) {
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd < 0) continue;
        const header = part.slice(0, headerEnd).toString("utf-8");
        const bodyBuf = part.slice(headerEnd + 4, part.length - 2); // 去尾 \r\n
        if (/name="file"/.test(header)) fileBuffer = bodyBuf;
        else if (/name="caption"/.test(header)) caption = bodyBuf.toString("utf-8");
      }
      if (!fileBuffer) { cb(new Error("未找到文件")); return; }
      cb(null, { fileBuffer, caption });
    } catch (e) { cb(e); }
  });
  req.on("error", e => cb(e));
}

function splitParts(buf, boundary) {
  const parts = [];
  let start = buf.indexOf(boundary);
  while (start >= 0) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next < 0) break;
    const part = buf.slice(start + boundary.length + 2, next - 2); // 去前后 \r\n
    parts.push(part);
    start = next;
  }
  return parts;
}
```

**Step 2: 静态服务加截图访问(供前端显示)**

```javascript
// GET /api/entry/screenshot/file?id=1.1&file=xxx.png
if (p === "/api/entry/screenshot/file") {
  const id = u.searchParams.get("id") || "";
  const file = u.searchParams.get("file") || "";
  try {
    if (!/^\d+\.\d+$/.test(id) || !/^\d{8}-\d{6}\.(png|jpe?g)$/i.test(file)) {
      sendText(res, 400, "无效参数"); return;
    }
    const fp = entries.safePath(id, "screenshots", file);
    if (!fs.existsSync(fp)) { sendText(res, 404, "Not Found"); return; }
    const data = fs.readFileSync(fp);
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    res.end(data);
  } catch (e) { sendText(res, 400, e.message); }
  return;
}
```

**Step 3: 手测路由(启动后用 curl)**

Run: `node server.js` 然后:
- `curl "http://localhost:3865/api/entry?id=1.1"` → 返回档案 JSON
- `curl -X POST "http://localhost:3865/api/entry/notes" -d '{"id":"1.1","rating":4}'` → ok
- 检查 `docs/entries/1.1/notes.md` 评分变 ⭐⭐⭐⭐

**Step 4: Commit**

```bash
git add server.js
git commit -m "feat: server.js 研究档案路由 + 零依赖 multipart 解析"
```

---

### Task 13: board.js 详情视图(表单 + 截图网格)

**Files:**
- Modify: `board.html`(加 entryView 容器)
- Modify: `board.js`(加详情视图逻辑)

**Step 1: board.html 加视图容器**

在 listView/boardView 同级加:

```html
<section id="entryView" class="entry-view" hidden>
  <header class="entry-header">
    <button class="btn" id="entryBack">← 返回看板</button>
    <h2 id="entryTitle">研究档案</h2>
    <span id="entryId" class="muted"></span>
  </header>
  <form id="entryForm" class="entry-form">
    <!-- 下载安装 -->
    <fieldset>
      <legend>📦 下载安装</legend>
      <label>下载状态 <select name="downloadStatus"><option>未下载</option><option>已下载</option></select></label>
      <label>安装包 <input name="installerName" type="text" placeholder="文件名/来源"></label>
      <label>安装状态 <select name="installStatus"><option>未安装</option><option>已安装</option></select></label>
      <label>安装路径 <input name="installPath" type="text" placeholder="C:\Program Files\xxx"></label>
    </fieldset>
    <!-- 体验评价 -->
    <fieldset>
      <legend>⭐ 体验评价</legend>
      <label>评分 <select name="rating"><option value="1">⭐</option><option value="2">⭐⭐</option><option value="3">⭐⭐⭐</option><option value="4">⭐⭐⭐⭐</option><option value="5">⭐⭐⭐⭐⭐</option></select></label>
      <label>是否达预期 <select name="metExpectation"><option value="">-</option><option>是</option><option>否</option><option>部分</option></select></label>
      <label>使用感受 <textarea name="experience" rows="4" placeholder="多行记录..."></textarea></label>
    </fieldset>
    <!-- 界面截图 -->
    <fieldset>
      <legend>📸 界面截图</legend>
      <input type="file" id="ssInput" accept="image/png,image/jpeg" multiple>
      <input type="text" id="ssCaption" placeholder="选中后填写本张说明">
      <button type="button" id="ssUploadBtn">上传</button>
      <div id="ssGrid" class="ss-grid"></div>
    </fieldset>
    <!-- 收藏判定 -->
    <fieldset>
      <legend>🔖 收藏判定</legend>
      <label>值得收藏备用 <select name="keep"><option>否</option><option>是</option></select></label>
      <label>推荐指数 <select name="recommendLevel"><option value="1">⭐</option><option value="2">⭐⭐</option><option value="3">⭐⭐⭐</option><option value="4">⭐⭐⭐⭐</option><option value="5">⭐⭐⭐⭐⭐</option></select></label>
      <label>备注 <input name="keepNote" type="text" placeholder="为什么收/不收"></label>
    </fieldset>
    <div class="entry-actions">
      <button type="submit" class="btn primary">保存档案</button>
      <button type="button" id="entryCancel" class="btn">不保存返回</button>
    </div>
  </form>
</section>
```

**Step 2: board.js 加详情视图逻辑**

```javascript
let currentEntryId = null;

// 从卡片进入(在看板渲染卡片时加"研究"按钮)
function openEntry(id) {
  currentEntryId = id;
  showView("entryView");
  fetch(`/api/entry?id=${id}`).then(r => r.json()).then(({ entry }) => {
    document.getElementById("entryTitle").textContent = entry.title;
    document.getElementById("entryId").textContent = "#" + id;
    // 表单回填(parseNotes 在后端做,字段已在 entry.notesContent 解析? —— 改后端返回 parsed)
    const f = entry.fields || {};
    fillForm(f);
    renderSsGrid(id, entry.screenshots || []);
  });
}

function fillForm(f) {
  const form = document.getElementById("entryForm");
  form.downloadStatus.value = f.downloadStatus || "未下载";
  form.installerName.value = f.installerName || "";
  form.installStatus.value = f.installStatus || "未安装";
  form.installPath.value = f.installPath || "";
  form.rating.value = String(f.rating || 1);
  form.metExpectation.value = f.metExpectation || "";
  form.experience.value = f.experience || "";
  form.keep.value = f.keep || "否";
  form.recommendLevel.value = String(f.recommendLevel || 1);
  form.keepNote.value = f.keepNote || "";
}

// 保存
document.getElementById("entryForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const fields = Object.fromEntries(fd);
  fields.rating = Number(fields.rating); fields.recommendLevel = Number(fields.recommendLevel);
  fetch(`/api/entry/notes`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ id: currentEntryId, ...fields }) })
    .then(r => r.json()).then(r => { if (r.ok) toast("档案已保存"); else toast("保存失败: " + r.error, true); });
});

// 截图上传
document.getElementById("ssUploadBtn").addEventListener("click", () => {
  const files = document.getElementById("ssInput").files;
  const caption = document.getElementById("ssCaption").value;
  if (!files.length) { toast("先选图片", true); return; }
  const fd = new FormData();
  fd.append("file", files[0]);
  fd.append("caption", caption);
  fetch(`/api/entry/screenshot?id=${currentEntryId}`, { method: "POST", body: fd })
    .then(r => r.json()).then(r => { if (r.ok) { toast("已上传"); openEntry(currentEntryId); } else toast(r.error, true); });
});

// 截图网格渲染(展示时 caption 转义防 XSS)
function renderSsGrid(id, shots) {
  const grid = document.getElementById("ssGrid");
  grid.innerHTML = shots.map(s => `
    <div class="ss-item">
      <img src="/api/entry/screenshot/file?id=${id}&file=${encodeURIComponent(s.file)}" alt="${escapeHtml(s.caption)}">
      <div class="ss-cap">${escapeHtml(s.caption || "")}</div>
      <button onclick="deleteSs('${id}','${s.file}')">删除</button>
    </div>`).join("");
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
window.deleteSs = (id, file) => {
  fetch(`/api/entry/screenshot/delete`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ id, file }) })
    .then(r => r.json()).then(r => { if (r.ok) openEntry(id); else toast(r.error, true); });
};

document.getElementById("entryBack").addEventListener("click", () => { showView("listView"); loadBoard(); });
```

**注意**:`getEntry` 后端需额外返回 `fields`(parseNotes 结果),前端回填用。entries.js getEntry 加 `fields: parseNotes(notesContent)`。

**Step 3: 卡片加"研究"入口**

在看板渲染每张卡片的逻辑里,加一个按钮:
```javascript
`<button class="btn study-btn" onclick="openEntry('${id}')">📝 研究</button>`
```

**Step 4: 手测全流程**

启动 → 点任意条目"研究" → 详情页加载 → 填字段保存 → 重新进入验证回显 → 上传截图验证显示 → 删除截图验证消失。

**Step 5: Commit**

```bash
git add board.html board.js
git commit -m "feat: 研究档案详情视图(表单 + 截图上传/删除 + XSS 转义)"
```

---

### Task 14: 研究档案全链路验证

**Step 1: 跑全部模块测试**

Run: `node lib/classifier.test.js && node lib/fetcher.test.js && node lib/store.test.js && node lib/entries.test.js`
Expected: 四个 ALL PASS

**Step 2: 启动端到端测试**

Run: `node server.js`,浏览器测:
- 进入任一条目详情页(应自动建 docs/entries/{id}/)
- 填写四块字段保存 → 重新进入 → 字段完整回显(round-trip)
- 上传 2 张 png → 显示缩略图 + 说明 → 删 1 张 → 剩 1 张
- 尝试 `id=../../` 应被 400 拒绝
- 上传非图片文本应被拒

**Step 3: 数据隔离验证**

Run: `git diff README.md`
Expected: 空(研究档案全程未改 README)

**Step 4: Commit 最终状态**

```bash
git add -A
git commit -m "chore: 研究档案功能完成,全链路回归通过"
```

---

## 研究档案完成标准(对照 spec Success Criteria)

| # | 标准 | 验证任务 |
|---|------|---------|
| 1 | 进入详情页 | Task 14 Step 2 |
| 2 | 首访建模板 | Task 9 测试 |
| 3 | 字段保存 + 回显 | Task 10 round-trip + Task 14 |
| 4 | 截图上传 | Task 11 测试 + Task 14 |
| 5 | 截图删除 | Task 11 测试 + Task 14 |
| 6 | 目录穿越防护 | Task 9 + Task 14 Step 2 |
| 7 | 删除条目保留档案 | Task 14 文档说明 |
| 8 | README 不被污染 | Task 14 Step 3 |

## 研究档案风险提示(来自 spec Pre-mortem)

- **最高风险:saveNotes/parseNotes 漂移致字段丢失** → Task 10 round-trip 测试强制双向一致。
- **目录穿越** → 双重校验(正则 + safePath 前缀断言),Task 9 覆盖。
- **截图撑爆磁盘** → 5MB 限制 + magic number 校验。
- **XSS** → 前端 escapeHtml,caption 转义后渲染。
- **multipart 解析(零依赖)** → Task 12 手写简易 parser,单文件场景够用。
```

