# Reliable Link Archive 运维与安全发布说明

本文是 RA-5 的运行手册和发布边界说明。归档采用 save-first、archive-second：先把 URL 和已有元数据写入 `DATA.md`，再把归档任务放入队列；外部站点不可达不会撤销已经保存的条目。

## 企业微信 Android 分享

Android 不新增 relay。手机企业微信中的分享动作仍通过已有企业微信自建应用回调进入看板：

1. 在企业微信应用的“接收消息/API 接收”中配置看板的公网 HTTPS 地址，路径必须是 `/api/wecom/callback`。
2. 使用应用的 CorpID、AgentId、Secret、Token、EncodingAESKey 作为环境变量启动服务；这些值不要写入仓库、`DATA.md`、归档产物或日志。
3. 确认手机和企业微信服务器都能访问该地址。若看板在内网，使用已有的 HTTPS 内网穿透或部署在可达主机；穿透工具只负责转发，不增加应用层 relay。免费隧道重启后地址变化时，要同步更新企业微信后台配置。
4. 先在企业微信后台保存配置，确认 GET 校验返回成功；再从 Android 分享一条公开链接。回调应在短时间内返回“已保存，正在归档”或最终归档状态，不能等待抓取完成。

排查顺序：先访问 `GET /api/health`，再确认回调路径、HTTPS、签名密钥和端口映射，最后检查目标站点是否可由运行看板的机器访问。企业微信回调不可达时，直接在看板粘贴 URL；外部内容不可抓取时，使用条目详情中的手动内容归档，不删除原 URL。

## 归档任务、重试与人工兜底

队列文件是 `.linggan/archive-jobs.json`，通过临时文件和同目录原子替换写入。服务重启会把 `running` 恢复成 `queued`，不会并发执行多个归档 worker。每个任务最多四次自动尝试，时间点为立即、5 分钟、1 小时、24 小时；第四次仍不可恢复时进入 `manual_required`，可从 API 或界面执行手动 retry。

状态含义固定如下：

| 状态 | 含义与操作 |
| --- | --- |
| `queued` | 已保存、等待调度；检查 `nextRunAt`。 |
| `running` | 当前 worker 正在处理；重启后会安全回队列。 |
| `partial` | Markdown、元数据或部分图片已保存，但存在降级原因；先查看详情再决定是否重试。 |
| `succeeded` | 必需归档产物完整生成。 |
| `failed` | 本次处理失败且未完成必需产物；可手动 retry。 |
| `manual_required` | 自动重试耗尽、内容被删除/需登录或 X 内容不可用；粘贴正文后手动归档。 |

原始 HTML 压缩前上限为 20 MB。超过上限时跳过 `raw.html.gz`，仍保留 URL、元数据、Markdown 和已成功下载的图片，并在 `metadata.json` 的降级原因中写明“超过 20MB”；这不是整条任务失败。图片和外部页面也应遵守抓取器的大小、超时和安全 URL 限制。

## X/Twitter Cookie 处理

`X_COOKIE` 只能作为进程环境变量传给 `x.com` 或 `twitter.com` 的请求，用于短时读取公开页面的可选降级路径。它不得写入队列、`metadata.json`、备份、发布包、错误对象或日志，也不得通过命令行参数、配置文件或持久化服务保存。

非 X/Twitter 域名禁止使用该 Cookie。X 页面解析失败、需要登录、被限流或已删除时，保留 canonical status URL 和已有元数据，状态转为 `manual_required`；不要把 Cookie 放进人工诊断信息。完成操作后清除当前 shell 的 `X_COOKIE`。

## 备份边界

应用备份包含 `DATA.md` 内容以及每个已保存条目的本地文件：笔记、截图、`archive/metadata.json`、`archive/content.md`、未超过 20 MB 的 `archive/raw.html.gz` 和 `archive/images/` 中的归档图片。导入前会创建迁移备份，文件名和路径经过白名单校验，不能通过备份包写出条目目录。

备份是用户数据，不应提交到 Git 或发布包。不要把 `.linggan/archive-jobs.json` 当作发布输入；它只属于本机运行时，可在服务停止后按需保留用于恢复未完成任务。

## 发布边界与安全验证

发布包只从明确的源码清单构建：根目录发布文件、`assets/readme/`、`lib/`、`scripts/`、`docs/` 顶层文档和 `docs/plans/` 计划文档。它必须排除 `DATA.md`、`docs/entries/`、`.linggan/`、Cookie/secret 文件、日志，以及所有未列入清单的根目录用户资产。发布构建不会覆盖已有同名 ZIP；`-Force` 仅为旧调用方保留，不改变这一安全约束。

验证时使用新的临时输出目录，不要指向已有发布目录：

```powershell
$out = Join-Path ([IO.Path]::GetTempPath()) ("linggan-release-check-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $out | Out-Null
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1 -OutputDirectory $out -DryRun
# 需要实际 ZIP 时去掉 -DryRun；同一 $out 只能构建一次
```

便携包还需要下载并校验官方 Node.js SHA-256，因此应在网络和临时目录均可用时单独执行：

```powershell
$out = Join-Path ([IO.Path]::GetTempPath()) ("linggan-portable-check-" + [guid]::NewGuid().ToString("N"))
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-portable.ps1 -OutputDirectory $out -DryRun
```

发布前至少运行 `npm run check`、`npm test`、受影响的 scraper 测试、`npm run coverage` 和 `node lib/backup.test.js`。覆盖率门禁只统计 archive、archive queue、GitHub 和 X 四个模块，并按文件强制 lines/functions/statements 均不低于 90%；branch 覆盖率同时输出，若本次扩展分支逻辑，应先补齐对应测试再提高门禁。
