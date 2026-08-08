<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="灵感工作台：本地优先的灵感收集、研究与头脑风暴工作台">
</p>

<p align="center">
  <strong>把散落的链接变成可研究的项目库，再让不同项目的长处碰撞成新方案。</strong>
</p>

<p align="center">
  <a href="https://github.com/WYHCIPUC/TodoBoard/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/WYHCIPUC/TodoBoard/ci.yml?branch=main&style=flat-square" alt="CI 状态"></a>
  <a href="https://wyhcipuc.github.io/TodoBoard/?demo=1"><img src="https://img.shields.io/badge/在线_Demo-立即体验-C2410C?style=flat-square" alt="在线 Demo"></a>
  <a href="https://github.com/WYHCIPUC/TodoBoard/releases"><img src="https://img.shields.io/badge/Windows-一键启动-221D16?style=flat-square" alt="Windows 一键启动版"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/WYHCIPUC/TodoBoard?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/数据-本地_Markdown-4F7C69?style=flat-square" alt="数据保存在本地 Markdown">
</p>

<p align="center">
  <a href="https://wyhcipuc.github.io/TodoBoard/?demo=1"><strong>在线体验</strong></a> ·
  <a href="https://github.com/WYHCIPUC/TodoBoard/releases"><strong>下载 Windows 版</strong></a> ·
  <a href="#快速开始">源码运行</a> ·
  <a href="#文档与开发">文档</a>
</p>

## 两个核心，一个工作流

<p align="center">
  <strong>链接 / 想法</strong> → <strong>灵感来袭</strong> → 本地项目库 → <strong>头脑风暴</strong> → <strong>方案 / MVP</strong><br>
  <sub>收集与研究 · 关联与融合</sub>
</p>

### 01 · 灵感来袭

粘贴网页、GitHub 仓库或视频链接，自动补全标题、作者、摘要和分类。随后可以在列表或看板中筛选、记录笔记、保存正文，并把真正重要的内容推进到研究流程。

<p align="center">
  <img src="./assets/readme/showcase-list.png" width="100%" alt="灵感来袭列表视图，展示统计、分类筛选、研究入口和待研究项目">
</p>

### 02 · 头脑风暴

从一个真实需求出发，分析项目库中不同事项的能力、场景和关联依据，生成多条融合路径、候选项目贡献和最小验证步骤。结果可保存为本地 Markdown，成为可复盘的决策记录。

<p align="center">
  <img src="./assets/readme/showcase-brainstorm.png" width="100%" alt="头脑风暴工作台，根据真实需求关联多个项目并生成有依据的融合方案">
</p>

<details>
<summary><strong>查看看板视图</strong></summary>
<br>
<p align="center">
  <img src="./assets/readme/showcase-board.png" width="100%" alt="灵感来袭看板视图，按状态和分类展示项目卡片">
</p>
</details>

> [在线 Demo](https://wyhcipuc.github.io/TodoBoard/?demo=1) 使用公共示例数据，可直接体验搜索、筛选、列表、看板、统计与头脑风暴。演示站为只读模式，不会上传或保存个人数据。

## 为什么使用它

- **收集后还能继续生长**：不止保存书签，还能进入正文、笔记、截图、计时和研究状态。
- **建议有来源可追溯**：头脑风暴会说明候选项目贡献、关联信号与验证路径，不只给出几个泛泛结论。
- **数据始终属于你**：条目保存在可直接阅读、编辑和备份的 `DATA.md`，不依赖云端账号或专有数据库。
- **开始成本低**：普通用户下载 Windows 单文件即可运行；开发者可以直接使用 Node.js 源码。

## 快速开始

### Windows 一键启动

1. 打开 [GitHub Releases](https://github.com/WYHCIPUC/TodoBoard/releases)，下载 `linggankanban-2.0.0-windows-x64.exe`。
2. 双击文件，等待首次准备完成，程序会自动打开浏览器。

运行环境会缓存到 `%LOCALAPPDATA%\LingganKanban\app`，个人数据和备份独立保存在“文档\LingganKanban”。升级或替换 EXE 不会覆盖数据。

> 当前 Windows EXE 尚未购买代码签名证书。请只从本仓库 Release 或卖家提供的可信地址下载，并使用随附的 `SHA256SUMS.txt` 校验完整性。需要免安装压缩包时，可选择 `windows-portable-x64.zip`。

### 使用源码

需要 Node.js 20 或更高版本：

```bash
git clone https://github.com/WYHCIPUC/TodoBoard.git
cd TodoBoard
npm ci
npm start
```

打开 [http://127.0.0.1:3865](http://127.0.0.1:3865)。首次运行会从 `DATA.example.md` 初始化本地数据；Windows 也可以双击 `start.bat`。

## 核心能力

| 能力 | 解决的问题 |
| --- | --- |
| 粘贴即解析 | 自动提取标题、作者、摘要、封面并给出分类建议 |
| 列表 / 看板双视图 | 搜索、排序并按分类、状态筛选研究事项 |
| 完整研究档案 | 保存正文、独立笔记、截图、计时和进度 |
| 需求驱动头脑风暴 | 从真实问题出发，提取项目长处，形成融合方案与 MVP |
| 知识关联 | 展示多维关系、跨分类碰撞、机会、挑战与行动路线 |
| 本地可靠存储 | 单一 Markdown 数据源、原子写入、自动备份和升级迁移 |
| 批量导入与重复治理 | 导入浏览器书签，合并标签或明确保留重复条目 |
| 远程收集 | 支持企业微信回调与钉钉 Stream 机器人转发入库 |

## 支持的内容

| 内容源 | 可提取信息 |
| --- | --- |
| GitHub 仓库 | README、作者、主要语言与 Star 数 |
| Bilibili 视频 | 标题、UP 主、封面与可用字幕 |
| 微信公众号 / 通用网页 | Open Graph、JSON-LD 与正文 |
| X、YouTube、知乎等站点 | 代理抓取；失败时从 URL 降级识别并保留链接 |

## 本地优先与安全

- 服务默认只监听 `127.0.0.1`，不应直接暴露到不受信任网络。
- 数据 API 需要本机会话 Cookie 或 `LINGGAN_API_TOKEN`。
- 抓取失败时仍会保存链接和可识别信息，避免灵感丢失。
- 旧版本升级前会先备份 `DATA.md` 和研究档案；迁移失败不会覆盖源数据。
- 不要提交 `DATA.md`、自动备份、代理凭据或隧道密钥。

完整边界和漏洞报告方式见 [安全策略](SECURITY.md)。

## 文档与开发

- [Windows 使用指南](docs/WINDOWS-GUIDE.md) — 安装、升级、改端口、故障排查与卸载
- [企业微信接入指南](docs/WECOM-GUIDE.md) — 转发链接远程入库
- [钉钉接入指南](docs/DINGTALK-GUIDE.md) — Stream 模式，零域名零公网
- [更新日志](CHANGELOG.md) — 版本变化
- [贡献指南](CONTRIBUTING.md) — 开发流程与提交规范
- [发布清单](docs/RELEASE-CHECKLIST.md) — 发布前检查
- [便携运行时说明](docs/PORTABLE-RUNTIME.md) — 内置 Node.js 的来源、校验与更新策略

<details>
<summary><strong>环境变量</strong></summary>

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `3865` | 本地服务端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `LINGGAN_API_TOKEN` | 自动生成 | 可选固定 API 令牌 |
| `README_FILE` | `./DATA.md` | 数据文件路径 |
| `NO_OPEN` | — | 设为 `1` 时不自动打开浏览器 |
| `PROXY_URL` | — | 显式代理地址 |
| `ALLOW_PRIVATE_NETWORK` | — | 设为 `1` 允许抓取内网地址，不推荐 |
| `API_RATE_LIMIT` | `300` | 单客户端每分钟数据 API 请求上限 |
| `EXPENSIVE_RATE_LIMIT` | `30` | 单客户端每分钟抓取类请求上限 |
| `RATE_WINDOW_MS` | `60000` | 限流统计窗口，单位毫秒 |
| `AUDIT_LOG_FILE` | 数据目录下 `.linggan/audit.log` | 操作审计日志 |
| `SERVER_ERROR_LOG_FILE` | 数据目录下 `.linggan/server-error.log` | 服务异常日志 |
| `BRAINSTORM_DIR` | 数据目录下 `.linggan/brainstorms/` | 头脑风暴方案目录 |

</details>

<details>
<summary><strong>项目结构与检查命令</strong></summary>

```text
server.js             HTTP 路由与服务编排
lib/                  抓取、分类、存储、知识关联和研究档案模块
lib/scraper/          GitHub、Bilibili 与网页正文解析
board.html/css/js     无框架浏览器客户端
DATA.example.md       首次运行的数据模板
docs/plans/           需求、设计与实施计划
```

```bash
npm test        # 单元测试
npm run check   # 语法检查 + 标准测试套件
```

</details>

## License

[MIT](LICENSE) · 欢迎通过 [贡献指南](CONTRIBUTING.md) 提交改进。
