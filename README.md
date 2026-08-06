# 💡 灵感来袭 · 待办看板

> 本地优先的灵感 / 项目收集工具：粘贴链接自动解析标题、作者、简介、封面并分类，支持研究笔记与正文抓取。数据就是一份 Markdown 文件。

![CI](https://img.shields.io/github/actions/workflow/status/WYHCIPUC/TodoBoard/ci.yml?branch=main)
![License](https://img.shields.io/github/license/WYHCIPUC/TodoBoard)
![Node](https://img.shields.io/badge/node-%E2%89%A520-green)
![GitHub Repo stars](https://img.shields.io/github/stars/WYHCIPUC/TodoBoard?style=social)

（替换上方徽章链接为你的仓库地址，并在下方补充界面截图）

## ✨ 特性

- **粘贴即解析**：粘贴 B站 / GitHub / 微信公众号 / X(Twitter) / 知乎 / YouTube 等任意链接，自动抓取标题、作者、简介、封面并分类
- **被墙也能用**：内置代理自动探测（Clash/v2rayN 等）；抓取失败时兜底解析，任何链接都能入库
- **正文抓取**：一键抓取文章正文 / GitHub README / B站字幕，转 Markdown 存入研究档案
- **研究档案**：每条目独立笔记（自动写回 README 研究要点）、截图上传
- **看板体验**：列表/看板双视图、8 类自动分类、难度/状态标记、搜索、今日随机推荐、统计洞察
- **本地优先**：数据就是一份 `DATA.md`，浏览器自动备份，不上传任何服务器
- **零配置**：`npm install && npm start` 即用；双击 `start.bat`（Windows）亦可

## 🚀 快速开始

```bash
# 要求 Node.js ≥ 20
npm install
npm start
```

打开 http://127.0.0.1:3865 即可使用。首次运行会自动从 `DATA.example.md` 初始化数据文件 `DATA.md`。

Windows 用户也可直接双击 `start.bat`。

## 📄 数据文件

- 所有条目存放在 **`DATA.md`**（Markdown 格式，可随时手工编辑）
- 条目以 `### 状态 编号 标题` 开头，字段为 `- **键**：值` 行
- 写入前自动备份（保留最近 5 份）
- **隐私提示**：`DATA.md` 与 `docs/entries/`（研究笔记与截图）已被 `.gitignore` 排除，不会进入 git 仓库

## 🔗 链接解析支持

| 平台 | 解析方式 |
|---|---|
| GitHub 仓库 | 官方 API（star 数、作者、简介） |
| B站视频 | 官方 API（标题、UP 主、封面）+ 字幕抓取 |
| 微信公众号 / 通用网页 | og 标签 + 正文提取 |
| X(Twitter) / 被墙站点 | 代理抓取，失败时 URL 兜底解析 |

解析过程自动记录到 `docs/fetch-log.md`（时间 / 结果 / 方式 / 错误）。

## 🔌 API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/data` | 读取数据文件内容 |
| GET | `/api/fetch-meta?url=` | 抓取链接元数据（预览） |
| POST | `/api/add` | 新增条目 |
| POST | `/api/delete` | 删除条目 |
| POST | `/api/status` | 更新状态（⏳/🔄/✅） |
| POST | `/api/note` | 更新研究要点 |
| POST | `/api/entry/*` | 研究档案（笔记 / 截图 / 正文抓取） |

## ⚙️ 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3865` | 服务端口 |
| `HOST` | `127.0.0.1` | 监听地址（`0.0.0.0` 会暴露到局域网，**无认证，仅可信网络**） |
| `README_FILE` | `./DATA.md` | 数据文件路径 |
| `NO_OPEN` | - | 设为 `1` 不自动打开浏览器 |
| `PROXY_URL` | - | 显式代理地址（如 `http://127.0.0.1:7890`） |
| `ALLOW_PRIVATE_NETWORK` | - | 设为 `1` 允许抓取内网地址（不推荐） |

## 🏗 项目结构

```
├─ server.js           # HTTP 路由编排
├─ lib/                # 业务模块（fetcher / scraper / store / entries / classifier / safeurl）
├─ board.html/css/js   # 前端（无框架）
├─ DATA.example.md     # 示例数据
├─ guard.js            # 服务守护进程（崩溃自动拉起）
└─ docs/plans/         # 需求与设计文档
```

## 🔒 安全说明

服务默认仅监听 `127.0.0.1`；出站抓取有 SSRF 防护（拒绝内网地址）；写接口有 CSRF 来源校验；上传仅接受 PNG/JPG（magic number 校验，≤5MB）。详见 [SECURITY.md](./SECURITY.md)。

## 🛠 开发

```bash
npm test        # 运行单元测试
npm run check   # 语法检查 + 全部测试
```

提交规范与工作流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 📜 License

[MIT](./LICENSE)
