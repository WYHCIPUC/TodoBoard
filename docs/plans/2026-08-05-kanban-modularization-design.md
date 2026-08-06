# 待办看板模块化重构 设计

## Spec Changelog(版本纪律)
- `2026-08-05 · 初版 · 全文 · 首次立项`
- `2026-08-05 · Retrospective · 实现后追加回顾节(不改设计,记录实测偏差)`

## Retrospective(实现后回顾 · 2026-08-05)

### 预测准确度
- **server.js 行数严重失准**:spec 写 538 行(设计时读的版本),实现时发现实际 **844 行**,多出代理探测/隧道/重试/抓取日志/平台兜底解析(fallbackMeta)等增强功能。根因:项目文件在工作期间被另一股力量改动,设计基于过时快照。→ 经验:**写 spec 前必须 `git status` + 确认工作树是最新单一代码源**,不能假设文件未变。
- **store 层设计被现实纠正**:spec 设想 store.js 自己管 fs 读写(有副作用),真实代码是**纯函数**(收 text 返 text,路由管 fs)。纯函数设计更好(易测),实现对齐了真实设计而非 spec。→ 经验:**先读真实代码再设计接口**,不要凭想象设计"应该怎样"。
- **分类基线的主观陷阱**:记基线时我手写"腾讯 Miora 应归 AI 工具",实际算法归"前端 & 设计"(设计/网站/动效命中词多)。→ 经验:**回归基线必须是算法真实输出,不是主观期望**。子代理照真实输出建基线才避免了错误"修正"。

### 漏判风险(Pre-mortem 没预测到的)
- **最高漏判:基于过时代码设计**。Pre-mortem 想了分类漂移/备份误删/multipart,但没想"项目文件会被并发修改"。若非 Task 3 子代理诚实报告"行号与说明不符",会丢掉代理/日志功能。→ 补救:AskUserQuestion 让用户选"重读真实代码",重新定位 store 层真实行号。
- **端口占用串联故障**:本地旧 server 进程残留致 EADDRINUSE,测试链路反复断裂。Pre-mortem 关注代码风险,忽略了运维环境风险。

### Spec 缺口(实现者不得不补的)
- **静态路由扩展**:spec 写"抽离 board.css/js",但漏写 server.js 需新增 `/board.css` `/board.js` 静态路由——抽离后必 404。实现时补了 STATIC 映射表。
- **escapeHtml 命名冲突**:现有 board.js 已有 escapeHtml(仅转义 &<>),spec 说"前端转义"未预警冲突。子代理改用 escapeAttr(转义5字符含引号)解决。
- **测试副作用清理**:新增测试条目留下空 `## 8. 其他` 章节,spec 未说清理方式。实现时用 `git checkout README.md` 还原。

## 背景与目标
- **一句话目标**:把单文件 server.js(538行,抓取+分类+存储+路由全揉在一起)和单文件 board.html(2378行,HTML+CSS+JS 内联)拆成职责单一的模块,加固数据写入安全,同时保持"零依赖、`node server.js` 双击即用"的核心卖点不变。
- **触发场景 / 动机**:当前 server.js 抓取逻辑、分类词库、README 读写、HTTP 路由四类职责完全耦合,改一处分类词要在一堆抓取代码里翻找;board.html 内联导致前端逻辑无法被 lint/复用;README.md 直接覆写无备份无锁,并发新增或误操作可能丢数据。

## 范围外(YAGNI 边界)
- **永不**:不引入构建工具(webpack/vite)、不引入 npm 依赖、不改"零依赖"定位、不换存储后端(SQLite/数据库)。
- **以后可能**:存储后端可替换(README → SQLite)——本期不实现,但 store.js 的接口设计要为它留扩展点(见架构)。多用户/云部署属于另一子项目,不在本期。

## 决策日志
1. **拆分粒度** → 选 4 模块(fetcher/classifier/store/server) → 理由:正好对应抓取/分类/存储/路由四类现有职责,单一职责且每个模块小到可整体读懂 → 否决:更细拆(如把 fetcher 按平台拆 3 文件)过度,当前体量不值得。
2. **数据安全策略** → 选"写入前备份 + 简易文件锁" → 理由:不破坏 README 存储,零依赖可纯 JS 实现 → 否决:用 SQLite 事务(破坏零依赖 + 超出范围)、用第三方文件锁库(破坏零依赖)。
3. **前端拆分** → 选 抽 board.js / board.css,HTML 留结构 → 理由:让 JS 可独立阅读/lint,加载方式不变 → 否决:引入打包工具(破坏零依赖)。
4. **备份保留策略** → 选 保留最近 5 份 + 当天最新 → 理由:防磁盘膨胀,又覆盖"当天多次误操作可回滚" → 否决:无限保留(膨胀)、只留 1 份(连环误操作无救)。
5. **模块路径** → 选 `lib/` 子目录 → 理由:与 server.js 平级清晰,Node 原生 require 即可 → 否决:平级散落根目录(混乱)。

## 假设清单
1. **假设**:本项目仍为单机单人使用,无并发写入高峰 → 验证:看历史用法,看板为本地灵感库 → 若破裂的回退:文件锁防基础并发即可,真出现高并发再上 SQLite(届时走 store.js 抽象替换)。
2. **假设**:Node 原生 `fs.readFileSync/writeFileSync` 在本机单进程下无竞态 → 验证:零依赖约束下无更好方案,且加锁后风险可控 → 若破裂:加进程级文件锁(已纳入本期)。
3. **假设**:8 类分类词库 + 关键词打分 当前分类准确率可接受 → 验证:重构不改变分类算法,行为应完全等价(回归测试保障) → 若破裂:分类改进属另一子项目。
4. **假设**:board.html 内联 JS/CSS 抽出后,浏览器加载行为不变(同源、同目录) → 验证:静态托管路径不变 → 若破裂:回退内联,功能不受影响。
5. **假设**:README.md 增长缓慢(当前 ~250 行),全文读写无性能瓶颈 → 验证:看当前体量 → 若破裂:行数过万后再考虑流式/索引。

## 架构与组件

```
待办任务汇总/
├─ server.js          # 路由编排 + 参数校验(瘦身到 ~120 行)
├─ start.bat          # 不变
├─ board.html         # 结构 only,link board.css + script board.js
├─ board.css          # 从 board.html <style> 抽出
├─ board.js           # 从 board.html <script> 抽出
├─ README.md          # 数据存储(不变)
└─ lib/
   ├─ fetcher.js      # 抓取层 [public]
   ├─ classifier.js   # 分类层 [public]
   ├─ store.js        # 存储层 [public] + 内部含备份/锁 [internal]
   └─ constants.js    # CATS / CAT_KEYWORDS 等常量 [public]
```

**接口契约稳定性标注:**

- `lib/fetcher.js` `[public]`
  - `fetchMeta(url)` → `{url, category, title, author, desc, image, site, ...}`
  - `parseUrl(url)` → `{kind, bvid?, repo?}`
  - 纯函数 + 网络调用,无副作用,不碰文件系统。易测。
- `lib/classifier.js` `[public]`
  - `classify(text)` → 分类名(string)
  - `categoryOfSectionTitle(t)` → 分类名(string)
  - `guessSource(url)` → 来源名(string)
  - 纯函数,无副作用。最易测。
- `lib/store.js` `[public]`
  - `readAll()` → README 全文(string)
  - `addEntry({name,url,author,desc,difficulty,image,site,category})` → `{id, snippet}`
  - `deleteEntry(id)` → `boolean`
  - `setStatus(id, st)` → `boolean`
  - `setNote(id, note)` → `boolean`
  - `[internal]` writeWithBackup(text) — 写入前备份 + 原子写(tmp 文件 + fs.rename);锁用进程内互斥(Promise 队列串行化所有写操作,因为单进程零依赖,无需跨进程文件锁)
  - `[experimental]` 存储后端接口形状:`readAll/writeRaw` 为未来 SQLite 实现预留替换点(本期仍是 README)。breaking change 风险:未来切换实现时,`writeRaw` 的参数语义可能变,届时需同步迁移所有调用方。
- `server.js` `[public]`
  - HTTP 服务入口,仅路由分发 + 参数校验,不含业务逻辑。

**模块依赖关系:**
```
server.js ──> fetcher.js ──> classifier.js ──> constants.js
         └─> store.js ─────────────────────────> constants.js
```
无循环依赖。constants.js 是叶子节点,被三方共享。

## 数据流
- **新增条目**:浏览器 POST /api/add → server 校验 url → fetcher.fetchMeta(网络抓取)→ classifier 分类 → store.addEntry(读README→算编号→插入→备份→写入)→ 返回 id。
- **删除/状态/笔记**:浏览器 POST → server 校验 id 格式 → store 对应方法(读改写,经备份锁)→ 返回。
- **读取**:GET /api/data → store.readAll → 返回全文。
- **抓取预览**:GET /api/fetch-meta → server 校验 → fetcher.fetchMeta → 返回(不落盘)。

## 错误处理(按维度枚举)
- **输入异常**:url 非 http(s) → 400;id 不匹配 `\d+\.\d+` → 400;status 非白名单 → 400;JSON 解析失败 → 500。均已有,保持。
- **依赖故障(网络)**:抓取超时(8s)、4xx/5xx、GitHub API 限流、B站 API 风控 → fetcher 抛错;新增时回退到前端传字段;预览时返回 422 + 错误信息。保持现有回退策略。
- **依赖故障(文件)**:README 读失败 → 500;写失败(磁盘满/权限)→ 500 + 返回错误。**回滚语义**:原子写用"写 tmp → rename 覆盖"——rename 失败则原 README 不动(本次操作视为未发生),不丢既有数据;只有 rename 已破坏原文件这种极端情况才用写前备份恢复。即:备份是"rename 后才发现原文件已损"的兜底,不是常规失败回滚。
- **资源耗尽(备份膨胀)**:保留策略只清理 `README.backup-*` 前缀文件,删前校验目标存在且为备份文件,绝不触碰 `README.md` 本体;保留最近 5 份 + 当天最新。
- **状态冲突**:并发写导致编号重复 → 进程内写队列串行化(本期新增)。
- **超时与部分失败**:抓取超时已有(保持);写入中断 → 原子写(tmp + rename,本期新增)。

## 非功能性约束 (NFR)
- **性能 [硬约束]**:启动 < 1s(零依赖,无构建);单条抓取 ≤ 现有水平(重构不应引入额外网络往返)。本地文件读写 O(n) 可接受(假设5)。
- **安全 [硬约束]**:路径校验防目录穿越(静态服务只允许 board.html/board.css/board.js);写入前备份防数据丢失;无 eval/无外部代码执行。
- **可维护性 [硬约束]**:每模块单一职责;无循环依赖;server.js 不含业务逻辑(此为本期首要目标)。
- **可访问性 [非约束]**:本期不动前端交互,沿用现状。
- **i18n [非约束]**:中文工具,沿用现状。
- **成本 [非约束]**:本地单机,无运行成本。
- **可观测性 [硬约束]**:保留现有 console.log 启动信息;错误响应带可读 message。
- **数据合规 [非约束]**:本地数据。

## Success Criteria(含验证方法与时机)
1. **零依赖保持** → 验证:`node -e "require('./server.js')"` 启动无需 node_modules;grep 确认无 `require` 指向非内置模块 → 时机:**后置**(实现完启动验证)。
2. **启动方式不变** → 验证:`start.bat` / `node server.js` 仍打开 http://localhost:3865 看板 → 时机:**后置**。
3. **行为完全等价(回归)** → 验证:对同一组链接(B站/GitHub/网页各1),重构前后 fetchMeta 输出一致;对同一 README,add/delete/status/note 输出一致 → 时机:**前置**(实现前先记录当前行为快照作为回归基线)+ **同步**(每模块抽完跑对比)。
4. **模块职责单一** → 验证:server.js 行数 < 150 且不含 fetch/classify/buildSnippet 等业务函数名 → 时机:**后置**。
5. **数据写入安全** → 验证:连续 3 次 add 后,存在 ≥1 份 README.backup;模拟写入中途中断(测 writeWithBackup 用 tmp+rename)不产生半截文件 → 时机:**同步**(store 模块抽完即测)。
6. **前端抽离不破坏 UI** → 验证:浏览器加载 board.html 后 console 无 404,看板渲染与抽离前一致 → 时机:**后置**。
7. **模块可独立测** → 验证:classifier.classify 可脱离 HTTP 直接 require 调用并返回正确分类(写 1 个 node 测试脚本) → 时机:**前置**(先写测试再抽)。
```
