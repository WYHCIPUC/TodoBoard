# Windows 便携运行时

`linggankanban-2.0.0-beta.1-windows-portable-x64.zip` 面向不希望安装 Node.js 的 Windows 10/11 x64 用户。

## 构建内容

- 官方 Node.js 22.23.2 Windows x64 运行时。
- `package-lock.json` 锁定的生产依赖。
- `start-portable.bat` 一键启动器。
- Node.js 完整许可证：`runtime/NODE-LICENSE.txt`。
- 运行时来源与 SHA-256：`runtime/RUNTIME-NOTICE.txt`。

构建脚本会下载官方 ZIP 与 `SHASUMS256.txt`，只有 SHA-256 完全匹配时才继续打包。Node.js 22.23.2 是 2026-07-29 发布的安全更新，因此便携版不使用本机较旧的运行时。

## 构建

```powershell
npm run package:portable
```

重复覆盖现有版本时：

```powershell
npm run package:portable -- -Force
```

构建需要网络访问 Node.js 官方发布站点和 npm registry。缓存的 Node ZIP 每次都会重新对照官方 SHA-256。

## 更新策略

- 每次公开发布都重新构建便携包，不从旧包复制运行时或依赖。
- Node.js 22.x 出现安全更新时，更新 `scripts/build-portable.ps1` 的默认版本并重新验证。
- 便携包当前仅支持 Windows x64；ARM64 与 macOS/Linux 继续使用源码方式，除非有真实用户需求。
- 运行时不会写入注册表或系统 PATH，删除解压目录即可卸载。

官方来源：[Node.js 22.23.2 发布说明](https://nodejs.org/en/blog/release/v22.23.2/)。
