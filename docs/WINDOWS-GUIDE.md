# Windows 使用指南

## 安装与首次启动

### 单文件 EXE

下载 `linggankanban-2.3.0-windows-x64.exe` 和同一 Release 的 `SHA256SUMS.txt`，先校验 SHA-256，再双击 EXE。无需安装 Node.js。程序缓存位于 `%LOCALAPPDATA%\LingganKanban\app`，个人数据默认位于 `%USERPROFILE%\Documents\LingganKanban`；两者分离，替换 EXE 不会覆盖数据。

程序优先使用 Microsoft Edge 应用窗口；Edge 不可用时回退到默认浏览器。再次启动会复用已运行的同版本服务，不会创建第二个写入者。

### 便携版与源码版

便携版下载 `linggankanban-2.3.0-windows-portable-x64.zip`，完整解压到有写权限的目录后双击 `start-portable.bat`。包内固定为 Node.js 24.16.0，无需系统 Node.js。不要在压缩包预览窗口内运行。

源码版需要 Node.js 22 或 24；Node.js 20 已停止支持：

```powershell
npm ci
npm run doctor
npm start
```

## 数据、备份与网络边界

主数据是 `DATA.md`；研究笔记、正文和截图位于 `entries/` 或配置的 `ENTRIES_DIR`；事务、恢复、迁移和升级证据位于数据根下 `.linggan/`。其中常用目录包括：

- `.linggan/migration-backups/`：旧格式迁移前副本；
- `.linggan/upgrade-snapshots/`：v2.2 升级前完整快照；
- `.linggan/recovery-imports/`：恢复事务状态和收据；
- `.linggan/idempotency/`：幂等请求状态。

应用本地读取、搜索、备份和恢复预检不依赖网络。网页抓取失败时保留已保存 URL 和已有本地内容，显示失败状态供重试，不会用较差结果静默覆盖有效归档。

## 从 v2.1 / v2.2 升级

1. 停止旧服务并复制整个数据目录；不要让两个版本同时写入。
2. 在旧版本中导出完整备份，记录条目、笔记、正文和截图数量。
3. 将 v2.3 成品放到新目录后启动；启动器先预检、加锁并在需要时创建升级快照，再开放数据 API。
4. 核对数据与 `.linggan/upgrade-snapshots/pre-2.2.0-*` 中的 `manifest.json`。升级中断会在下次启动收敛；证据歧义或验证失败时停止并显示恢复指引。

不要把旧目录直接覆盖为新目录，也不要手工删除事务、锁或快照来“继续启动”。

## 恢复与回滚

恢复默认只读。先停止其他实例并对数据目录副本执行：

```powershell
node scripts/recover.js --help
node scripts/recover.js --json
```

若输出 `ambiguous_recovery`、`data_in_use`、`legacy_instance_may_be_running` 或 `manual_recovery_required`，不要猜测候选或删除锁。保存诊断输出，确认旧进程已停止，再按 `--help` 显式提供事务、候选、`--apply` 与交互确认。每次变更前会生成已验证副本，完成后复验并写入收据；同一操作 ID 重跑不会重复生效。

升级回滚只使用已验证、标记为 restorable 的 `pre-2.2.0-*` 快照。先保留当前失败状态的完整副本，再在 UI/CLI 中预览、核对 manifest SHA-256 并确认。不要用 Git、旧安装包或仓库 `DATA.md` 替换个人数据。

## 校验下载

在 Release 下载目录中执行：

```powershell
Get-FileHash .\linggankanban-2.3.0-windows-x64.exe -Algorithm SHA256
Get-FileHash .\linggankanban-2.3.0-windows-portable-x64.zip -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

文件名和哈希必须逐项完全匹配。EXE 当前可能未做商业代码签名，因此只从可信 Release 获取并强制校验。

## 常见故障与卸载

- 端口 3865 被其他程序占用：停止明确识别的进程，或在源码/便携模式设置 `$env:PORT = "3866"` 后启动；不要结束未知进程。
- “数据正在使用”：关闭旧版本和其他用户会话；活动锁不能被自动窃取。
- “需要人工恢复”：保留数据目录、诊断和快照，不要反复写入；先做只读恢复检查。
- 网页解析失败：检查网络/代理后显式重试；本地条目仍应存在。

卸载前导出并验证完整备份。删除 EXE 或程序缓存不会删除“文档\LingganKanban”；个人数据只有在确认备份可恢复且明确不再需要时才删除。便携/源码版的数据可能与程序同目录，删除目录前必须先检查 `DATA.md`、`entries/` 和 `.linggan/`。
