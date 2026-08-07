# Windows 单文件与便携运行时

Windows 10/11 x64 用户优先使用 `linggankanban-2.0.0-beta.1-windows-x64.exe`：这是可直接双击的单文件程序，不要求安装 Node.js 或手动解压。`windows-portable-x64.zip` 保留给需要查看完整目录或自行管理运行位置的用户。

## 构建内容

- 官方 Node.js 22.23.2 Windows x64 运行时。
- `package-lock.json` 锁定的生产依赖。
- Windows 自包含 `.NET 8` 单文件启动器，负责释放、诊断和启动本地服务。
- `start-portable.bat` 一键启动器。
- Node.js 完整许可证：`runtime/NODE-LICENSE.txt`。
- 运行时来源与 SHA-256：`runtime/RUNTIME-NOTICE.txt`。

构建脚本会下载官方 ZIP 与 `SHASUMS256.txt`，只有 SHA-256 完全匹配时才继续打包。单文件 EXE 嵌入由同一流程生成的便携包，因此不会使用用户机器上未知版本的 Node.js。

## 单文件版运行方式

- 首次运行将程序释放到 `%LOCALAPPDATA%\LingganKanban\app\<内容哈希>`，后续启动直接复用已验证的缓存。
- 用户数据默认写入 `%USERPROFILE%\Documents\LingganKanban`，与程序缓存分离；升级或删除缓存不会删除收藏与研究档案。
- 已有服务运行时，再次双击只会打开现有看板，不会启动第二个服务。
- 启动失败会显示可读错误信息，不再依赖命令行窗口。
- 当前 Beta 未进行商业代码签名，发布时必须同时提供 SHA-256 校验文件，并仅引导用户从官方 Release 下载。

## 构建

```powershell
npm run package:portable
npm run package:exe
```

重复覆盖现有版本时：

```powershell
npm run package:portable -- -Force
npm run package:exe -- -Force
```

构建 EXE 需要 Windows、.NET 8 SDK，以及对 Node.js 官方发布站点和 npm registry 的网络访问。缓存的 Node ZIP 每次都会重新对照官方 SHA-256。

## 更新策略

- 每次公开发布都重新构建便携包，不从旧包复制运行时或依赖。
- Node.js 22.x 出现安全更新时，更新 `scripts/build-portable.ps1` 的默认版本并重新验证。
- 便携包当前仅支持 Windows x64；ARM64 与 macOS/Linux 继续使用源码方式，除非有真实用户需求。
- 运行时不会写入注册表或系统 PATH。删除 `%LOCALAPPDATA%\LingganKanban` 可移除程序缓存；用户数据需要单独确认后再删除。

官方来源：[Node.js 22.23.2 发布说明](https://nodejs.org/en/blog/release/v22.23.2/)。
