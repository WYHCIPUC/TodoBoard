# Windows 单文件与便携运行时

v2.3.0 提供 `linggankanban-2.3.0-windows-portable-x64.zip` 与 `linggankanban-2.3.0-windows-x64.exe`。两者内置同一套 Windows x64 运行环境，不要求用户安装 Node.js；源码方式需要 Node.js 22 或 24，Node.js 20 不受支持。

## 固定运行时

运行时唯一来源是 `scripts/runtime-node.json`：Node.js 24.16.0、官方 Windows x64 ZIP、ZIP SHA-256 与解包后 `node.exe` SHA-256 均固定在候选提交中。构建不会查询 `latest` 或在运行时解释在线校验表；下载内容与任一固定哈希不符即停止。

便携包包含：

- `runtime/node.exe`、`runtime/NODE-LICENSE.txt` 与 `runtime/RUNTIME-NOTICE.txt`；
- `package-lock.json` 对应的生产依赖；
- 为内置 Node.js 24 ABI 构建的 `build/Release/volume_lock.node`；
- `start-portable.bat`、应用源码和恢复 CLI。

## 数据边界

单文件 EXE 将程序缓存放在 `%LOCALAPPDATA%\LingganKanban\app\<内容哈希>`，数据默认放在 `%USERPROFILE%\Documents\LingganKanban`。替换 EXE 或清理程序缓存不会删除数据。便携版和源码版默认在应用目录保存数据；可用 `README_FILE`、`ENTRIES_DIR` 等变量显式改到独立数据目录。

发布包绝不包含 `DATA.md`、用户备份、`.linggan/`、`docs/entries/`、归档队列、日志、Cookie、令牌、企业微信/钉钉密钥、隧道配置、旧压缩包或视频。

## 可复现构建

在全新的输出目录构建；不要对旧目录使用覆盖参数：

```powershell
$out = Join-Path $env:TEMP ("linggankanban-2.3.0-" + [guid]::NewGuid().ToString("N"))
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-executable.ps1 -OutputDirectory $out
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-executable.ps1 -ExecutablePath (Join-Path $out "linggankanban-2.3.0-windows-x64.exe")
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-drill.ps1 -ReleaseDirectory $out
```

构建只从 `scripts/release-allowlist.txt` 复制普通文件，拒绝缺失、额外、链接、路径穿越和敏感内容。ZIP 条目按路径排序并统一为 1980-01-01 时间戳。`SHA256SUMS.txt` 名称固定、UTF-8 无 BOM、使用 LF；上传前必须在全新解压目录重新核对清单、运行时和所有哈希。

构建需要 Windows、PowerShell 5.1+、.NET 8 SDK、Node.js 官方下载站和 npm registry。构建联网不代表应用必须联网：离线门禁使用不可达代理启动已解压成品，并验证本地读写、健康检查和恢复状态。

## 更新与校验

升级运行时必须修改 `scripts/runtime-node.json` 的全部固定字段，重新运行两次干净构建并比较所有产物。用户可在下载目录运行：

```powershell
Get-Content .\SHA256SUMS.txt
Get-FileHash .\linggankanban-2.3.0-windows-portable-x64.zip -Algorithm SHA256
Get-FileHash .\linggankanban-2.3.0-windows-x64.exe -Algorithm SHA256
```

只有与 `SHA256SUMS.txt` 完全一致的资产才可使用。
