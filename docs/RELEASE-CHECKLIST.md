# v2.3.1 发布检查清单

本清单 fail-closed。任何本地门禁失败、证据变化或远端规则不明都停止发布；不得 force-push、绕过保护或使用旧产物替代。`DATA.md`、备份、凭据、旧包、视频和无关未跟踪文件始终不在发布范围。

## 1. 本地候选门禁

- [ ] 捕获 `git status --short`、HEAD 和 T5 自有文件外部快照；确认未暂存、未提交。
- [ ] Node.js 22 与 24 分别执行 `npm ci`、`npm run check`、`npm run coverage`、`npm run test:scrapers:fixtures`、`npm run test:e2e`、`npm run test:e2e:data`、`npm run test:launcher`。
- [ ] `npm run coverage` 对冻结高风险文件的 statements、branches、functions、lines 逐文件均不低于 90%，不接受聚合豁免。
- [ ] 执行 T5 测试：

```powershell
npm test -- --test scripts/build-release.test.js --test scripts/build-portable.test.js --test scripts/build-executable.test.js --test scripts/smoke-executable.test.js --test scripts/recovery-drill.test.js --test scripts/release-drill.test.js
```

- [ ] 执行 `scripts/recovery-drill.ps1`，覆盖中断写入、锁竞争/owner 崩溃、歧义停止、升级/回滚、验证失败、确认恢复和幂等重跑；仅使用一次性数据。
- [ ] 在两个全新输出目录运行 `scripts/build-executable.ps1`，然后用 `scripts/release-drill.ps1 -ComparisonDirectory` 证明全部资产逐字节一致。
- [ ] 对同一 EXE 执行 `scripts/smoke-executable.ps1`；确认离线启动、HTTP 读写、健康检查、二次启动复用和仓库 `DATA.md` 未变化。
- [ ] fresh extraction 的源码包精确匹配 `scripts/release-allowlist.txt`，便携包清单和 Node.js 24.16.0 运行时哈希匹配 `scripts/runtime-node.json`。
- [ ] `SHA256SUMS.txt` 名称大小写完全一致，列出且验证两个 manifest、源码 ZIP、便携 ZIP 和 EXE，不包含自身。
- [ ] 显式扫描包、候选 Git 树与拟上传清单：无用户数据、备份、`.env`、Cookie/token/平台 secret、隧道配置、旧包、视频或未列文件。

## 2. Windows 与恢复人工复核

- [ ] Windows 10/11 x64 全新用户分别验证单文件 EXE 与便携 ZIP，无需系统 Node.js。
- [ ] 中文/空格路径、普通用户权限、端口占用、活动锁、旧实例仍可能运行、无 Edge 回退均给出可操作诊断。
- [ ] v2.1 / v2.2 数据副本升级到 v2.3；核对 `DATA.md`、条目 UID、笔记、正文、截图和归档证据。
- [ ] 核对 `.linggan/migration-backups/` 与 `.linggan/upgrade-snapshots/`（当前启动不会自动创建升级快照，若存在则必须验证 manifest）；回滚只对显式副本/快照执行，绝不以仓库 `DATA.md` 作夹具。
- [ ] 断网时本地浏览、搜索、备份、恢复预检仍可用；抓取失败保留已保存 URL 和现有内容。

## 3. 远端门禁（本地准备阶段保持 Pending）

- [ ] `gh auth login` 后，`gh auth status` 对预期 host/account 成功且权限足够。
- [ ] 用 `gh repo view --json nameWithOwner,defaultBranchRef` 记录精确仓库与默认分支。
- [ ] 用 rulesets、branch protection 和 tag protection API 记录所需 review、checks、签名、线性历史、部署和 tag 限制。
- [ ] 确认候选 commit 满足规则，目标版本 tag 和 Release 均不存在（注意：`v2.3.0` tag 已存在于旧提交，不能复用；新版本需显式确定）。
- [ ] 审查 `git diff --cached --name-status`、精确 tag target、安装资产、两版介绍视频和 `SHA256SUMS.txt`。
- [ ] 仅在以上全部保持绿色后，按可观察的独立步骤 push commit、等待远端 checks、创建 tag、创建 draft Release、上传并回读资产、最后公开。
- [ ] 若 tag 后失败，按仓库批准的补偿流程删除未公开 Release、删除本次 tag 并 GET ref 确认 404；补偿失败标记 `release_recovery_required` 并停止自动重试。

只有所有本地门禁和远端检查保持绿色，才公开稳定版；任何失败都保留证据并停止发布。
