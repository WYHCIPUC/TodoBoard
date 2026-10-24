# 风险排查与升级安全加固

**状态**：已完成（2026-10-24）<br>
**基线**：v2.3.0（`3732e7b`）<br>
**范围**：代码、依赖、配置与升级路径的只读审计，以及直接相关的安全/兼容修复；不新增业务功能，不改数据格式<br>
**依据**：[项目原则](../PROJECT-PRINCIPLES.md)、[v2.2 可信恢复计划](2026-08-14-v2.2-trusted-recovery-review-plan.md)

## 审计方法

- **依赖**：`npm audit`、`npm outdated`、`npm ls --all`、锁文件与运行时版本比对；在干净 `npm ci` 后复测。
- **代码**：静态检索危险模式（`eval`/子进程/递归删除/路径拼接/`innerHTML`）、逐模块阅读存储、归档、恢复、升级、鉴权与出站请求边界，并复用现有 52 个测试文件作为行为基线。
- **配置**：启动脚本、CI 工作流、发布清单、`.nvmrc`、`engines`、固定 Node 运行时哈希、CSP 与安全策略文档。
- **升级路径**：`migrate.js`、`upgrade.js`、`bootstrap.js`、`scripts/recover.js`、v1/v2 数据迁移与快照/marker 生命周期。

## 风险与隐患清单

| ID | 位置 | 风险 | 影响 | 优先级 | 处置 |
|---|---|---|---|---|---|
| R1 | `package-lock.json`（`axios`/`follow-redirects`/`undici`/`brace-expansion`） | 4 项高危传递依赖漏洞：axios 原型污染/ReDoS/重定向 SSRF 绕过、undici TLS 校验旁路与 DoS、follow-redirects 凭据头泄漏 | 生产依赖（钉钉 SDK）与开发/打包链路可被恶意响应或重定向触发 | P1 | **已修复**：锁文件升级到 axios 1.20.0、follow-redirects 1.16.1、undici 7.30.1/6.29.1、brace-expansion 2.1.7/5.0.12；`npm audit` 归零 |
| R2 | `server.js` 启动流程（原 `ensureDataFile()` 调用点） | `DATA.md` 缺失但 `entries/` 仍有档案时，会用 `DATA.example.md` 静默“初始化” | 用户数据变成不可见孤儿档案，后续写入基于空看板；升级/恢复场景可能误判为全新安装 | P1 | **已修复**：启动前只读调用 `bootstrap.inspectInstall`；`data_missing`/`corrupt`/版本过新时拒绝启动并给出保全指引 |
| R3 | `lib/upgrade.js`、`lib/backup.js`、`lib/backup-format.js` | 升级合同版本与产品版本混用：`APP_VERSION="2.2.0"`、备份默认 `appVersion="2.2.0"`，而产品为 2.3.0 | 备份/快照元数据失真；未来直接把常量改成 package 版本会让旧 marker/快照校验失败 | P1 | **已修复/加固**：拆出 `MIGRATION_CONTRACT_VERSION`（冻结 2.2.0，保留 `APP_VERSION` 兼容别名）；备份默认写当前产品版本；新增回归断言 |
| R4 | `docs/WINDOWS-GUIDE.md`、`docs/releases/v2.2.0.md`、`docs/releases/v2.3.0.md`、`lib/bootstrap.js`/`lib/upgrade.js` | 文档声称启动器会加锁并自动创建升级快照；实际 `server.js`/launcher 未调用 `bootstrap`/`runUpgrade`，仅执行 schema 迁移 | 用户误以为已有完整回滚快照与跨进程锁；升级失败时缺少预期保护 | P1 | **已修正文档 + 部分实现**：两版发布说明与 Windows 指南已更正；启动数据门禁与同目录实例锁已落地；完整升级编排（容量预检、自动快照、旧进程审计）仍列为独立变更 |
| R5 | `board.js` + `server.js /api/archive/retry` | 从旧版本升级、从未入队的条目显示「排队中」且无法重试 | 升级后旧条目无法进入归档闭环，待处理中心持续告警 | P2 | **已修复**：新增 `not_archived`「未归档」状态与「开始归档」入口；重试接口对无任务条目创建首个任务 |
| R6 | `server.js` 全局启动路径 | 没有跨进程数据目录锁；同目录不同端口可同时运行两个实例 | 并发写入 `DATA.md`/队列，可能互相覆盖或产生混合状态 | P2 | **已修复（同目录范围）**：新增 `lib/instance-lock.js`，启动时原子取得数据目录实例锁；第二实例退出 1；崩溃锁按 PID/heartbeat 判定并隔离；跨卷互斥仍由既有 `volume-lock` 负责导入事务 |
| R7 | `start.bat`、`start-portable.bat` | 提示“Node.js 20 or newer”；错误日志路径指向不存在的 `docs\server-error.log` | Node 20 已不受支持，用户按提示安装后仍启动失败；故障时找不到日志 | P2 | **已修复**：改为 Node.js 22+；日志路径改为 `.linggan\server-error.log` |
| R8 | `SECURITY.md` | 版本支持表仍把 2.1.x 标为当前稳定版 | 安全报告与支持范围判断错误 | P2 | **已修复**：2.3.x 当前稳定，2.2.x 安全修复，2.1.x 及更早仅升级/迁移 |
| R9 | `.gitignore` | 未忽略 `build/`（node-gyp 本地产物） | 容易误提交 `.node` 二进制与中间对象 | P3 | **已修复**：忽略 `/build/` |
| R10 | `AGENTS.md` | 声称 `.nvmrc` 固定 22，实际为 24 | 贡献者运行时预期不一致 | P3 | **已修复**：说明 `.nvmrc` 为 24，CI 覆盖 22/24 |
| R11 | `lib/dingtalk.js` `reply()` | 回复 webhook 无超时与响应上限 | 钉钉侧挂起时回调长时间等待；超大响应占用内存 | P3 | **已修复**：`createReply` 支持注入，默认 10s 超时、64 KiB 响应上限，超时/超限销毁请求并返回 `false` |
| R12 | `server.js` `recordError()` | 错误日志只追加不轮换 | 长期异常下磁盘增长 | P3 | **已修复**：新增 `lib/error-log.js`，超过 1 MiB 复制为 `.previous` 后截断，轮换失败不阻断服务 |
| R13 | `playwright.config.js`、`e2e/trusted-recovery.spec.js` | 引用了未声明的 `@playwright/test`，而 CI 实际执行 Python Playwright | 开发者按配置运行会失败，形成“看起来有覆盖”的错觉 | P3 | **已修复**：删除无引用的 JS 配置与 spec；真实门禁保持 `browser-smoke.js` + Python Playwright |
| R14 | `package.json` devDependencies | `c8@10`、`node-gyp@12` 有更新主版本 | 仅开发工具链；贸然升级会改变覆盖率/原生构建行为 | P3 | **接受**：非安全问题，另行评估 |
| R15 | `.github/workflows/release-candidate.yml` | 版本输入默认值 `2.3.0` | 下次升版若忘记修改，工作流会因版本不一致失败 | P3 | **接受**：workflow 已校验 package 版本与输入一致，失败是显式的 |

## 已实施修复说明

### 1. 依赖安全升级（R1）

- **原因**：`npm audit` 报告 4 项 high；其中 axios/follow-redirects 位于生产依赖钉钉 SDK，undici 随 cheerio 发布。
- **改动**：仅更新 `package-lock.json` 中 6 个传递包，`package.json` 不变；全部在原有 semver 范围内。
- **影响**：安装体积与 API 不变；钉钉 SDK 与 cheerio 已做 require/实例化冒烟。
- **回滚**：还原锁文件并执行 `npm ci`。

### 2. 启动数据完整性门禁（R2）

- **原因**：`ensureDataFile()` 无条件用示例数据补文件，无法区分全新安装与数据丢失。
- **改动**：`server.js` 新增 `startupInstallState()`/`assertSafeStartup()`，复用 `bootstrap.inspectInstall` 的 `fresh`/`existing`/`data_missing`/`corrupt`/`downgrade_rejected` 判定；只在安全状态继续。
- **影响**：全新安装照常初始化；已有条目但缺 `DATA.md`、文件不可读或版本过新时退出码 1，且不写任何文件。
- **兼容**：只读检查，无格式变更；所有既有启动测试通过。

### 3. 升级/备份版本元数据（R3）

- **原因**：`APP_VERSION` 名为应用版本却承担迁移合同版本；备份默认写死 2.2.0。
- **改动**：
  - `lib/upgrade.js` 引入 `MIGRATION_CONTRACT_VERSION = "2.2.0"`，注释说明冻结原因；内部全部改用该常量，保留 `APP_VERSION` 兼容导出。
  - `lib/backup.js`/`lib/backup-format.js` 的默认 `appVersion` 改为读取当前 `package.json` 版本。
- **影响**：旧 marker 路径与旧快照校验保持 `2.2.0` 不变；新导出备份记录真实产品版本；旧备份仍按 semver 正常解析。
- **验证**：`lib/upgrade.test.js` 冻结合同版本与 marker 名；`lib/backup*.test.js` 校验默认版本来源。

### 4. 旧条目归档入口（R5）

- **原因**：服务端 `/api/archive/statuses` 会返回 `not_archived`，前端映射成「排队中」且无可用操作；重试接口对无任务条目返回 404。
- **改动**：
  - `board.js` 增加 `not_archived`（未归档）状态、可重试集合与「开始归档」按钮；成功后提示「归档任务已创建」。
  - `server.js` 重试接口在无现有任务时调用 `capture.queueArchive(id, "手动重试")`，返回 202 与首个任务状态。
- **影响**：升级遗留条目可以重新进入归档闭环；已有任务的行为（409/202）不变。

### 5. 文档与配置对齐（R4、R7–R10）

- `docs/WINDOWS-GUIDE.md`：明确当前启动只做只读检查、实例锁与 schema 迁移（自动备份到 `migration-backups`），不自动创建升级快照；升级前必须手工复制整个数据目录。
- `docs/releases/v2.2.0.md`、`docs/releases/v2.3.0.md`：增加运行时更正说明，避免继续暗示自动快照。
- `start.bat`/`start-portable.bat`：Node.js 22+ 与真实错误日志路径。
- `SECURITY.md`：更新支持版本表。
- `.gitignore`：忽略 `/build/`；`AGENTS.md`：修正 `.nvmrc` 与运行时说明。

### 6. 同数据目录实例锁（R6）

- **原因**：`store.mutate` 只做进程内串行；同目录不同端口可并发写 `DATA.md` 与队列。
- **改动**：新增 `lib/instance-lock.js`：
  - 在 `controlDir/instance.lock` 以原子 `mkdir` 取得锁，写入 `owner.json`（pid、进程启动时间、nonce、createdAt、heartbeat）。
  - 每 10 秒更新 heartbeat；正常退出在 `process.on("exit")` 中释放。
  - 第二实例检测到存活 owner 时退出 1；PID 已退出且 heartbeat 超过 120 秒时，将锁原子重命名为 `instance.lock.stale-*` 保留证据后再取锁。
  - 锁内容无法验证时 fail closed，不自动删除。
- **兼容**：`bootstrap.hasUserEvidence` 忽略实例锁，避免首次启动崩溃留下的锁被误判为已有数据；不改变备份事务的既有 volume/resource lock。
- **验证**：`lib/instance-lock.test.js` 覆盖同进程互斥、跨进程拒绝、释放后重取、陈旧锁隔离与无效锁 fail closed；手工双实例验证第二实例退出 1。

### 7. DingTalk 回复超时（R11）

- **改动**：`lib/dingtalk.js` 抽出 `createReply({ request, timeoutMs, maxBodyBytes })`；生产默认 10 秒超时、64 KiB 响应上限。超时、错误、超限均只结算一次并返回 `false`；超时/超限主动销毁请求。
- **影响**：钉钉 webhook 挂起或返回异常大响应时不再无限等待；正常回复行为不变。
- **验证**：`lib/dingtalk.test.js` 用注入的 fake request 覆盖成功、超时、错误、超大响应和非法 URL。

### 8. 错误日志轮换（R12）

- **改动**：新增 `lib/error-log.js`，默认上限 1 MiB；写入前超过上限时复制为 `<file>.previous` 后截断；轮换或写入失败不抛出、不阻断服务。
- **影响**：长期异常不再无界增长，仍保留上一份日志用于排查。
- **验证**：`lib/error-log.test.js` 覆盖轮换、上一份保留、最新记录继续写入与不可写目录降级。

### 9. 失效 Playwright 配置（R13）

- **改动**：删除未被引用的 `playwright.config.js` 与 `e2e/trusted-recovery.spec.js`；CI 继续使用 `e2e/browser-smoke.js` 与 `e2e/trusted-recovery-playwright.py`。
- **影响**：不再暗示存在可运行但缺少依赖的 JS 测试入口，也不新增 `@playwright/test`。
- **验证**：全仓库检索无引用；`npm run test:e2e` 仍通过。

## 验证结果

| 检查 | 结果 |
|---|---|
| `npm audit`（干净 `npm ci` 后） | 0 漏洞；axios 1.20.0、follow-redirects 1.16.1、undici 7.30.1/6.29.1、brace-expansion 2.1.7/5.0.12 |
| `npm test`（Node 22.23.1） | 54 个测试文件全部通过 |
| `npm test`（固定 Node 24.16.0） | 54 个测试文件全部通过 |
| `npm run coverage` | Statements 98.35%、Branches 92.23%、Functions 100%、Lines 98.35%，逐文件 90% 门禁通过 |
| `npm run test:e2e` | Chrome CDP 桌面/390px/离线/键盘主流程通过 |
| `npm run test:scrapers:fixtures` | GitHub、Bilibili、Readability、X 4 个夹具文件通过（Bilibili 可选网络信息告警不影响夹具断言） |
| `npm run build:demo` | 在线 Demo 构建成功 |
| 固定运行时 | `node-v24.16.0-win-x64.zip` SHA-256 与 `scripts/runtime-node.json` 一致，Node 24 `npm run check` 通过 |
| 启动门禁手工/集成验证 | 缺 `DATA.md` 且有档案 → 退出 1 且不创建文件；版本 99 → 退出 1 且数据字节不变；全新目录正常初始化 |
| 实例锁 | 同进程与跨进程第二实例均被拒绝；正常退出释放；死 PID + 过期 heartbeat 被隔离为 `.stale-*` 后取得新锁；无效锁 fail closed |
| 旧条目归档 | 无任务条目调用重试 → 202、`created=true`、任务可查询 |
| 钉钉回复 | 成功、超时、错误、超大响应、非法 URL 均按预期结算，且超时/超限销毁请求 |
| 错误日志轮换 | 超过 1 MiB 生成 `.previous`，最新记录继续写入；不可写目录不抛异常 |
| Playwright 配置 | 删除无引用的 JS 配置与 spec；`npm run test:e2e` 继续通过 |

## 兼容与回滚

- 数据格式仍为 v2，未改变 `DATA.md`、档案、备份与队列 schema。
- 新备份的 `appVersion` 变为 2.3.0；旧备份（含 2.1.0/2.2.0）仍可解析与导入。
- 升级 marker/快照合同保持 2.2.0，不触发存量用户重新迁移。
- 回滚：还原本次文件并执行 `npm ci`（锁文件回滚）即可；无数据迁移副作用。

## 后续建议（未纳入本次）

1. 以独立变更接入完整升级编排：容量预检、自动升级快照、旧进程审计与锁冲突只读服务；需 Windows 成品演练。
2. 评估 `c8`/`node-gyp` 主版本升级；在下次正式发版时同步更新 `release-candidate.yml` 默认版本与发布清单标题。
